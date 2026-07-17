import httpx

from app.config import Settings
from app.models import Lead
from app.services.zalo import ZaloAdapter


def _settings(**overrides) -> Settings:
    values = {
        "zalo_enabled": True,
        "dry_run": False,
        "zalo_base_url": "https://zalo-api.example",
        "zalo_token": "test-token",
        "zalo_force_recipient_enabled": True,
        "zalo_force_recipient_phone": "0961382006",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _lead() -> Lead:
    return Lead(
        id="lead-1",
        username="creator_a",
        followers=1234,
        gmv_vnd=60_000_000,
        phone_e164="+84912345678",
    )


def test_force_recipient_redirects_invitation_and_message(monkeypatch):
    payloads = []

    def fake_post(url, json, headers, timeout):
        payloads.append(json)
        return httpx.Response(200, json={"message_id": "sent"})

    monkeypatch.setattr(httpx, "post", fake_post)
    adapter = ZaloAdapter(_settings())

    assert adapter.send_friend_request(_lead(), "invite-key").success
    assert adapter.send_message(_lead(), "message-key").success

    assert [payload["phone"] for payload in payloads] == [
        "+84961382006",
        "+84961382006",
    ]


def test_disabling_force_recipient_restores_lead_phone(monkeypatch):
    payloads = []

    def fake_post(url, json, headers, timeout):
        payloads.append(json)
        return httpx.Response(200, json={"message_id": "sent"})

    monkeypatch.setattr(httpx, "post", fake_post)
    adapter = ZaloAdapter(_settings(zalo_force_recipient_enabled=False))

    assert adapter.send_message(_lead(), "message-key").success
    assert payloads[0]["phone"] == "+84912345678"


def test_invalid_forced_recipient_fails_closed(monkeypatch):
    def unexpected_post(*args, **kwargs):
        raise AssertionError("Zalo API must not be called with an invalid safety target")

    monkeypatch.setattr(httpx, "post", unexpected_post)
    adapter = ZaloAdapter(_settings(zalo_force_recipient_phone="invalid"))

    result = adapter.send_message(_lead(), "message-key")

    assert not adapter.configured
    assert not result.success
    assert result.error_code == "invalid_forced_recipient"

