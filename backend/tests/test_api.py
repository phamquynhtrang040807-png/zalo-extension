import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

import app.main as main_module
from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import OutboxTask, TaskType
from app.services.zalo import ZaloResult


client = TestClient(app)


@pytest.fixture(autouse=True)
def fake_zalo_delivery(monkeypatch):
    sent: list[tuple[str, str]] = []

    class FakeZaloAdapter:
        def __init__(self, settings):
            self.settings = settings

        def recipient_phone(self, lead):
            return lead.phone_e164 or lead.phone_raw

        def send_message(self, lead, idempotency_key, message_template=None):
            sent.append((idempotency_key, message_template))
            return ZaloResult(success=True, external_id=f"message-{len(sent)}")

    monkeypatch.setattr(main_module, "ZaloAdapter", FakeZaloAdapter)
    return sent


def auth_headers():
    return {"Authorization": f"Bearer {get_settings().api_token}"}


def test_allows_extension_cors_preflight_for_any_valid_extension_id():
    origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    with TestClient(app) as test_client:
        response = test_client.options(
            "/v1/config/zalo-automation",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "PUT" in response.headers["access-control-allow-methods"]


def payload(**overrides):
    data = {
        "source": "tiktok_shop",
        "profile_id": str(uuid.uuid4()),
        "username": "quynhanh_lee",
        "display_name": "Quỳnh Anh diệu",
        "followers_raw": "12,2K",
        "gmv_raw": "718,5 Tr đ",
        "phone_raw": "0912345678",
        "reporting_period": "15 tháng 6 2026 - 15 tháng 7 2026 (GMT+7)",
        "profile_url": "https://affiliate.tiktok.com/creator/demo",
    }
    data.update(overrides)
    return data


def test_requires_token():
    with TestClient(app) as test_client:
        response = test_client.post("/v1/captures", json=payload())
    assert response.status_code == 401


def test_google_sheet_diagnostic_requires_spreadsheet_id():
    with TestClient(app) as test_client:
        response = test_client.post(
            "/v1/integrations/google-sheets/test",
            json={"write_test": True},
            headers=auth_headers(),
        )
    assert response.status_code == 400
    assert "GOOGLE_SPREADSHEET_ID" in response.json()["detail"]


def test_low_gmv_is_queued_without_a_threshold():
    with TestClient(app) as test_client:
        response = test_client.post(
            "/v1/captures", json=payload(gmv_raw="49,9 Tr"), headers=auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["action"] == "sent"
    assert response.json()["lead_id"] is not None


def test_sends_eligible_lead_directly_and_exposes_job(fake_zalo_delivery):
    with TestClient(app) as test_client:
        response = test_client.post("/v1/captures", json=payload(), headers=auth_headers())
        assert response.status_code == 200
        body = response.json()
        assert body["action"] == "sent"
        job = test_client.get(f"/v1/jobs/{body['job_id']}", headers=auth_headers())
    assert job.status_code == 200
    assert job.json()["sheet_status"] == "pending"
    assert job.json()["zalo_invite_status"] == "disabled"
    assert job.json()["zalo_message_status"] == "completed"
    assert len(fake_zalo_delivery) >= 1


def test_saves_missing_phone():
    with TestClient(app) as test_client:
        response = test_client.post(
            "/v1/captures", json=payload(phone_raw=None), headers=auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["action"] == "saved_missing_phone"


def test_keeps_non_standard_zalo_value():
    with TestClient(app) as test_client:
        response = test_client.post(
            "/v1/captures", json=payload(phone_raw="zalo-id_creator"), headers=auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["action"] == "sent"
    assert response.json()["normalized"]["phone_local"] is None


def test_duplicate_capture_creates_two_sheet_insert_tasks():
    data = payload()
    with TestClient(app) as test_client:
        first = test_client.post("/v1/captures", json=data, headers=auth_headers()).json()
        test_client.post("/v1/captures", json=data, headers=auth_headers())

    with SessionLocal() as db:
        count = db.scalar(
            select(func.count(OutboxTask.id)).where(
                OutboxTask.lead_id == first["lead_id"],
                OutboxTask.task_type == TaskType.sheet_sync.value,
            )
        )
    assert count == 2


def test_zalo_automation_config_can_change_message_count():
    config = {
        "friend_request_message": "Xin chào {display_name}, mình xin phép kết bạn.",
        "messages": [
            "Chào {username}, đây là tin thứ nhất.",
            "GMV ghi nhận: {gmv}.",
        ],
    }
    with TestClient(app) as test_client:
        saved = test_client.put(
            "/v1/config/zalo-automation",
            json=config,
            headers=auth_headers(),
        )
        loaded = test_client.get(
            "/v1/config/zalo-automation",
            headers=auth_headers(),
        )

    assert saved.status_code == 200
    assert loaded.status_code == 200
    assert loaded.json() == config


def test_zalo_automation_config_allows_invitation_only():
    with TestClient(app) as test_client:
        response = test_client.put(
            "/v1/config/zalo-automation",
            json={
                "friend_request_message": "Xin chào, mình xin phép kết bạn.",
                "messages": [],
            },
            headers=auth_headers(),
        )

    assert response.status_code == 200
    assert response.json()["messages"] == []


def test_zalo_automation_test_sends_current_message_list(monkeypatch):
    sent_messages: list[str] = []

    class FakeZaloAdapter:
        def __init__(self, settings):
            self.settings = settings

        def recipient_phone(self, lead):
            return "+84961382006"

        def send_message(self, lead, idempotency_key, message_template=None):
            sent_messages.append(message_template)
            return ZaloResult(success=True, external_id=f"message-{len(sent_messages)}")

    monkeypatch.setattr(main_module, "ZaloAdapter", FakeZaloAdapter)
    monkeypatch.setattr(main_module.time, "sleep", lambda _: None)
    config = {
        "friend_request_message": "Xin chào, mình xin phép kết bạn.",
        "messages": ["Tin thử một", "Tin thử hai"],
    }
    with TestClient(app) as test_client:
        test_client.put(
            "/v1/config/zalo-automation",
            json=config,
            headers=auth_headers(),
        )
        response = test_client.post(
            "/v1/config/zalo-automation/test",
            json={"phone": "0912345678"},
            headers=auth_headers(),
        )

    assert response.status_code == 200
    assert response.json()["sent_count"] == 2
    assert response.json()["effective_recipient_last4"] == "2006"
    assert response.json()["message_ids"] == ["message-1", "message-2"]
    assert sent_messages == config["messages"]


def test_zalo_automation_test_accepts_any_non_empty_phone(monkeypatch):
    class FakeZaloAdapter:
        def __init__(self, settings):
            self.settings = settings

        def recipient_phone(self, lead):
            return lead.phone_raw

        def send_message(self, lead, idempotency_key, message_template=None):
            return ZaloResult(success=True, external_id="message-1")

    monkeypatch.setattr(main_module, "ZaloAdapter", FakeZaloAdapter)
    with TestClient(app) as test_client:
        test_client.put(
            "/v1/config/zalo-automation",
            json={"friend_request_message": "Xin chào", "messages": ["Tin thử"]},
            headers=auth_headers(),
        )
        response = test_client.post(
            "/v1/config/zalo-automation/test",
            json={"phone": "not-a-phone"},
            headers=auth_headers(),
        )

    assert response.status_code == 200
    assert response.json()["sent_count"] == 1
