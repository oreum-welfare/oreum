"""새 중앙 고시 → AI가 바뀐 기준값 제안 → (검사 통과한 것만) rules.json에 반영할 초안 만들기

watch_notices.py가 저장한 새 고시(pipeline/notices/*.txt + 별표 PDF)를 Claude가 읽고,
그 고시가 정하는 rules.json 값(pipeline/notices.json의 keys)을 지금 값과 같은 모양으로 다시 적어 준다.
코드가 모양(항목·개수·숫자)을 검사하고, 지금 값과 다른 칸만 '바뀐 값'으로 뽑는다. AI가 계산식을 바꿀 수는 없다.

--apply 로 실행하면 검사를 통과한 값을 data/rules.json에 써서 PR로 올린다.
그래도 최종 결정은 사람: PR에서 원문과 대조하고, 시행일에 맞춰 합친다 (합치면 계산기에 바로 반영).

실행 예:
  $env:ANTHROPIC_API_KEY = "..."      # 또는 ant auth login
  python pipeline/propose_notice.py            # 제안만 (pipeline/notices/proposals/*.json)
  python pipeline/propose_notice.py --apply    # 제안 + rules.json 반영 + 요약에 표 추가
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RULES = ROOT / "data" / "rules.json"
CONFIG = HERE / "notices.json"
NOTICE_DIR, PROPOSAL_DIR = HERE / "notices", HERE / "notices" / "proposals"
STATE_DIR = HERE / "state"
TRIES, SUMMARY = STATE_DIR / "notice_tries.json", STATE_DIR / "notice_summary.md"
MODEL = "claude-opus-5-5"
MAX_TRIES = 3
MAX_PDF_BYTES = 15 * 1024 * 1024

SYSTEM = """당신은 한국 사회보장 고시에서 계산 기준값을 옮겨 적는 검토 보조자입니다.
고시 원문(본문·별표 글, 첨부 PDF)을 읽고, 주어진 '지금 값'과 같은 모양으로 이 고시의 값을 다시 적습니다.

