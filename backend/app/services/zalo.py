from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.models import Lead
from app.normalization import normalize_vietnam_phone


@dataclass(frozen=True)
class ZaloResult:
    success: bool
    retryable: bool = False
    external_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class ZaloAdapter:
    """Generic adapter. Adjust payload/response mapping after receiving the real API spec."""

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        if self.settings.dry_run:
            return True
        forced_recipient_ok = (
            not self.settings.zalo_force_recipient_enabled
            or normalize_vietnam_phone(self.settings.zalo_force_recipient_phone) is not None
        )
        return bool(
            self.settings.zalo_enabled
            and self.settings.zalo_base_url
            and self.settings.zalo_token
            and forced_recipient_ok
        )

    def send_friend_request(
        self,
        lead: Lead,
        idempotency_key: str,
        message_template: str | None = None,
    ) -> ZaloResult:
        if self.settings.dry_run:
            return ZaloResult(success=True, external_id=f"dry-invite-{lead.id}")
        if not self.settings.zalo_enabled:
            return ZaloResult(success=False, error_code="disabled", error_message="Zalo is disabled")
        recipient = self.recipient_phone(lead)
        if recipient is None:
            return self._invalid_forced_recipient_result()
        return self._post(
            self.settings.zalo_invite_path,
            {
                "phone": recipient,
                "message": self._render_message(
                    message_template or self.settings.zalo_friend_request_message,
                    lead,
                ),
                "idempotency_key": idempotency_key,
            },
            idempotency_key,
        )

    def send_message(
        self,
        lead: Lead,
        idempotency_key: str,
        message_template: str | None = None,
    ) -> ZaloResult:
        if self.settings.dry_run:
            return ZaloResult(success=True, external_id=f"dry-message-{lead.id}")
        if not self.settings.zalo_enabled:
            return ZaloResult(success=False, error_code="disabled", error_message="Zalo is disabled")
        recipient = self.recipient_phone(lead)
        if recipient is None:
            return self._invalid_forced_recipient_result()
        message = self._render_message(
            message_template or self.settings.zalo_message_template,
            lead,
        )
        return self._post(
            self.settings.zalo_message_path,
            {
                "phone": recipient,
                "message": message,
                "idempotency_key": idempotency_key,
            },
            idempotency_key,
        )

    @staticmethod
    def _render_message(template: str, lead: Lead) -> str:
        replacements = {
            "{username}": lead.username,
            "{display_name}": lead.display_name or lead.username,
            "{followers}": str(lead.followers or 0),
            "{gmv}": str(lead.gmv_vnd),
        }
        message = template
        for placeholder, value in replacements.items():
            message = message.replace(placeholder, value)
        return message

    def recipient_phone(self, lead: Lead) -> str | None:
        if not self.settings.zalo_force_recipient_enabled:
            return lead.phone_e164 or (lead.phone_raw.strip() if lead.phone_raw else None)
        forced = normalize_vietnam_phone(self.settings.zalo_force_recipient_phone)
        return forced.e164 if forced else None

    @staticmethod
    def _invalid_forced_recipient_result() -> ZaloResult:
        # Fail closed: never fall back to the lead's phone when the safety target is invalid.
        return ZaloResult(
            success=False,
            error_code="invalid_forced_recipient",
            error_message="ZALO_FORCE_RECIPIENT_PHONE is not a valid Vietnamese mobile number",
        )

    def _post(self, path: str, payload: dict[str, Any], idempotency_key: str) -> ZaloResult:
        url = f"{self.settings.zalo_base_url.rstrip('/')}/{path.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {self.settings.zalo_token}",
            "Idempotency-Key": idempotency_key,
            "Content-Type": "application/json",
        }
        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=20)
        except httpx.RequestError as exc:
            return ZaloResult(
                success=False,
                retryable=True,
                error_code="network_error",
                error_message=str(exc),
            )

        data = _json_or_empty(response)
        if 200 <= response.status_code < 300 and data.get("success", True) is not False:
            external_id = data.get("id") or data.get("request_id") or data.get("message_id")
            return ZaloResult(success=True, external_id=str(external_id) if external_id else None)

        retryable = response.status_code == 429 or response.status_code >= 500
        return ZaloResult(
            success=False,
            retryable=retryable,
            error_code=str(data.get("error_code") or response.status_code),
            error_message=str(data.get("message") or data.get("error") or response.text[:500]),
        )


def _json_or_empty(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}
