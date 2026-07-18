from contextlib import asynccontextmanager
from hashlib import sha256
from html import escape
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import require_api_token
from app.config import get_settings
from app.db import get_db, init_db
from app.models import Lead, StepStatus, TaskType
from app.normalization import (
    normalize_followers,
    normalize_gmv,
    normalize_username,
    normalize_vietnam_phone,
)
from app.outbox import enqueue_task
from app.schemas import (
    CaptureRequest,
    CaptureResponse,
    GoogleAuthStartResponse,
    GoogleSheetsTestRequest,
    GoogleSheetsTestResponse,
    JobResponse,
    NormalizedCapture,
    ZaloControlRequest,
    ZaloControlResponse,
    ZaloAutomationConfig,
    ZaloAutomationTestRequest,
    ZaloAutomationTestResponse,
)
from app.services.runtime import (
    get_zalo_automation_config,
    is_zalo_paused,
    set_zalo_automation_config,
    set_zalo_paused,
)
from app.services.google_oauth import complete_authorization, create_authorization_url
from app.services.sheets import GoogleSheetsAdapter
from app.services.zalo import ZaloAdapter
from app.services.zalo_bridge import PersonalZaloBridge, ZaloBridgeError


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Auto Zalo API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in settings.cors_allow_origins.split(",")
        if origin.strip()
    ],
    allow_origin_regex=settings.cors_allow_origin_regex or None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=86400,
)


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, object]:
    database_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        database_ok = False
    sheets = GoogleSheetsAdapter(settings)
    zalo = ZaloAdapter(settings)
    return {
        "status": "ok" if database_ok else "degraded",
        "database": database_ok,
        "google_sheets_configured": sheets.configured,
        "google_auth_mode": settings.google_auth_mode,
        "google_credentials_ready": sheets.auth_configured,
        "zalo_configured": zalo.configured,
        "zalo_enabled": settings.zalo_enabled,
        "zalo_dry_run": settings.dry_run,
        "zalo_force_recipient_enabled": settings.zalo_force_recipient_enabled,
        "zalo_paused": is_zalo_paused(db),
    }


