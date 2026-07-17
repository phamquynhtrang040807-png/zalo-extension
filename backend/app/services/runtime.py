from sqlalchemy.orm import Session

from app.models import RuntimeSetting


ZALO_PAUSED_KEY = "zalo_paused"


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
