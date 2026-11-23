"""새 중앙 고시 → AI가 바뀐 기준값 제안 → (검사 통과한 것만) 관리자 화면 '검토 대기'

watch_notices.py가 저장한 새 고시(pipeline/notices/*.txt + 별표 PDF)를 AI(OpenAI gpt-5 또는 Claude)가 읽고,
그 고시가 정하는 rules.json 값(pipeline/notices.json의 keys)을 지금 값과 같은 모양으로 다시 적어 준다.
코드가 모양(항목·개수·숫자)을 검사하고, 지금 값과 다른 칸만 '바뀐 값'으로 뽑는다. AI가 계산식을 바꿀 수는 없다.

검사를 통과한 제안은 pipeline/central_drafts.json에 '검토 대기'로 모이고, 매일 확인이 Supabase(central_values)에 올린다.
최종 결정은 사람: 관리자 화면 '중앙 기준값'에서 시스템 관리자가 원문과 대조해 승인하면, 시행일부터 계산기에 자동 반영.
rules.json은 바꾸지 않는다 (다음 해 rules.json을 새로 만들 때 승인된 값을 옮긴다).

실행 예:
  $env:OPENAI_API_KEY = Read-Host "OpenAI 키"   # 있으면 OpenAI(gpt-5), 없으면 ANTHROPIC_API_KEY로 Claude
  python pipeline/propose_notice.py            # 새 고시 제안 → proposals/*.json → central_drafts.json
  python pipeline/propose_notice.py --export   # AI 호출 없이 central_drafts.json만 다시 만들기
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
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
DRAFTS = HERE / "central_drafts.json"
CLAUDE_MODEL = "claude-opus-5-5"
OPENAI_MODEL = "gpt-5"  # convert.py와 같은 기본 모델
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
6. effective_date에는 **이 값들이 실제로 적용되는 날**(YYYY-MM-DD)을 적습니다. 부칙에서 값에 따라 시행일이 따로 정해져 있으면
   (예: 최저보장수준은 3월 1일부터) 그 날짜를 적고, 그런 규정이 없으면 고시 시행일을 적습니다.
7. 표의 칸 이름이 지금 값의 키와 조금 달라도(예: '3급지(광역·세종시·수도권 외 특례시)') 지금 값의 키 이름을 그대로 쓰고,
   지금 값에 없는 칸(예: 7인 가구)은 넣지 않습니다."""


def get_path(d: dict, path: str):
    for p in path.split("."):
        d = d[p]
    return d




def label_head(k: str) -> str:
    """'3급지(광역시·세종·창원)' → '3급지', '1인 가구' → '1인' (고시 표의 칸 이름이 우리 키와 조금 달라도 맞추기)"""
    return re.split(r"[(\s]", str(k).strip(), maxsplit=1)[0]


def fit_shape(cur, new):
    """AI 값을 지금 값의 모양에 맞춘다: 같은 키가 없으면 앞머리('1급지', '1인')가 같은 키로, 지금 값에 없는 칸(7인 등)은 버린다.
    맞출 수 없으면 None. 숫자·개수 검사는 same_shape가 다시 한다"""
    if isinstance(cur, dict):
        if not isinstance(new, dict):
            return None
        out = {}
        for k, v in cur.items():
            if k in new:
                src = new[k]
            else:
                hits = [nk for nk in new if label_head(nk) == label_head(k)
                        or (str(k).isdigit() and re.match(r"\d+", str(nk).strip()) and re.match(r"\d+", str(nk).strip()).group() == str(k))]
                if len(hits) != 1:
                    return None
                src = new[hits[0]]
            fitted = fit_shape(v, src)
            if fitted is None:
                return None
            out[k] = fitted
        return out
    if isinstance(cur, list):
        if not isinstance(new, list) or len(new) < len(cur):
            return None
        out = [fit_shape(x, y) for x, y in zip(cur, new)]
        return None if any(x is None for x in out) else out
    return new


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
            blocks.append(base64.standard_b64encode(r.content).decode())  # 제공자별 형식은 ask_*에서
    return blocks


IMG_TYPES = {b"GIF8": "image/gif", b"\x89PNG": "image/png", b"\xff\xd8\xff\xe0": "image/jpeg", b"\xff\xd8\xff\xe1": "image/jpeg"}


def image_blocks(text: str, limit: int = 20) -> list[tuple[str, str, str]]:
    """고시 본문의 <img id="…"> 표 이미지 (기준 중위소득표·기준임대료표 등은 글이 아니라 그림으로만 들어 있다).
    국가법령정보센터 파일 주소(flDownload.do?flSeq=<id>)로 받는다. → [(id, media_type, base64)]"""
    out = []
    for img_id in re.findall(r'<img id="(\d+)"', text)[:limit]:
        try:
            r = requests.get(f"https://www.law.go.kr/LSW/flDownload.do?flSeq={img_id}", timeout=60)
        except requests.RequestException:
            continue
        mt = next((t for sig, t in IMG_TYPES.items() if r.content.startswith(sig)), None)
        if r.ok and mt and len(r.content) <= 5 * 1024 * 1024:
            out.append((img_id, mt, base64.standard_b64encode(r.content).decode()))
    return out


