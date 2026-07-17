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


CaptureAction = Literal[
    "skipped_gmv", "saved_missing_phone", "queued", "duplicate_completed"
]


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
