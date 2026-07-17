"""Local smoke test for API + worker. Runs with Sheets disabled and Zalo dry-run."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "http://127.0.0.1:8765"
TOKEN = "e2e-test-token"


def main() -> int:
    env = os.environ.copy()
    env.update(
        {
            "API_TOKEN": TOKEN,
            "DATABASE_URL": "sqlite:///./data/e2e.db",
            "GOOGLE_SHEETS_ENABLED": "false",
            "ZALO_ENABLED": "false",
            "DRY_RUN": "true",
            "ZALO_RATE_LIMIT_PER_MINUTE": "600",
        }
    )
    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    worker = subprocess.Popen(
        [sys.executable, "-m", "app.worker"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_api()
        headers = {"Authorization": f"Bearer {TOKEN}"}
        payload = {
            "source": "tiktok_shop",
            "profile_id": str(uuid.uuid4()),
            "username": "e2e_creator",
            "display_name": "E2E Creator",
            "followers_raw": "12,2K",
            "gmv_raw": "718,5 Tr đ",
            "phone_raw": "0912345678",
            "reporting_period": "15 tháng 6 2026 - 15 tháng 7 2026",
            "profile_url": "https://affiliate.tiktok.com/creator/e2e",
        }
        response = httpx.post(
            f"{BASE_URL}/v1/captures", headers=headers, json=payload, timeout=5
        )
        response.raise_for_status()
        capture = response.json()
        job = wait_for_job(capture["job_id"], headers)
        expected = ("completed", "completed", "completed")
        actual = (
            job["sheet_status"],
            job["zalo_invite_status"],
            job["zalo_message_status"],
        )
        if actual != expected:
            raise RuntimeError(f"Unexpected final states: {actual}; error={job.get('last_error')}")
        duplicate = httpx.post(
            f"{BASE_URL}/v1/captures", headers=headers, json=payload, timeout=5
        )
        duplicate.raise_for_status()
        if duplicate.json()["action"] != "duplicate_completed":
            raise RuntimeError(f"Duplicate protection failed: {duplicate.json()}")
        print(
            f"E2E OK: action={capture['action']}, sheet={actual[0]}, "
            f"invite={actual[1]}, message={actual[2]}, duplicate=blocked"
        )
        return 0
    finally:
        for process in (api, worker):
            process.terminate()
        for process in (api, worker):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def wait_for_api() -> None:
    for _ in range(40):
        try:
            if httpx.get(f"{BASE_URL}/health", timeout=1).status_code == 200:
                return
        except httpx.RequestError:
            pass
        time.sleep(0.25)
    raise RuntimeError("API did not become ready")


def wait_for_job(job_id: str, headers: dict[str, str]) -> dict[str, object]:
    for _ in range(80):
        response = httpx.get(f"{BASE_URL}/v1/jobs/{job_id}", headers=headers, timeout=2)
        response.raise_for_status()
        job = response.json()
        if all(
            job[key] == "completed"
            for key in ("sheet_status", "zalo_invite_status", "zalo_message_status")
        ):
            return job
        time.sleep(0.25)
    return job


if __name__ == "__main__":
    raise SystemExit(main())