def ask_claude(client, msg: str, pdfs: list[str], keys: list[str], images=()) -> tuple[dict, str]:
    docs = [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": d}} for d in pdfs]
    imgs = [part for i, mt, d in images for part in (
        {"type": "text", "text": f"[이미지 {i}]"}, {"type": "image", "source": {"type": "base64", "media_type": mt, "data": d}})]
    response = client.beta.messages.create(
        model=CLAUDE_MODEL, max_tokens=16000,
        system=[{"type": "text", "text": SYSTEM}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema(keys)}},
        messages=[{"role": "user", "content": [*docs, *imgs, {"type": "text", "text": msg}]}],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"AI 응답 중단: {response.stop_reason}")
    return json.loads(next(b.text for b in response.content if b.type == "text")), response.model


def ask_openai(client, msg: str, pdfs: list[str], keys: list[str], images=()) -> tuple[dict, str]:
    files = [{"type": "file", "file": {"filename": f"table{i + 1}.pdf", "file_data": f"data:application/pdf;base64,{d}"}}
             for i, d in enumerate(pdfs)]
    imgs = [part for i, mt, d in images for part in (
        {"type": "text", "text": f"[이미지 {i}]"}, {"type": "image_url", "image_url": {"url": f"data:{mt};base64,{d}", "detail": "high"}})]
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": [*files, *imgs, {"type": "text", "text": msg}]}],
        response_format={"type": "json_schema", "json_schema": {"name": "notice_values", "schema": schema(keys), "strict": True}},
    )
    choice = response.choices[0]
    if choice.message.refusal:
        raise RuntimeError(f"AI가 거절함: {choice.message.refusal}")
    if choice.finish_reason == "length":
        raise RuntimeError("AI 응답이 길이 제한에서 잘림")
    return json.loads(choice.message.content), response.model


def propose(client, stem: str, rules: dict, hints: dict, ask=ask_claude) -> dict:
    meta = json.loads((NOTICE_DIR / f"{stem}.json").read_text(encoding="utf-8"))
    hint = hints.get(meta["notice"], "")
    text = (NOTICE_DIR / f"{stem}.txt").read_text(encoding="utf-8")
    current = {k: get_path(rules, k) for k in meta["keys"]}
    pdfs = pdf_blocks(meta.get("table_pdfs", []))
    images = image_blocks(text)
    msg = (f"고시: {meta['name']} (발령 {meta['issued']} {meta['number']}, 시행 {meta['effective']})\n"
           f"값 설명: {hint}\n\n지금 값 (이 모양 그대로 새 값을 적으세요):\n{json.dumps(current, ensure_ascii=False, indent=1)}\n\n"
           f"<원문>\n{text}\n</원문>\n" + (f"\n별표 PDF {len(pdfs)}개를 함께 첨부했습니다." if pdfs else "\n별표 PDF는 받지 못했습니다.")
           + (f"\n원문의 <img id=\"…\"> 자리에 들어가는 표 이미지 {len(images)}개를 '[이미지 id]' 표시와 함께 첨부했습니다. "
              "이미지의 숫자를 그대로 읽으세요 (예: 표의 '1인가구' 칸 → 키 \"1\")." if images else ""))
    out, model = ask(client, msg, pdfs, meta["keys"], images)

    # AI 제안을 그대로 믿지 않는다: 모양이 같고 숫자인 것만, 지금 값과 다른 칸만 뽑는다
    checked, rejected, raw_rejected = [], [], {}
    for it in out["items"]:
        try:
            new = json.loads(it["value_json"])
        except json.JSONDecodeError:
            rejected.append(f"{it['key']}: JSON 형식 오류")
            raw_rejected[it["key"]] = it["value_json"][:2000]
            continue
        cur = current[it["key"]]
        fitted = fit_shape(cur, new)  # 표의 칸 이름 차이·지금 값에 없는 칸(7인 등)만 맞춘다
        if fitted is None or not same_shape(cur, fitted):
            rejected.append(f"{it['key']}: 지금 값과 모양이 다름")
            raw_rejected[it["key"]] = it["value_json"][:2000]  # 사람이 보고 판단할 수 있게 남긴다
            continue
        changes = diff(cur, fitted, it["key"])
        checked.append({"key": it["key"], "value": fitted, "changes": changes, "evidence": it["evidence"], "location": it["location"]})
    result = {"stem": stem, "notice": meta, "model": model, "related": out["related"],
              "effective_date": out["effective_date"], "items": checked, "rejected": rejected, "rejected_raw": raw_rejected,
              "unreadable": out["unreadable"], "notes": out["notes"]}
    PROPOSAL_DIR.mkdir(parents=True, exist_ok=True)
    (PROPOSAL_DIR / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return result


def pending() -> list[str]:
    return [p.stem for p in sorted(NOTICE_DIR.glob("*.txt")) if not (PROPOSAL_DIR / f"{p.stem}.json").exists()]


def fmt(v) -> str:
    return f"{v:,}" if isinstance(v, int) else str(v)


def ymd(v: str) -> str:
    v = str(v or "")
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}" if re.fullmatch(r"\d{8}", v) else v


