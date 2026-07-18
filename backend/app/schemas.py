from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


class CaptureRequest(BaseModel):
    source: Literal["tiktok_shop"] = "tiktok_shop"
    profile_id: str | None = None
    username: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    followers_raw: str | None = Field(default=None, max_length=100)
    gmv_raw: str = Field(min_length=1, max_length=100)
    phone_raw: str | None = Field(default=None, max_length=100)
    reporting_period: str | None = Field(default=None, max_length=255)
    profile_url: HttpUrl
    captured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip().lstrip("@")


CaptureAction = Literal["saved_missing_phone", "sent"]


class NormalizedCapture(BaseModel):
    followers: int | None = None
    gmv_vnd: int | None = None
    phone_local: str | None = None
    phone_e164: str | None = None


class CaptureResponse(BaseModel):
    action: CaptureAction
    lead_id: str | None = None
    job_id: str | None = None
    message: str
    normalized: NormalizedCapture


class JobResponse(BaseModel):
    job_id: str
    profile_key: str
    username: str
    sheet_status: str
    zalo_invite_status: str
    zalo_message_status: str
    last_error: str | None = None
    updated_at: datetime


class ZaloControlRequest(BaseModel):
    enabled: bool


class ZaloControlResponse(BaseModel):
    enabled: bool
    paused: bool


class ZaloAutomationConfig(BaseModel):
    friend_request_message: str = Field(min_length=1, max_length=500)
    messages: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("friend_request_message")
    @classmethod
    def clean_friend_request_message(cls, value: str) -> str:
        return value.strip()

    @field_validator("messages")
    @classmethod
    def clean_messages(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("Tin nhắn tự động không được để trống; hãy xóa dòng nếu không dùng")
        if any(len(value) > 5000 for value in cleaned):
            raise ValueError("Mỗi tin nhắn tự động không được vượt quá 5000 ký tự")
        return cleaned


class ZaloAutomationTestRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=30)

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value: str) -> str:
        return value.strip()


class ZaloAutomationTestResponse(BaseModel):
    success: bool
    requested_phone: str
    effective_recipient_last4: str
    force_recipient_enabled: bool
    sent_count: int
    message_ids: list[str]
    message: str


class GoogleAuthStartResponse(BaseModel):
    authorization_url: str
    redirect_uri: str


class GoogleSheetsTestRequest(BaseModel):
    write_test: bool = True


class GoogleSheetsTestResponse(BaseModel):
    connected: bool
    auth_mode: str
    spreadsheet_id: str
    spreadsheet_title: str
    target_sheet_name: str
    target_sheet_found: bool
    available_sheets: list[str]
    read_ok: bool
    write_ok: bool
    message: str
