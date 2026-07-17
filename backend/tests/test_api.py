import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import OutboxTask, TaskType


client = TestClient(app)


def auth_headers():
    return {"Authorization": f"Bearer {get_settings().api_token}"}


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
    assert response.json()["action"] == "queued"
    assert response.json()["lead_id"] is not None


def test_queues_eligible_lead_and_exposes_job():
    with TestClient(app) as test_client:
        response = test_client.post("/v1/captures", json=payload(), headers=auth_headers())
        assert response.status_code == 200
        body = response.json()
        assert body["action"] == "queued"
        job = test_client.get(f"/v1/jobs/{body['job_id']}", headers=auth_headers())
    assert job.status_code == 200
    assert job.json()["zalo_invite_status"] == "pending"


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
    assert response.json()["action"] == "queued"
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