규칙:
1. 원문에 적힌 숫자만 씁니다. 계산하거나 추정하거나 지난해 값을 그대로 두지 마세요.
2. value_json은 '지금 값'과 똑같은 JSON 모양(같은 키, 같은 개수)으로 씁니다. 단위는 지금 값과 같게(원, 월/연, 비율은 소수).
3. 원문에서 확실히 읽을 수 없는 값(이미지·HWP만 있고 PDF에도 없는 표 등)은 그 키를 items에 넣지 말고 unreadable에 적습니다.
4. evidence에는 근거 구절이나 표의 행·열을 그대로, location에는 조·별표 번호를 적습니다.
5. 이 고시가 주어진 값과 관련이 없으면 related=false로 하고 items는 비웁니다.
6. effective_date에는 원문의 시행일(YYYY-MM-DD)을 적습니다."""


def get_path(d: dict, path: str):
    for p in path.split("."):
        d = d[p]
    return d


def set_path(d: dict, path: str, value) -> None:
    *head, last = path.split(".")
    for p in head:
        d = d[p]
    d[last] = value


def same_shape(a, b) -> bool:
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(same_shape(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(same_shape(x, y) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b)
    if isinstance(a, (int, float)):
        return isinstance(b, (int, float)) and b >= 0
    return type(a) is type(b)


def diff(a, b, prefix: str = "") -> list[tuple[str, object, object]]:
    if isinstance(a, dict):
        return [x for k in a for x in diff(a[k], b[k], f"{prefix}.{k}" if prefix else k)]
    if isinstance(a, list):
        return [x for i, (p, q) in enumerate(zip(a, b)) for x in diff(p, q, f"{prefix}[{i}]")]
    return [] if a == b else [(prefix, a, b)]


def schema(keys: list[str]) -> dict:
    item = {"type": "object", "additionalProperties": False, "required": ["key", "value_json", "evidence", "location"],
            "properties": {"key": {"type": "string", "enum": keys}, "value_json": {"type": "string"},
                           "evidence": {"type": "string"}, "location": {"type": "string"}}}
    return {"type": "object", "additionalProperties": False,
            "required": ["related", "effective_date", "items", "unreadable", "notes"],
            "properties": {"related": {"type": "boolean"}, "effective_date": {"type": "string"},
                           "items": {"type": "array", "items": item}, "unreadable": {"type": "string"}, "notes": {"type": "string"}}}


def pdf_blocks(urls: list[str]) -> list[dict]:
    blocks = []
    for u in urls[:4]:
        if not u.startswith("https://www.law.go.kr/"):
            continue  # 국가법령정보센터 파일만
        try:
            r = requests.get(u, timeout=60)
        except requests.RequestException:
            continue
        if r.ok and r.content[:4] == b"%PDF" and len(r.content) <= MAX_PDF_BYTES:
            blocks.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                           "data": base64.standard_b64encode(r.content).decode()}})
    return blocks


def propose(client, stem: str, rules: dict, hints: dict) -> dict:
    meta = json.loads((NOTICE_DIR / f"{stem}.json").read_text(encoding="utf-8"))
    hint = hints.get(meta["notice"], "")
    text = (NOTICE_DIR / f"{stem}.txt").read_text(encoding="utf-8")
    current = {k: get_path(rules, k) for k in meta["keys"]}
    pdfs = pdf_blocks(meta.get("table_pdfs", []))
    msg = (f"고시: {meta['name']} (발령 {meta['issued']} {meta['number']}, 시행 {meta['effective']})\n"
           f"값 설명: {hint}\n\n지금 값 (이 모양 그대로 새 값을 적으세요):\n{json.dumps(current, ensure_ascii=False, indent=1)}\n\n"
           f"<원문>\n{text}\n</원문>\n" + (f"\n별표 PDF {len(pdfs)}개를 함께 첨부했습니다." if pdfs else "\n별표 PDF는 받지 못했습니다."))
    response = client.beta.messages.create(
        model=MODEL, max_tokens=16000,
        system=[{"type": "text", "text": SYSTEM}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema(meta["keys"])}},
        messages=[{"role": "user", "content": [*pdfs, {"type": "text", "text": msg}]}],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"AI 응답 중단: {response.stop_reason}")
    out = json.loads(next(b.text for b in response.content if b.type == "text"))

    # AI 제안을 그대로 믿지 않는다: 모양이 같고 숫자인 것만, 지금 값과 다른 칸만 뽑는다
    checked, rejected = [], []
    for it in out["items"]:
        try:
            new = json.loads(it["value_json"])
        except json.JSONDecodeError:
            rejected.append(f"{it['key']}: JSON 형식 오류")
            continue
        cur = current[it["key"]]
        if not same_shape(cur, new):
            rejected.append(f"{it['key']}: 지금 값과 모양이 다름")
            continue
        changes = diff(cur, new, it["key"])
        checked.append({"key": it["key"], "value": new, "changes": changes, "evidence": it["evidence"], "location": it["location"]})
    result = {"stem": stem, "notice": meta, "model": response.model, "related": out["related"],
              "effective_date": out["effective_date"], "items": checked, "rejected": rejected,
              "unreadable": out["unreadable"], "notes": out["notes"]}
    PROPOSAL_DIR.mkdir(parents=True, exist_ok=True)
    (PROPOSAL_DIR / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return result


def pending() -> list[str]:
    return [p.stem for p in sorted(NOTICE_DIR.glob("*.txt")) if not (PROPOSAL_DIR / f"{p.stem}.json").exists()]


def fmt(v) -> str:
    return f"{v:,}" if isinstance(v, int) else str(v)


def main() -> None:
    ap = argparse.ArgumentParser(description="새 고시 → AI가 바뀐 기준값 제안")
    ap.add_argument("--apply", action="store_true", help="검사를 통과한 값을 data/rules.json에 반영")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    hints = {n["key"]: n.get("hint", "") for n in json.loads(CONFIG.read_text(encoding="utf-8"))["notices"]}
    tries = json.loads(TRIES.read_text(encoding="utf-8")) if TRIES.exists() else {}
    todo = [s for s in pending() if tries.get(s, 0) < MAX_TRIES]
    if not todo:
        print("제안할 새 고시 없음")
        return

    import anthropic
    client = anthropic.Anthropic()
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    results, failed = [], []
    for stem in todo:
        tries[stem] = tries.get(stem, 0) + 1
        try:
            results.append(propose(client, stem, rules, hints))
            print(f"[{stem}] 제안 완료")
        except (anthropic.APIError, RuntimeError, json.JSONDecodeError, KeyError) as e:
            failed.append(f"{stem} ({type(e).__name__})")
            print(f"[{stem}] 실패: {type(e).__name__}")
        time.sleep(1)
    STATE_DIR.mkdir(exist_ok=True)
    TRIES.write_text(json.dumps(tries, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    lines = []
    for r in results:
        n = r["notice"]
        lines += ["", f"### {n['name']} (시행 {r['effective_date'] or n['effective']})"]
        if not r["related"]:
            lines.append("AI 판단: 오름 계산 값과 관련 없는 개정이에요. 값은 바꾸지 않았어요.")
        changes = [c for it in r["items"] for c in it["changes"]]
        if changes:
            lines += ["", "| 값 | 지금 | 새 고시 (AI 판독) |", "|---|---|---|"]
            lines += [f"| `{p}` | {fmt(a)} | **{fmt(b)}** |" for p, a, b in changes]
            lines += ["", "근거: " + " / ".join(f"`{it['key']}` {it['location']}: {it['evidence'][:200]}" for it in r["items"] if it["changes"])]
        elif r["related"] and r["items"] and not r["rejected"]:
            lines.append("AI가 읽은 값이 지금 값과 같아요.")
        if r["unreadable"]:
            lines.append(f"⚠️ AI가 읽지 못한 값 (사람이 원문에서 확인): {r['unreadable']}")
        if r["rejected"]:
            lines.append("⚠️ 검사에서 걸러낸 제안: " + "; ".join(r["rejected"]))
        if args.apply:
            for it in r["items"]:
                if it["changes"]:
                    set_path(rules, it["key"], it["value"])
    if failed:
        lines += ["", f"AI 제안 실패 (다음 실행 때 다시, {MAX_TRIES}번까지): " + ", ".join(failed)]
    if args.apply and any(it["changes"] for r in results for it in r["items"]):
        RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        lines += ["", "위 값을 `data/rules.json`에 반영했어요. **합치기 전에**: 원문 대조, `value_checks.csv`·`verification` 갱신, "
                  "테스트 기대값(`tests/engine_checks.mjs` 등) 확인. 합치는 순간 계산기에 반영되니 시행일에 맞춰 합쳐 주세요."]
    with SUMMARY.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"완료: 제안 {len(results)}건, 실패 {len(failed)}건")


if __name__ == "__main__":
    main()
