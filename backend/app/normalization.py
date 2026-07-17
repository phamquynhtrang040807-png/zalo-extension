import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


MULTIPLIERS = {
    "k": 1_000,
    "nghin": 1_000,
    "ngan": 1_000,
    "tr": 1_000_000,
    "trieu": 1_000_000,
    "m": 1_000_000,
    "ty": 1_000_000_000,
    "b": 1_000_000_000,
}


def _ascii(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def normalize_username(value: str) -> str:
    return value.strip().lstrip("@").lower()


def _decimal_from_localized(number: str, has_multiplier: bool) -> Decimal | None:
    cleaned = re.sub(r"[^0-9,.]", "", number)
    if not cleaned:
        return None

    if "," in cleaned and "." in cleaned:
        decimal_separator = "," if cleaned.rfind(",") > cleaned.rfind(".") else "."
        thousands_separator = "." if decimal_separator == "," else ","
        cleaned = cleaned.replace(thousands_separator, "").replace(decimal_separator, ".")
    elif "," in cleaned or "." in cleaned:
        separator = "," if "," in cleaned else "."
        right = cleaned.rsplit(separator, 1)[1]
        if has_multiplier or len(right) != 3:
            cleaned = cleaned.replace(separator, ".")
        else:
            cleaned = cleaned.replace(separator, "")

    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def normalize_metric(value: str | None) -> int | None:
    if not value:
        return None
    ascii_value = _ascii(value).lower().strip()
    match = re.search(r"([0-9][0-9.,\s]*)\s*(nghin|ngan|trieu|tr|ty|k|m|b)?", ascii_value)
    if not match:
        return None
    suffix = (match.group(2) or "").lower()
    number = _decimal_from_localized(match.group(1), bool(suffix))
    if number is None:
        return None
    multiplier = MULTIPLIERS.get(suffix, 1)
    return int(number * multiplier)


def normalize_gmv(value: str | None) -> int | None:
    return normalize_metric(value)


def normalize_followers(value: str | None) -> int | None:
    return normalize_metric(value)


@dataclass(frozen=True)
class NormalizedPhone:
    local: str
    e164: str


def normalize_vietnam_phone(value: str | None) -> NormalizedPhone | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if digits.startswith("0084"):
        digits = digits[2:]
    if digits.startswith("84"):
        national = digits[2:]
    elif digits.startswith("0"):
        national = digits[1:]
    else:
        national = digits

    # Current Vietnamese mobile numbers contain 9 digits after the country code.
    if len(national) != 9 or national[0] not in "35789":
        return None
    return NormalizedPhone(local=f"0{national}", e164=f"+84{national}")

