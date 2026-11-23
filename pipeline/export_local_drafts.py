"""AI가 변환한 지자체 서비스 규칙을 '검토 대기' 초안으로 내보낸다 (관리자 화면 지자체 제도 검토용).

입력: pipeline/raw/{t,n,u}*.txt (원문, '# 제공주체:'로 지역 확인. u_* = 매일 변경 확인에서 잡힌 새 제도·바뀐 제도)
      pipeline/runs_watch_rules/*.json (매일 변경 확인) → runs_v3_gpt5_rules/*.json (3차 프롬프트) → runs_test_gpt5_rules/*.json (2차)
출력: pipeline/local_drafts.json (oreum-web의 npm run sync-data가 public/data로 복사)

초안은 계산에 쓰지 않는다. 해당 지자체 담당자가 원문과 대조해 승인한 것만 계산에 들어간다.
실행: python pipeline/export_local_drafts.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
RUNS = [("자동 수집", PIPE / "runs_watch_rules"), ("3차", PIPE / "runs_v3_gpt5_rules"), ("2차", PIPE / "runs_test_gpt5_rules")]
KIND = {"cash": "cash", "inkind": "inkind", "loan": "access", "none": "access"}


def header(text: str, key: str) -> str:
    m = re.search(rf"^# {key}:\s*(.+)$", text, re.M)
    return m.group(1).strip() if m else ""


def amount_of(b: dict) -> dict:
    """AI가 계산식을 만들었으면 계산식 금액(관리자 화면이 문법·예시 계산으로 다시 검사), 아니면 고정 월 금액"""
    f = b.get("formula") or {}
    if str(f.get("expr") or "").strip():
        try:
            tables = json.loads(f.get("tables_json") or "{}")
        except json.JSONDecodeError:
            tables = {}
        return {"type": "formula", "expr": f["expr"].strip(), "tables": tables if isinstance(tables, dict) else {},
                "unit": f.get("unit") or "monthly", "explanation": f.get("explanation", ""), "monthly": int(b.get("monthly_amount_won") or 0)}
    return {"type": "fixed", "monthly": int(b.get("monthly_amount_won") or 0)}


def main() -> None:
    regions = json.loads((ROOT / "data" / "rules.json").read_text(encoding="utf-8"))["regions"]
    drafts = []
    for raw in sorted((PIPE / "raw").glob("[tnu]*.txt")):
        sid = raw.stem
        text = raw.read_text(encoding="utf-8")
        region = header(text, "제공주체")
        if region not in regions:
            continue
        ai, version = None, ""
        for ver, folder in RUNS:
            f = folder / f"{sid}.json"
            if f.exists():
                ai, version = json.loads(f.read_text(encoding="utf-8")), ver
                break
        if not ai:
            continue
        b = ai.get("benefit", {})
        drafts.append({
            "id": f"ai_{sid}",
            "name": ai.get("service_name") or header(text, "서비스명"),
            "region": region,
            "kind": KIND.get(b.get("type"), "access"),
            "conditions": ai.get("conditions", []),
            "amount": amount_of(b),
            "amount_text": b.get("amount_text", ""),
            "note": b.get("amount_text", ""),
            "status": "검토 대기",
            "source": header(text, "출처"),
            "origin": {"type": "ai", "model": ai.get("_meta", {}).get("model") or "gpt-5-2025-08-07", "prompt": version, "service_id": sid,
                       "judgeable": ai.get("judgeable", True), "not_judgeable_reason": ai.get("not_judgeable_reason", "")},
            "text": re.sub(r"^#.*\n", "", text, flags=re.M).strip(),
        })
    out = PIPE / "local_drafts.json"
    out.write_text(json.dumps({"note": "AI 초안 (계산에 쓰지 않음). 담당자 승인 후에만 반영", "drafts": drafts},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    by = {}
    for d in drafts:
        by[d["region"]] = by.get(d["region"], 0) + 1
    print(f"초안 {len(drafts)}건 저장: {by}")


if __name__ == "__main__":
    main()
