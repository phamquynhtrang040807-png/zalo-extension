import secrets

from fastapi import Header, HTTPException, status

from app.config import get_settings


def require_api_token(authorization: str | None = Header(default=None)) -> None:
    expected = get_settings().api_token
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API token",
            headers={"WWW-Authenticate": "Bearer"},
        )

