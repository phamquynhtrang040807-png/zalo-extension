import base64
from typing import Any

import httpx

from app.config import Settings


class ZaloBridgeError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class PersonalZaloBridge:
    def __init__(self, settings: Settings):
        self.settings = settings

    def status(self) -> dict[str, Any]:
        response = self._request("GET", "/status")
        return self._json(response)

    def start_qr_login(self) -> dict[str, Any]:
        response = self._request("POST", "/login/qr")
        return self._json(response)

    def qr_image(self) -> dict[str, str]:
        response = self._request("GET", "/qr")
        content_type = response.headers.get("content-type", "image/png").split(";", 1)[0]
        encoded = base64.b64encode(response.content).decode("ascii")
        return {"image_data_url": f"data:{content_type};base64,{encoded}"}

    def _request(self, method: str, path: str) -> httpx.Response:
        if not self.settings.zalo_base_url:
            raise ZaloBridgeError("ZALO_BASE_URL is not configured", 503)
        url = f"{self.settings.zalo_base_url.rstrip('/')}/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self.settings.zalo_token}"}
        try:
            response = httpx.request(method, url, headers=headers, timeout=25)
        except httpx.RequestError as exc:
            raise ZaloBridgeError(f"Cannot connect to Zalo personal bridge: {exc}") from exc
        if response.is_success:
            return response
        data = self._json(response, raise_on_invalid=False)
        message = data.get("message") or data.get("error") or response.text[:500]
        raise ZaloBridgeError(str(message or "Zalo bridge request failed"), response.status_code)

    @staticmethod
    def _json(response: httpx.Response, raise_on_invalid: bool = True) -> dict[str, Any]:
        try:
            data = response.json()
        except ValueError as exc:
            if raise_on_invalid:
                raise ZaloBridgeError("Zalo bridge returned invalid JSON") from exc
            return {}
        if isinstance(data, dict):
            return data
        if raise_on_invalid:
            raise ZaloBridgeError("Zalo bridge returned an invalid response")
        return {}
