import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google_auth_oauthlib.flow import Flow
from sqlalchemy.orm import Session

from app.config import Settings
from app.services.runtime import (
    delete_runtime_setting,
    get_runtime_setting,
    set_runtime_setting,
)


SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
OAUTH_STATE_KEY = "google_oauth_state"


def create_authorization_url(db: Session, settings: Settings) -> str:
    _validate_oauth_settings(settings)
    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    set_runtime_setting(
        db,
        OAUTH_STATE_KEY,
        json.dumps({"state": state, "expires_at": expires_at.isoformat()}),
    )
    flow = _build_flow(settings, state=state)
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return authorization_url


def complete_authorization(db: Session, settings: Settings, state: str, code: str) -> None:
    stored_raw = get_runtime_setting(db, OAUTH_STATE_KEY)
    if not stored_raw:
        raise ValueError("Phiên kết nối Google không tồn tại hoặc đã được sử dụng")
    stored = json.loads(stored_raw)
    expires_at = datetime.fromisoformat(stored["expires_at"])
    if not secrets.compare_digest(state, stored.get("state", "")):
        raise ValueError("Google OAuth state không hợp lệ")
    if datetime.now(timezone.utc) > expires_at:
        delete_runtime_setting(db, OAUTH_STATE_KEY)
        raise ValueError("Phiên kết nối Google đã hết hạn; hãy bắt đầu lại")

    flow = _build_flow(settings, state=state)
    flow.fetch_token(code=code)
    token_path = Path(settings.google_oauth_token_file)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(flow.credentials.to_json(), encoding="utf-8")
    delete_runtime_setting(db, OAUTH_STATE_KEY)


def _build_flow(settings: Settings, state: str | None = None) -> Flow:
    client_config = {
        "web": {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_oauth_redirect_uri],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SHEETS_SCOPES, state=state)
    flow.redirect_uri = settings.google_oauth_redirect_uri
    return flow


def _validate_oauth_settings(settings: Settings) -> None:
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise ValueError("Thiếu Google OAuth client ID hoặc client secret")
    if not settings.google_oauth_redirect_uri:
        raise ValueError("Thiếu GOOGLE_OAUTH_REDIRECT_URI")

