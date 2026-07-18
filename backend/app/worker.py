import logging
import time
from hashlib import sha256
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.models import Lead, OutboxTask, StepStatus, TaskStatus, TaskType
from app.outbox import enqueue_task
from app.services.runtime import get_zalo_automation_config, is_zalo_paused
from app.services.sheets import GoogleSheetsAdapter
from app.services.zalo import ZaloAdapter, ZaloResult


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)
settings = get_settings()
sheet_adapter = GoogleSheetsAdapter(settings)
zalo_adapter = ZaloAdapter(settings)
BACKOFF_SECONDS = (10, 30, 90)


def run_forever() -> None:
    init_db()
    recover_interrupted_tasks()
    logger.info("Worker started")
    last_zalo_call = 0.0
    minimum_zalo_interval = 60.0 / settings.zalo_rate_limit_per_minute
    while True:
        with SessionLocal() as db:
            task = claim_next_task(db)
            if not task:
                time.sleep(settings.worker_poll_seconds)
                continue
            if task.task_type in (TaskType.zalo_invite.value, TaskType.zalo_message.value):
                elapsed = time.monotonic() - last_zalo_call
                if elapsed < minimum_zalo_interval:
                    time.sleep(minimum_zalo_interval - elapsed)
                last_zalo_call = time.monotonic()
            process_task(db, task)


def recover_interrupted_tasks() -> None:
    """Return tasks left processing by a crashed worker to the durable queue."""
    with SessionLocal() as db:
        result = db.execute(
            update(OutboxTask)
            .where(OutboxTask.status == TaskStatus.processing.value)
            .values(
                status=TaskStatus.pending.value,
                available_at=datetime.now(timezone.utc),
                last_error="Recovered after worker restart",
            )
        )
        db.commit()
        if result.rowcount:
            logger.warning("Recovered %s interrupted task(s)", result.rowcount)


def claim_next_task(db: Session) -> OutboxTask | None:
    now = datetime.now(timezone.utc)
    query = (
        select(OutboxTask)
        .where(
            OutboxTask.status == TaskStatus.pending.value,
            OutboxTask.available_at <= now,
        )
        .order_by(OutboxTask.created_at, OutboxTask.id)
        .limit(1)
    )
    if not settings.database_url.startswith("sqlite"):
        query = query.with_for_update(skip_locked=True)
    task = db.scalar(query)
    if not task:
        return None
    task.status = TaskStatus.processing.value
    task.attempts += 1
    db.commit()
    db.refresh(task)
    return task


def process_task(db: Session, task: OutboxTask) -> None:
    lead = db.get(Lead, task.lead_id)
    if not lead:
        task.status = TaskStatus.failed.value
        task.last_error = "Lead no longer exists"
        db.commit()
        return
    try:
        if task.task_type == TaskType.sheet_sync.value:
            result = sheet_adapter.insert_lead(lead)
            lead.sheet_row = result.row
            lead.sheet_status = StepStatus.completed.value
            task.status = TaskStatus.completed.value
            task.last_error = None
        elif task.task_type == TaskType.zalo_invite.value:
            _process_zalo(db, task, lead, invite=True)
        elif task.task_type == TaskType.zalo_message.value:
            _process_zalo(db, task, lead, invite=False)
        else:
            raise RuntimeError(f"Unknown task type: {task.task_type}")
        db.commit()
    except Exception as exc:  # external SDK errors are intentionally caught at the outbox boundary
        logger.exception("Task %s failed", task.id)
        _retry_or_fail(db, task, lead, str(exc), retryable=True)


