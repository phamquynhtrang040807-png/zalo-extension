import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StepStatus(str, enum.Enum):
    not_queued = "not_queued"
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    missing_phone = "missing_phone"
    disabled = "disabled"


class TaskType(str, enum.Enum):
    sheet_sync = "sheet_sync"
    zalo_invite = "zalo_invite"
    zalo_message = "zalo_message"


class TaskStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    profile_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    profile_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str] = mapped_column(String(255), index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_url: Mapped[str] = mapped_column(Text)
    reporting_period: Mapped[str | None] = mapped_column(String(255), nullable=True)

    followers_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    followers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gmv_raw: Mapped[str] = mapped_column(String(100))
    gmv_vnd: Mapped[int] = mapped_column(Integer)
    phone_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone_local: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone_e164: Mapped[str | None] = mapped_column(String(20), nullable=True)

    sheet_status: Mapped[str] = mapped_column(String(30), default=StepStatus.pending.value)
    sheet_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    zalo_invite_status: Mapped[str] = mapped_column(
        String(30), default=StepStatus.not_queued.value
    )
    zalo_message_status: Mapped[str] = mapped_column(
        String(30), default=StepStatus.not_queued.value
    )
    zalo_invite_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zalo_message_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    tasks: Mapped[list["OutboxTask"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )


class OutboxTask(Base):
    __tablename__ = "outbox_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    task_type: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(30), default=TaskStatus.pending.value, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    lead: Mapped[Lead] = relationship(back_populates="tasks")


class RuntimeSetting(Base):
    __tablename__ = "runtime_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

