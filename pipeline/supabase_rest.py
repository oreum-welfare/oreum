"""매일 확인 스크립트가 Supabase에서 운영 설정(감시 지역·감시 고시)을 읽는 작은 도우미.
SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 없거나 읽지 못하면 None → 각 스크립트의 기본값을 쓴다 (관리자 화면에서 바꾼 설정이 없을 때와 같음)."""
from __future__ import annotations

import os

import requests


def select(table: str, query: str) -> list[dict] | None:
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        return None
    headers = {"apikey": key}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    try:
        r = requests.get(f"{url}/rest/v1/{table}?{query}", headers=headers, timeout=30)
    except requests.RequestException:
        return None
    if not r.ok:  # 표가 아직 없으면(schema.sql 실행 전) 기본값으로
        return None
    data = r.json()
    return data if isinstance(data, list) else None