def _process_zalo(db: Session, task: OutboxTask, lead: Lead, invite: bool) -> None:
    if is_zalo_paused(db):
        task.status = TaskStatus.pending.value
        task.available_at = datetime.now(timezone.utc) + timedelta(seconds=30)
        task.attempts = max(0, task.attempts - 1)
        return

    if invite and lead.zalo_invite_status == StepStatus.completed.value:
        task.status = TaskStatus.completed.value
        _ensure_message_task(db, lead)
        return
    if not invite and lead.zalo_message_status == StepStatus.completed.value:
        task.status = TaskStatus.completed.value
        return

    if invite:
        lead.zalo_invite_status = StepStatus.processing.value
        config = _automation_config(db)
        result = zalo_adapter.send_friend_request(
            lead,
            f"{lead.profile_key}:invite",
            str(config["friend_request_message"]),
        )
    else:
        lead.zalo_message_status = StepStatus.processing.value
        result = _send_configured_messages(db, lead)
    _apply_zalo_result(db, task, lead, result, invite)


def _automation_config(db: Session) -> dict[str, object]:
    return get_zalo_automation_config(
        db,
        settings.zalo_friend_request_message,
        settings.zalo_message_template,
    )


def _send_configured_messages(db: Session, lead: Lead) -> ZaloResult:
    messages = list(_automation_config(db)["messages"])
    external_ids: list[str] = []
    minimum_interval = 60.0 / settings.zalo_rate_limit_per_minute

    for index, message_template in enumerate(messages):
        digest = sha256(message_template.encode("utf-8")).hexdigest()[:16]
        result = zalo_adapter.send_message(
            lead,
            f"{lead.profile_key}:message:{index}:{digest}",
            message_template,
        )
        if not result.success:
            return result
        if result.external_id:
            external_ids.append(result.external_id)
        if index < len(messages) - 1:
            time.sleep(minimum_interval)

    return ZaloResult(
        success=True,
        external_id=",".join(external_ids) or None,
    )


def _apply_zalo_result(
    db: Session, task: OutboxTask, lead: Lead, result: ZaloResult, invite: bool
) -> None:
    if result.success:
        task.status = TaskStatus.completed.value
        task.last_error = None
        lead.last_error = None
        if invite:
            lead.zalo_invite_status = StepStatus.completed.value
            lead.zalo_invite_external_id = result.external_id
            _ensure_message_task(db, lead)
        else:
            lead.zalo_message_status = StepStatus.completed.value
            lead.zalo_message_external_id = result.external_id
        return

    error = ": ".join(part for part in (result.error_code, result.error_message) if part)
    _retry_or_fail(db, task, lead, error or "Unknown Zalo error", result.retryable)
    if task.status == TaskStatus.failed.value and invite:
        # The message is attempted even when the invitation is permanently rejected.
        _ensure_message_task(db, lead)


def _retry_or_fail(
    db: Session,
    task: OutboxTask,
    lead: Lead,
    error: str,
    retryable: bool,
) -> None:
    task.last_error = error
    lead.last_error = error
    is_final = not retryable or task.attempts >= settings.max_task_attempts
    if is_final:
        task.status = TaskStatus.failed.value
        if task.task_type == TaskType.sheet_sync.value:
            lead.sheet_status = StepStatus.failed.value
        elif task.task_type == TaskType.zalo_invite.value:
            lead.zalo_invite_status = StepStatus.failed.value
        elif task.task_type == TaskType.zalo_message.value:
            lead.zalo_message_status = StepStatus.failed.value
    else:
        task.status = TaskStatus.pending.value
        delay_index = min(task.attempts - 1, len(BACKOFF_SECONDS) - 1)
        task.available_at = datetime.now(timezone.utc) + timedelta(
            seconds=BACKOFF_SECONDS[delay_index]
        )
        if task.task_type == TaskType.zalo_invite.value:
            lead.zalo_invite_status = StepStatus.pending.value
        elif task.task_type == TaskType.zalo_message.value:
            lead.zalo_message_status = StepStatus.pending.value
    db.commit()


def _ensure_message_task(db: Session, lead: Lead) -> None:
    if lead.zalo_message_status != StepStatus.completed.value:
        lead.zalo_message_status = StepStatus.pending.value
        enqueue_task(db, lead.id, TaskType.zalo_message)


if __name__ == "__main__":
    run_forever()
