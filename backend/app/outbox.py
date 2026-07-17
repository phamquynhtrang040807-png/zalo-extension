from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OutboxTask, TaskStatus, TaskType


def enqueue_task(db: Session, lead_id: str, task_type: TaskType) -> OutboxTask:
    # Every capture must produce its own Sheet row, including duplicate profiles.
    # Zalo actions remain de-duplicated while pending/processing.
    if task_type == TaskType.sheet_sync:
        task = OutboxTask(
            lead_id=lead_id,
            task_type=task_type.value,
            available_at=datetime.now(timezone.utc),
        )
        db.add(task)
        db.flush()
        return task

    existing = db.scalar(
        select(OutboxTask).where(
            OutboxTask.lead_id == lead_id,
            OutboxTask.task_type == task_type.value,
            OutboxTask.status.in_([TaskStatus.pending.value, TaskStatus.processing.value]),
        )
    )
    if existing:
        return existing
    task = OutboxTask(
        lead_id=lead_id,
        task_type=task_type.value,
        available_at=datetime.now(timezone.utc),
    )
    db.add(task)
    db.flush()
    return task
