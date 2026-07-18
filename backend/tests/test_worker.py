from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

from sqlalchemy import func, select

from app import worker
from app.db import SessionLocal
from app.models import Lead, OutboxTask, StepStatus, TaskStatus, TaskType
from app.services.runtime import set_zalo_automation_config
from app.services.zalo import ZaloResult


def test_worker_sends_every_configured_message_with_its_own_idempotency_key(monkeypatch):
    calls: list[tuple[str, str]] = []

    class FakeZaloAdapter:
        def recipient_phone(self, lead):
            return lead.phone_e164 or lead.phone_raw

        def send_message(self, lead, idempotency_key, message_template=None):
            calls.append((idempotency_key, message_template))
            return ZaloResult(success=True, external_id=f"sent-{len(calls)}")

    monkeypatch.setattr(worker, "zalo_adapter", FakeZaloAdapter())
    monkeypatch.setattr(worker.time, "sleep", lambda _: None)
    lead = Lead(
        id="lead-worker-test",
        profile_key="username:worker_test",
        username="worker_test",
        gmv_vnd=70_000_000,
        phone_raw="zalo-id-worker",
    )

    with SessionLocal() as db:
        set_zalo_automation_config(
            db,
            "Xin chào",
            ["Tin thứ nhất", "Tin thứ hai"],
        )
        result = worker._send_configured_messages(db, lead)

    assert result.success
    assert result.external_id == "sent-1,sent-2"
    assert [message for _, message in calls] == ["Tin thứ nhất", "Tin thứ hai"]
    assert calls[0][0] != calls[1][0]


def test_sheet_append_queues_zalo_message_without_invitation(monkeypatch):
    class FakeSheetAdapter:
        def insert_lead(self, lead):
            return SimpleNamespace(row=42)

    monkeypatch.setattr(worker, "sheet_adapter", FakeSheetAdapter())
    lead_id = f"lead-{uuid.uuid4()}"
    with SessionLocal() as db:
        lead = Lead(
            id=lead_id,
            profile_key=f"username:{uuid.uuid4()}",
            username="sheet_worker_test",
            profile_url="https://example.test/kol",
            gmv_raw="không kiểm tra",
            gmv_vnd=0,
            phone_raw="zalo-id_creator",
            captured_at=datetime.now(timezone.utc),
            sheet_status=StepStatus.pending.value,
            zalo_invite_status=StepStatus.not_queued.value,
            zalo_message_status=StepStatus.not_queued.value,
        )
        db.add(lead)
        db.flush()
        task = OutboxTask(
            lead_id=lead.id,
            task_type=TaskType.sheet_sync.value,
            status=TaskStatus.processing.value,
            attempts=1,
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        worker.process_task(db, task)
        db.refresh(lead)
        invite_count = db.scalar(
            select(func.count(OutboxTask.id)).where(
                OutboxTask.lead_id == lead.id,
                OutboxTask.task_type == TaskType.zalo_invite.value,
                OutboxTask.status == TaskStatus.pending.value,
            )
        )
        message_count = db.scalar(
            select(func.count(OutboxTask.id)).where(
                OutboxTask.lead_id == lead.id,
                OutboxTask.task_type == TaskType.zalo_message.value,
                OutboxTask.status == TaskStatus.pending.value,
            )
        )

    assert task.status == TaskStatus.completed.value
    assert lead.sheet_row == 42
    assert lead.zalo_invite_status == StepStatus.disabled.value
    assert invite_count == 0
    assert lead.zalo_message_status == StepStatus.pending.value
    assert message_count == 1
