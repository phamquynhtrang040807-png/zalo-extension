import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.config import Settings
from app.models import Lead


HEADERS = [
    "STT",
    "",
    "Người liên hệ",
    "FOLLOWER",
    "GMV",
    "SĐT",
]


@dataclass(frozen=True)
class SheetResult:
    row: int | None


@dataclass(frozen=True)
class SheetDiagnostic:
    connected: bool
    spreadsheet_title: str
    target_sheet_name: str
    target_sheet_found: bool
    available_sheets: list[str]
    read_ok: bool
    write_ok: bool
    message: str


class GoogleSheetsAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._service = None

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.google_sheets_enabled
            and self.settings.google_spreadsheet_id
            and self.auth_configured
        )

    @property
    def auth_configured(self) -> bool:
        if self.settings.google_auth_mode.lower() == "oauth":
            return Path(self.settings.google_oauth_token_file).is_file()
        return Path(self.settings.google_service_account_file).is_file()

    def _credentials(self):
        if self.settings.google_auth_mode.lower() == "oauth":
            token_path = Path(self.settings.google_oauth_token_file)
            if not token_path.is_file():
                raise ValueError("Chưa cấp quyền Google OAuth; hãy bấm Kết nối Google trước")
            credentials = Credentials.from_authorized_user_file(
                token_path,
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
            if credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())
                token_path.write_text(credentials.to_json(), encoding="utf-8")
            if not credentials.valid:
                raise ValueError("Google OAuth token không hợp lệ hoặc đã bị thu hồi")
            return credentials
        credential_path = Path(self.settings.google_service_account_file)
        if not credential_path.is_file():
            raise ValueError(f"Không tìm thấy service account file: {credential_path}")
        return service_account.Credentials.from_service_account_file(
            credential_path,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )

    def _spreadsheet_api(self):
        if self._service is None:
            self._service = build(
                "sheets", "v4", credentials=self._credentials(), cache_discovery=False
            )
        return self._service.spreadsheets()

    def _client(self):
        return self._spreadsheet_api().values()

    def diagnose(self, write_test: bool = True) -> SheetDiagnostic:
        if not self.settings.google_spreadsheet_id:
            raise ValueError("Thiếu GOOGLE_SPREADSHEET_ID; cần ID trong URL của file Google Sheet")
        spreadsheet_api = self._spreadsheet_api()
        metadata = spreadsheet_api.get(
            spreadsheetId=self.settings.google_spreadsheet_id,
            fields="properties(title),sheets(properties(sheetId,title))",
        ).execute()
        spreadsheet_title = metadata.get("properties", {}).get("title", "")
        sheet_properties = [sheet.get("properties", {}) for sheet in metadata.get("sheets", [])]
        available_sheets = [str(props.get("title", "")) for props in sheet_properties]
        target_found = self.settings.google_sheet_name in available_sheets
        write_ok = not write_test

        if write_test:
            temporary_title = f"_AutoZalo_Check_{uuid.uuid4().hex[:8]}"
            temporary_sheet_id = None
            try:
                created = spreadsheet_api.batchUpdate(
                    spreadsheetId=self.settings.google_spreadsheet_id,
                    body={"requests": [{"addSheet": {"properties": {"title": temporary_title}}}]},
                ).execute()
                temporary_sheet_id = created["replies"][0]["addSheet"]["properties"]["sheetId"]
                marker = f"Auto Zalo connection test {datetime.now(timezone.utc).isoformat()}"
                values = spreadsheet_api.values()
                values.update(
                    spreadsheetId=self.settings.google_spreadsheet_id,
                    range=f"'{temporary_title}'!A1",
                    valueInputOption="RAW",
                    body={"values": [[marker]]},
                ).execute()
                read_back = values.get(
                    spreadsheetId=self.settings.google_spreadsheet_id,
                    range=f"'{temporary_title}'!A1",
                ).execute()
                write_ok = read_back.get("values", [[None]])[0][0] == marker
            finally:
                if temporary_sheet_id is not None:
                    spreadsheet_api.batchUpdate(
                        spreadsheetId=self.settings.google_spreadsheet_id,
                        body={"requests": [{"deleteSheet": {"sheetId": temporary_sheet_id}}]},
                    ).execute()

        connected = bool(target_found and write_ok)
        if not target_found:
            message = (
                f"Đã truy cập file nhưng không tìm thấy tab '{self.settings.google_sheet_name}'. "
                "GOOGLE_SHEET_NAME phải là tên tab phía dưới, không phải tên file."
            )
        elif not write_ok:
            message = "Đọc được file nhưng kiểm tra quyền ghi thất bại"
        else:
            message = "Kết nối Google Sheet và quyền đọc/ghi đều thành công"
        return SheetDiagnostic(
            connected=connected,
            spreadsheet_title=spreadsheet_title,
            target_sheet_name=self.settings.google_sheet_name,
            target_sheet_found=target_found,
            available_sheets=available_sheets,
            read_ok=True,
            write_ok=write_ok,
            message=message,
        )

    def _row_values(self, lead: Lead, sequence: int) -> list[object]:
        zalo_value = lead.phone_local or lead.phone_raw or ""
        return [
            sequence,
            "",
            lead.username,
            lead.followers_raw or "",
            lead.gmv_raw,
            f"'{zalo_value}" if zalo_value else "",
        ]

    def insert_lead(self, lead: Lead) -> SheetResult:
        if not self.configured:
            return SheetResult(row=None)

        values_api = self._client()
        spreadsheet_id = self.settings.google_spreadsheet_id
        sheet = _quote_sheet(self.settings.google_sheet_name)

        self._ensure_headers(values_api, spreadsheet_id, sheet)
        sequence = self._next_sequence(values_api, spreadsheet_id, sheet)
        target_row = self._next_insert_row(values_api, spreadsheet_id, sheet)
        values_api.update(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet}!A{target_row}:F{target_row}",
            valueInputOption="USER_ENTERED",
            body={"values": [self._row_values(lead, sequence)]},
        ).execute()
        return SheetResult(row=target_row)

    def _ensure_headers(self, values_api, spreadsheet_id: str, sheet: str) -> None:
        response = values_api.get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet}!A1:F1",
        ).execute()
        current = (response.get("values") or [[]])[0]
        current = current + [""] * (len(HEADERS) - len(current))
        if current[: len(HEADERS)] == HEADERS:
            return
        values_api.update(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet}!A1:F1",
            valueInputOption="RAW",
            body={"values": [HEADERS]},
        ).execute()

    def _next_sequence(self, values_api, spreadsheet_id: str, sheet: str) -> int:
        response = values_api.get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet}!A2:A",
        ).execute()
        highest = 0
        for row in response.get("values", []):
            if not row:
                continue
            try:
                value = int(str(row[0]).strip())
            except (TypeError, ValueError):
                continue
            highest = max(highest, value)
        return highest + 1

    def _next_insert_row(self, values_api, spreadsheet_id: str, sheet: str) -> int:
        response = values_api.get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet}!A2:F",
        ).execute()
        last_data_row = 1
        for row_number, row in enumerate(response.get("values", []), start=2):
            if any(str(value).strip() for value in row):
                last_data_row = row_number
        return last_data_row + 1


def _quote_sheet(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"
