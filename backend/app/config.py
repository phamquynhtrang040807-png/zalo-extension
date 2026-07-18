from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    api_token: str = "change-me-to-a-long-random-token"
    database_url: str = "sqlite:///./data/auto_zalo.db"
    google_sheets_enabled: bool = False
    google_spreadsheet_id: str = ""
    google_sheet_name: str = "Leads"
    google_auth_mode: str = "service_account"
    google_service_account_file: str = "secrets/google-service-account.json"
    google_oauth_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_ID"),
    )
    google_oauth_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_SECRET"),
    )
    google_oauth_token_file: str = "secrets/google-oauth-token.json"
    google_oauth_redirect_uri: str = (
        "http://localhost:8001/v1/integrations/google/callback"
    )

    zalo_enabled: bool = False
    dry_run: bool = True
    zalo_base_url: str = ""
    zalo_token: str = ""
    zalo_invite_path: str = "/friend-request"
    zalo_message_path: str = "/messages"
    zalo_rate_limit_per_minute: int = Field(default=20, ge=1, le=600)
    # Safety guard: while enabled, every Zalo action is redirected to this number.
    # Set ZALO_FORCE_RECIPIENT_ENABLED=false to restore each lead's own number.
    zalo_force_recipient_enabled: bool = True
    zalo_force_recipient_phone: str = "0961382006"
    zalo_friend_request_message: str = "Xin chào, mình muốn kết bạn với bạn."
    zalo_message_template: str = (
        "Chào {username}, mình muốn kết nối và trao đổi thêm với bạn."
    )

    worker_poll_seconds: float = Field(default=1.0, ge=0.1, le=60)
    max_task_attempts: int = Field(default=3, ge=1, le=10)


@lru_cache
def get_settings() -> Settings:
    return Settings()
