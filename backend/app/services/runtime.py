import json

from sqlalchemy.orm import Session

from app.models import RuntimeSetting


ZALO_PAUSED_KEY = "zalo_paused"
ZALO_AUTOMATION_CONFIG_KEY = "zalo_automation_config"


def is_zalo_paused(db: Session) -> bool:
    setting = db.get(RuntimeSetting, ZALO_PAUSED_KEY)
    return bool(setting and setting.value.lower() == "true")


def set_zalo_paused(db: Session, paused: bool) -> None:
    setting = db.get(RuntimeSetting, ZALO_PAUSED_KEY)
    if setting:
        setting.value = "true" if paused else "false"
    else:
        db.add(RuntimeSetting(key=ZALO_PAUSED_KEY, value="true" if paused else "false"))
    db.commit()


def get_zalo_automation_config(
    db: Session,
    default_friend_request_message: str,
    default_message: str,
) -> dict[str, object]:
    raw = get_runtime_setting(db, ZALO_AUTOMATION_CONFIG_KEY)
    if raw:
        try:
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ValueError("Automation config must be an object")
            friend_request_message = parsed.get("friend_request_message")
            messages = parsed.get("messages")
            if (
                isinstance(friend_request_message, str)
                and friend_request_message.strip()
                and len(friend_request_message.strip()) <= 500
                and isinstance(messages, list)
                and len(messages) <= 20
                and all(isinstance(message, str) and message.strip() for message in messages)
                and all(len(message.strip()) <= 5000 for message in messages)
            ):
                return {
                    "friend_request_message": friend_request_message.strip(),
                    "messages": [message.strip() for message in messages],
                }
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return {
        "friend_request_message": default_friend_request_message,
        "messages": [default_message] if default_message.strip() else [],
    }


def set_zalo_automation_config(
    db: Session,
    friend_request_message: str,
    messages: list[str],
) -> None:
    set_runtime_setting(
        db,
        ZALO_AUTOMATION_CONFIG_KEY,
        json.dumps(
            {
                "friend_request_message": friend_request_message,
                "messages": messages,
            },
            ensure_ascii=False,
        ),
    )


def get_runtime_setting(db: Session, key: str) -> str | None:
    setting = db.get(RuntimeSetting, key)
    return setting.value if setting else None


def set_runtime_setting(db: Session, key: str, value: str) -> None:
    setting = db.get(RuntimeSetting, key)
    if setting:
        setting.value = value
    else:
        db.add(RuntimeSetting(key=key, value=value))
    db.commit()


def delete_runtime_setting(db: Session, key: str) -> None:
    setting = db.get(RuntimeSetting, key)
    if setting:
        db.delete(setting)
        db.commit()
