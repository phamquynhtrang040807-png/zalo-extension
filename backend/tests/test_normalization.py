import pytest

from app.normalization import (
    normalize_followers,
    normalize_gmv,
    normalize_username,
    normalize_vietnam_phone,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("12,2K", 12_200),
        ("12.2K", 12_200),
        ("1.234", 1_234),
        ("1,234", 1_234),
        ("1,2 Tr", 1_200_000),
    ],
)
def test_normalize_followers(raw, expected):
    assert normalize_followers(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("718,5 Tr đ", 718_500_000),
        ("50 Tr", 50_000_000),
        ("1,25 Tỷ", 1_250_000_000),
        ("49.999.999 đ", 49_999_999),
        ("50,000,000 VND", 50_000_000),
    ],
)
def test_normalize_gmv(raw, expected):
    assert normalize_gmv(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "không có"])
def test_invalid_metric(raw):
    assert normalize_gmv(raw) is None


@pytest.mark.parametrize(
    ("raw", "local", "e164"),
    [
        ("0912 345 678", "0912345678", "+84912345678"),
        ("+84 912.345.678", "0912345678", "+84912345678"),
        ("84912345678", "0912345678", "+84912345678"),
        ("963263987", "0963263987", "+84963263987"),
    ],
)
def test_normalize_phone(raw, local, e164):
    result = normalize_vietnam_phone(raw)
    assert result is not None
    assert result.local == local
    assert result.e164 == e164


def test_reject_invalid_phone():
    assert normalize_vietnam_phone("01234") is None


def test_normalize_username():
    assert normalize_username(" @QuynhAnh_Lee ") == "quynhanh_lee"