@app.post(
    "/v1/integrations/google/start",
    response_model=GoogleAuthStartResponse,
    dependencies=[Depends(require_api_token)],
)
def start_google_oauth(db: Session = Depends(get_db)) -> GoogleAuthStartResponse:
    if settings.google_auth_mode.lower() != "oauth":
        raise HTTPException(
            status_code=409,
            detail="GOOGLE_AUTH_MODE phải là oauth để dùng luồng cấp quyền này",
        )
    try:
        authorization_url = create_authorization_url(db, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GoogleAuthStartResponse(
        authorization_url=authorization_url,
        redirect_uri=settings.google_oauth_redirect_uri,
    )


@app.get("/v1/integrations/google/callback", response_class=HTMLResponse)
def google_oauth_callback(
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        return HTMLResponse(
            f"<h1>Kết nối Google thất bại</h1><p>{escape(error)}</p>", status_code=400
        )
    if not code:
        return HTMLResponse("<h1>Thiếu authorization code</h1>", status_code=400)
    try:
        complete_authorization(db, settings, state, code)
    except Exception as exc:
        return HTMLResponse(
            f"<h1>Kết nối Google thất bại</h1><p>{escape(str(exc))}</p>",
            status_code=400,
        )
    return HTMLResponse(
        "<h1>Kết nối Google thành công</h1>"
        "<p>Bạn có thể đóng tab này và quay lại Extension Options để kiểm tra Sheet.</p>"
    )


@app.post(
    "/v1/integrations/google-sheets/test",
    response_model=GoogleSheetsTestResponse,
    dependencies=[Depends(require_api_token)],
)
def test_google_sheet(
    payload: GoogleSheetsTestRequest, db: Session = Depends(get_db)
) -> GoogleSheetsTestResponse:
    del db  # dependency ensures a healthy request context; adapter uses Google directly.
    adapter = GoogleSheetsAdapter(settings)
    try:
        result = adapter.diagnose(write_test=payload.write_test)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GoogleSheetsTestResponse(
        connected=result.connected,
        auth_mode=settings.google_auth_mode,
        spreadsheet_id=settings.google_spreadsheet_id,
        spreadsheet_title=result.spreadsheet_title,
        target_sheet_name=result.target_sheet_name,
        target_sheet_found=result.target_sheet_found,
        available_sheets=result.available_sheets,
        read_ok=result.read_ok,
        write_ok=result.write_ok,
        message=result.message,
    )


@app.post(
    "/v1/captures",
    response_model=CaptureResponse,
    dependencies=[Depends(require_api_token)],
)
def capture(payload: CaptureRequest, db: Session = Depends(get_db)) -> CaptureResponse:
    followers = normalize_followers(payload.followers_raw)
    gmv_vnd = normalize_gmv(payload.gmv_raw)
    phone = normalize_vietnam_phone(payload.phone_raw)
    has_zalo_value = phone is not None
    normalized = NormalizedCapture(
        followers=followers,
        gmv_vnd=gmv_vnd,
        phone_local=phone.local if phone else None,
        phone_e164=phone.e164 if phone else None,
    )
    username = normalize_username(payload.username)
    profile_key = f"id:{payload.profile_id}" if payload.profile_id else f"username:{username}"
    lead = db.scalar(select(Lead).where(Lead.profile_key == profile_key))
    if lead is None:
        lead = Lead(
            profile_key=profile_key,
            username=username,
            profile_url=str(payload.profile_url),
            gmv_raw=payload.gmv_raw,
            gmv_vnd=gmv_vnd or 0,
            captured_at=payload.captured_at,
        )
        db.add(lead)
        db.flush()

    lead.profile_id = payload.profile_id
    lead.username = username
    lead.display_name = payload.display_name
    lead.profile_url = str(payload.profile_url)
    lead.reporting_period = payload.reporting_period
    lead.followers_raw = payload.followers_raw
    lead.followers = followers
    lead.gmv_raw = payload.gmv_raw
    lead.gmv_vnd = gmv_vnd or 0
    lead.phone_raw = phone.local if phone else None
    lead.phone_local = phone.local if phone else None
    lead.phone_e164 = phone.e164 if phone else None
    lead.captured_at = payload.captured_at
    lead.last_error = None
    lead.sheet_status = StepStatus.pending.value

    if not has_zalo_value:
        lead.zalo_invite_status = StepStatus.disabled.value
        if lead.zalo_message_status != StepStatus.completed.value:
            lead.zalo_message_status = StepStatus.missing_phone.value
        enqueue_task(db, lead.id, TaskType.sheet_sync)
        db.commit()
        return CaptureResponse(
            action="saved_missing_phone",
            lead_id=lead.id,
            job_id=lead.id,
            message="Đã lưu hồ sơ nhưng SĐT không thể chuẩn hóa thành đúng 10 chữ số",
            normalized=normalized,
        )

    # Sheet sync remains durable, while Zalo uses the same synchronous path as
    # the manual test action so it does not depend on a separate worker.
    lead.zalo_invite_status = StepStatus.disabled.value
    lead.zalo_message_status = StepStatus.processing.value
    lead.zalo_invite_external_id = None
    lead.zalo_message_external_id = None
    enqueue_task(db, lead.id, TaskType.sheet_sync)
    db.commit()

    if is_zalo_paused(db):
        lead.zalo_message_status = StepStatus.failed.value
        lead.last_error = "Zalo đang tạm dừng"
        db.commit()
        raise HTTPException(status_code=409, detail=lead.last_error)

    recipient = lead.phone_e164 or (lead.phone_raw or "").strip()
    delivery_digest = sha256(
        f"{lead.profile_key}|{lead.captured_at.isoformat()}|{recipient}".encode("utf-8")
    ).hexdigest()[:24]
    try:
        effective_recipient, message_ids = _send_direct_messages(
            db,
            lead,
            f"capture:{delivery_digest}",
        )
    except HTTPException as exc:
        lead.zalo_message_status = StepStatus.failed.value
        lead.last_error = str(exc.detail)
        db.commit()
        raise

    lead.zalo_message_status = StepStatus.completed.value
    lead.zalo_message_external_id = ",".join(message_ids) or None
    lead.last_error = None
    db.commit()

    return CaptureResponse(
        action="sent",
        lead_id=lead.id,
        job_id=lead.id,
        message=f"Đã gửi trực tiếp tới số …{effective_recipient[-4:]}; Sheet đang đồng bộ",
        normalized=normalized,
    )


@app.get(
    "/v1/jobs/{job_id}",
    response_model=JobResponse,
    dependencies=[Depends(require_api_token)],
)
def get_job(job_id: str, db: Session = Depends(get_db)) -> JobResponse:
    lead = db.get(Lead, job_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(
        job_id=lead.id,
        profile_key=lead.profile_key,
        username=lead.username,
        sheet_status=lead.sheet_status,
        zalo_invite_status=lead.zalo_invite_status,
        zalo_message_status=lead.zalo_message_status,
        last_error=lead.last_error,
        updated_at=lead.updated_at,
    )


@app.post(
    "/v1/control/zalo",
    response_model=ZaloControlResponse,
    dependencies=[Depends(require_api_token)],
)
def control_zalo(payload: ZaloControlRequest, db: Session = Depends(get_db)) -> ZaloControlResponse:
    set_zalo_paused(db, not payload.enabled)
    return ZaloControlResponse(enabled=payload.enabled, paused=not payload.enabled)


@app.get(
    "/v1/config/zalo-automation",
    response_model=ZaloAutomationConfig,
    dependencies=[Depends(require_api_token)],
)
def get_zalo_automation(db: Session = Depends(get_db)) -> ZaloAutomationConfig:
    return ZaloAutomationConfig.model_validate(
        get_zalo_automation_config(
            db,
            settings.zalo_friend_request_message,
            settings.zalo_message_template,
        )
    )


@app.put(
    "/v1/config/zalo-automation",
    response_model=ZaloAutomationConfig,
    dependencies=[Depends(require_api_token)],
)
def update_zalo_automation(
    payload: ZaloAutomationConfig,
    db: Session = Depends(get_db),
) -> ZaloAutomationConfig:
    set_zalo_automation_config(
        db,
        payload.friend_request_message,
        payload.messages,
    )
    return payload


@app.post(
    "/v1/config/zalo-automation/test",
    response_model=ZaloAutomationTestResponse,
    dependencies=[Depends(require_api_token)],
)
def test_zalo_automation(
    payload: ZaloAutomationTestRequest,
    db: Session = Depends(get_db),
) -> ZaloAutomationTestResponse:
    if is_zalo_paused(db):
        raise HTTPException(status_code=409, detail="Zalo đang tạm dừng; hãy bật lại trước khi gửi thử")

    raw_phone = payload.phone.strip()
    phone = normalize_vietnam_phone(raw_phone)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Số điện thoại phải chuẩn hóa được thành đúng 10 chữ số, bắt đầu bằng 0",
        )

    lead = Lead(
        id=f"test-{uuid.uuid4()}",
        profile_key=f"test:{uuid.uuid4()}",
        username="zalo_test",
        display_name="Kiểm tra Zalo",
        phone_raw=phone.local,
        phone_local=phone.local,
        phone_e164=phone.e164,
        gmv_vnd=0,
    )
    test_run_id = uuid.uuid4().hex
    effective_recipient, message_ids = _send_direct_messages(
        db,
        lead,
        f"automation-test:{test_run_id}",
    )
    messages = list(
        get_zalo_automation_config(
            db,
            settings.zalo_friend_request_message,
            settings.zalo_message_template,
        )["messages"]
    )

    return ZaloAutomationTestResponse(
        success=True,
        requested_phone=payload.phone,
        effective_recipient_last4=effective_recipient[-4:],
        force_recipient_enabled=settings.zalo_force_recipient_enabled,
        sent_count=len(messages),
        message_ids=message_ids,
        message=(
            f"Đã gửi thử {len(messages)} tin nhắn tới số …{effective_recipient[-4:]}"
            if messages
            else "Không có tin nhắn tự động nào để gửi thử"
        ),
    )


def _send_direct_messages(
    db: Session,
    lead: Lead,
    idempotency_prefix: str,
) -> tuple[str, list[str]]:
    config = get_zalo_automation_config(
        db,
        settings.zalo_friend_request_message,
        settings.zalo_message_template,
    )
    messages = list(config["messages"])
    adapter = ZaloAdapter(settings)
    effective_recipient = adapter.recipient_phone(lead)
    if not effective_recipient:
        raise HTTPException(status_code=400, detail="Không xác định được số điện thoại nhận")

    message_ids: list[str] = []
    minimum_interval = 60.0 / settings.zalo_rate_limit_per_minute
    for index, message_template in enumerate(messages):
        template_digest = sha256(message_template.encode("utf-8")).hexdigest()[:16]
        result = adapter.send_message(
            lead,
            f"{idempotency_prefix}:{index}:{template_digest}",
            message_template,
        )
        if not result.success:
            detail = ": ".join(
                part for part in (result.error_code, result.error_message) if part
            )
            raise HTTPException(
                status_code=502,
                detail=f"Tin nhắn thứ {index + 1} thất bại: {detail or 'Lỗi Zalo không xác định'}",
            )
        if result.external_id:
            message_ids.append(result.external_id)
        if index < len(messages) - 1:
            time.sleep(minimum_interval)
    return effective_recipient, message_ids


def _personal_zalo_bridge() -> PersonalZaloBridge:
    return PersonalZaloBridge(settings)


def _bridge_http_error(exc: ZaloBridgeError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@app.get(
    "/v1/integrations/zalo/status",
    dependencies=[Depends(require_api_token)],
)
def personal_zalo_status() -> dict[str, object]:
    try:
        return _personal_zalo_bridge().status()
    except ZaloBridgeError as exc:
        raise _bridge_http_error(exc) from exc


@app.post(
    "/v1/integrations/zalo/login/qr",
    dependencies=[Depends(require_api_token)],
)
def personal_zalo_start_qr_login() -> dict[str, object]:
    try:
        return _personal_zalo_bridge().start_qr_login()
    except ZaloBridgeError as exc:
        raise _bridge_http_error(exc) from exc


@app.get(
    "/v1/integrations/zalo/login/qr",
    dependencies=[Depends(require_api_token)],
)
def personal_zalo_qr_image() -> dict[str, str]:
    try:
        return _personal_zalo_bridge().qr_image()
    except ZaloBridgeError as exc:
        raise _bridge_http_error(exc) from exc
