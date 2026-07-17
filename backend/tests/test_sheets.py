from datetime import datetime, timezone
from types import SimpleNamespace

from app.models import Lead
from app.services.sheets import GoogleSheetsAdapter, HEADERS


def make_lead() -> Lead:
    now = datetime.now(timezone.utc)
    return Lead(
        profile_key="username:hoalela1102",
        username="hoalela1102",
        profile_url="https://example.invalid/creator",
        followers_raw="43,8K",
        followers=43_800,
        gmv_raw="12,3 Tr đ",
        gmv_vnd=12_300_000,
        phone_local="0946475991",
        captured_at=now,
        updated_at=now,
    )


def test_sheet_mapping_uses_six_expected_columns():
    adapter = GoogleSheetsAdapter.__new__(GoogleSheetsAdapter)

    assert HEADERS == ["STT", "", "Người liên hệ", "FOLLOWER", "GMV", "SĐT"]
    assert adapter._row_values(make_lead(), 7) == [
        7,
        "",
        "hoalela1102",
        "43,8K",
        "12,3 Tr đ",
        "'0946475991",
    ]


def test_sheet_keeps_non_standard_zalo_value():
    adapter = GoogleSheetsAdapter.__new__(GoogleSheetsAdapter)
    lead = make_lead()
    lead.phone_local = None
    lead.phone_raw = "zalo-id_creator"

    assert adapter._row_values(lead, 1)[5] == "'zalo-id_creator"


class FakeValuesApi:
    def __init__(self, values):
        self.values = values

    def get(self, **_kwargs):
        return self

    def execute(self):
        return {"values": self.values}


def test_next_sequence_ignores_headers_and_non_numeric_old_values():
    adapter = GoogleSheetsAdapter.__new__(GoogleSheetsAdapter)
    api = FakeValuesApi([["1"], ["username-from-old-mapping"], ["4"], []])

    assert adapter._next_sequence(api, "spreadsheet", "'Sheet'") == 5


def test_next_insert_row_stays_after_the_last_populated_record():
    adapter = GoogleSheetsAdapter.__new__(GoogleSheetsAdapter)
    api = FakeValuesApi([["1", "", "first"], [], ["3", "", "third"]])

    assert adapter._next_insert_row(api, "spreadsheet", "'Sheet'") == 5


class ExecuteResult:
    def __init__(self, result):
        self.result = result

    def execute(self):
        return self.result


class RecordingValuesApi:
    def __init__(self):
        self.updated = []

    def get(self, **kwargs):
        if kwargs["range"].endswith("A1:F1"):
            return ExecuteResult({"values": [HEADERS]})
        return ExecuteResult({"values": [["3"]]})

    def update(self, **kwargs):
        self.updated.append(kwargs)
        return ExecuteResult({})


def test_insert_ignores_existing_sheet_row_and_always_appends(monkeypatch):
    values_api = RecordingValuesApi()
    adapter = GoogleSheetsAdapter.__new__(GoogleSheetsAdapter)
    adapter.settings = SimpleNamespace(google_spreadsheet_id="spreadsheet", google_sheet_name="Sheet")
    adapter._client = lambda: values_api
    monkeypatch.setattr(GoogleSheetsAdapter, "configured", property(lambda _self: True))
    lead = make_lead()
    lead.sheet_row = 99

    result = adapter.insert_lead(lead)

    assert result.row == 3
    assert len(values_api.updated) == 1
    assert values_api.updated[0]["range"] == "'Sheet'!A3:F3"
    assert values_api.updated[0]["body"]["values"][0][2] == "hoalela1102"
