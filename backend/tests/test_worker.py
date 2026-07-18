from app import worker
from app.db import SessionLocal
from app.models import Lead
from app.services.runtime import set_zalo_automation_config
from app.services.zalo import ZaloResult


def test_worker_sends_every_configured_message_with_its_own_idempotency_key(monkeypatch):
    calls: list[tuple[str, str]] = []

    class FakeZaloAdapter:
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