def export_drafts() -> list[dict]:
    """검사를 통과한 제안 중 지금 값과 다른 것만 → 관리자 화면 '중앙 기준값'의 검토 대기 목록"""
    rows = []
    for f in sorted(PROPOSAL_DIR.glob("*.json")) if PROPOSAL_DIR.exists() else []:
        r = json.loads(f.read_text(encoding="utf-8"))
        n = r["notice"]
        # 시행일: AI가 원문(부칙)에서 찾은 날짜가 있으면 그것 (예: 교육급여 최저보장수준은 고시 시행일과 달리 3월 1일), 없으면 API 시행일
        ai_eff = str(r.get("effective_date") or "")
        eff = ai_eff if re.fullmatch(r"\d{4}-\d{2}-\d{2}", ai_eff) else ymd(n.get("effective"))
        if not r.get("related") or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff):
            continue
        for it in r["items"]:
            if not it["changes"]:
                continue
            rows.append({
                "id": f"{n['notice']}_{n['serial']}_{it['key']}", "key": it["key"], "value": it["value"], "effective_from": eff,
                "notice": {"key": n["notice"], "source": n["source"], "name": n["name"], "number": n["number"], "issued": n["issued"], "serial": n["serial"]},
                "evidence": it["evidence"][:500], "location": it["location"], "proposed_by": f"ai:{r.get('model', '')}", "status": "검토 대기",
            })
    DRAFTS.write_text(json.dumps({"note": "새 고시에서 AI가 읽은 중앙 기준값 제안 (계산에 쓰지 않음). 시스템 관리자가 승인한 것만 시행일부터 반영",
                                  "drafts": rows}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="새 고시 → AI가 바뀐 기준값 제안")
    ap.add_argument("--export", action="store_true", help="AI 호출 없이 central_drafts.json만 다시 만들기")
    ap.add_argument("--provider", default="auto", choices=["auto", "claude", "openai"],
                    help="auto: OPENAI_API_KEY가 있으면 OpenAI, 아니면 Claude")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.export:
        print(f"중앙 기준값 제안 {len(export_drafts())}건 저장")
        return
    hints = {n["key"]: n.get("hint", "") for n in json.loads(CONFIG.read_text(encoding="utf-8"))["notices"]}
    tries = json.loads(TRIES.read_text(encoding="utf-8")) if TRIES.exists() else {}
    todo = [s for s in pending() if tries.get(s, 0) < MAX_TRIES]
    if not todo:
        print("제안할 새 고시 없음")
        export_drafts()
        return

    provider = args.provider
    if provider == "auto":
        provider = "openai" if os.environ.get("OPENAI_API_KEY") else "claude"
    if provider == "openai":
        import openai as sdk
        client, ask = sdk.OpenAI(), ask_openai
    else:
        import anthropic as sdk
        client, ask = sdk.Anthropic(), ask_claude
    print(f"AI 제공자: {provider}")
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    results, failed = [], []
    for stem in todo:
        tries[stem] = tries.get(stem, 0) + 1
        try:
            results.append(propose(client, stem, rules, hints, ask))
            print(f"[{stem}] 제안 완료")
        except (sdk.APIError, RuntimeError, json.JSONDecodeError, KeyError) as e:
            failed.append(f"{stem} ({type(e).__name__})")
            print(f"[{stem}] 실패: {type(e).__name__}")
        time.sleep(1)
    STATE_DIR.mkdir(exist_ok=True)
    TRIES.write_text(json.dumps(tries, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    drafts = export_drafts()

    lines = []
    for r in results:
        n = r["notice"]
        lines += ["", f"### {n['name']} (시행 {ymd(n['effective']) or r['effective_date']})"]
        if not r["related"]:
            lines.append("AI 판단: 오름 계산 값과 관련 없는 개정이에요.")
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
    if failed:
        lines += ["", f"AI 제안 실패 (다음 실행 때 다시, {MAX_TRIES}번까지): " + ", ".join(failed)]
    if results:
        lines += ["", f"관리자 화면 **중앙 기준값**에 '검토 대기'로 올렸어요 (전체 {len(drafts)}건). 시스템 관리자가 원문과 대조해 승인하면 "
                  "시행일부터 계산기에 자동으로 반영돼요. 이 PR은 기록용이라 rules.json은 바뀌지 않아요."]
    with SUMMARY.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"완료: 제안 {len(results)}건, 실패 {len(failed)}건, 검토 대기 {len(drafts)}건")


if __name__ == "__main__":
    main()
