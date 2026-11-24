"""중앙 고시 변경 확인 (매일 자동 실행용)

국가법령정보 공동활용 Open API(행정규칙)로, 계산 기준값을 정하는 고시(pipeline/notices.json)에
새 버전(제정·개정·다음 연도 고시)이 올라왔는지 확인한다. 새 고시가 있으면 본문·별표를 저장하고,
propose_notice.py가 AI로 바뀐 값을 제안한다. 반영은 사람이 PR에서 원문과 대조해 승인(합치기)할 때만.

고시는 해마다 나오는 달이 다르고(기준 중위소득 8월, 교육급여 12월 등) 중간에 개정되기도 해서 매일 확인한다.
확인은 고시당 API 2번(현행·연혁)이라 가볍고, AI는 새 고시가 있을 때만 쓴다.

실행 예 (PowerShell):
  $env:LAW_OC = "open.law.go.kr에서 신청한 API 인증값(OC)"
  python pipeline/watch_notices.py            # 처음 실행은 지금 고시를 기준으로만 기록
  python pipeline/watch_notices.py --init     # 기준 다시 기록 (오늘 시행 중인 고시 기준 → 시행 전 다음 연도 고시는 다음 실행 때 '새 고시')

결과:
  pipeline/notices/<고시>_<발령일자>_<일련번호>.txt   새 고시 본문·별표 (AI 제안 입력)
  pipeline/notices/<…>.json                          고시 정보(발령번호·시행일·별표 PDF 링크)
  pipeline/state/notice_state.json                   고시별 마지막으로 본 버전
  pipeline/state/notice_summary.md                   이번 실행 요약 (PR 본문)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_rest import select, upsert  # noqa: E402

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "notices.json"
OUT_DIR = HERE / "notices"
STATE_DIR = HERE / "state"
STATE, SUMMARY = STATE_DIR / "notice_state.json", STATE_DIR / "notice_summary.md"
SEARCH_URL = "http://www.law.go.kr/DRF/lawSearch.do"
BODY_URL = "http://www.law.go.kr/DRF/lawService.do"
KST = timezone(timedelta(hours=9))
SAFE = re.compile(r"[^0-9A-Za-z]")


def today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def get_json(url: str, oc: str, **params) -> dict:
    params.update(OC=oc, target="admrul", type="JSON")
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=40)
            break
        except (requests.Timeout, requests.ConnectionError):
            if attempt == 2:
                raise RuntimeError("국가법령정보 API 응답 없음 (3번 시도)")
            time.sleep(3 * (attempt + 1))
    if r.status_code >= 400:  # 요청 주소에 OC가 들어 있어 raise_for_status()로 주소를 찍지 않는다
        raise RuntimeError(f"국가법령정보 API 오류: HTTP {r.status_code} (OC 인증값·서비스 신청을 확인)")
    try:
        return r.json()
    except ValueError:
        raise RuntimeError("국가법령정보 API가 JSON이 아닌 응답을 줬어요 (OC 인증값이 맞는지, 신청이 승인됐는지 확인)") from None


def find_rows(node, need: str) -> list[dict]:
    """응답 JSON 어디에 있든 need 키를 가진 항목을 모은다 (결과가 1건이면 목록이 아니라 객체로 오기도 한다)"""
    out = []
    if isinstance(node, dict):
        if need in node:
            out.append(node)
        for v in node.values():
            out += find_rows(v, need)
    elif isinstance(node, list):
        for v in node:
            out += find_rows(v, need)
    return out


def collect(node, keys: set[str]) -> dict[str, list[str]]:
    """본문 JSON에서 조문내용·별표내용 같은 글과 별표 PDF 링크를 모은다"""
    got: dict[str, list[str]] = {k: [] for k in keys}

    def walk(n):
        if isinstance(n, dict):
            for k, v in n.items():
                if k in keys and isinstance(v, (str, int)) and str(v).strip():
                    got[k].append(str(v).strip())
                elif k in keys and isinstance(v, list) and all(isinstance(x, str) for x in v):
                    got[k] += [x.strip() for x in v if x.strip()]
                else:
                    walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(node)
    return got


def watched_notices() -> tuple[list[dict], str]:
    """감시 고시: 관리자 화면 '운영 설정'(Supabase watched_notices, 사용 중인 것) → 없으면 pipeline/notices.json"""
    rows = select("watched_notices", "select=*&active=eq.true&order=key")
    if rows:
        out = [{"key": r["key"], "source": r.get("source") or "", "query": r["query"], "match": list(r.get("match") or []),
                "keys": list(r.get("keys") or []), "hint": r.get("hint") or ""} for r in rows if r.get("query") and r.get("keys")]
        if out:
            return out, "관리자 화면 설정"
    return json.loads(CONFIG.read_text(encoding="utf-8"))["notices"], "notices.json"


def latest_version(oc: str, notice: dict, in_force_only: bool = False) -> dict | None:
    """가장 최근 고시. in_force_only면 오늘 이미 시행 중인 것 중 가장 최근 (기준 기록용:
    계산기 값은 지금 시행 중인 고시 기준이라, 시행 전인 다음 연도 고시는 '새 고시'로 잡혀야 한다)"""
    rows = []
    for nw in (1, 2):  # 현행 + 연혁 (아직 시행 전인 다음 연도 고시를 놓치지 않도록 둘 다 본다)
        data = get_json(SEARCH_URL, oc, query=notice["query"], nw=nw, knd=3, display=50, sort="ddes")
        rows += find_rows(data, "행정규칙명")
    rows = [r for r in rows if all(m in str(r.get("행정규칙명", "")) for m in notice["match"])]
    if in_force_only:
        now = int(today().replace("-", ""))
        rows = [r for r in rows if int(r.get("시행일자") or 0) <= now]
    if not rows:
        return None
    best = max(rows, key=lambda r: (int(r.get("발령일자") or 0), str(r.get("행정규칙일련번호") or "")))
    return {
        "serial": str(best.get("행정규칙일련번호") or ""), "name": str(best.get("행정규칙명") or ""),
        "issued": str(best.get("발령일자") or ""), "number": str(best.get("발령번호") or ""),
        "effective": str(best.get("시행일자") or ""), "kind": str(best.get("제개정구분명") or ""),
    }


def save_body(oc: str, notice: dict, ver: dict) -> str:
    body = get_json(BODY_URL, oc, ID=ver["serial"])
    got = collect(body, {"조문내용", "별표내용", "부칙내용", "별표제목", "별표서식PDF파일링크"})
    stem = f"{notice['key']}_{SAFE.sub('', ver['issued'])}_{SAFE.sub('', ver['serial'])}"
    OUT_DIR.mkdir(exist_ok=True)
    text = [f"# 고시: {ver['name']}", f"# 발령: {ver['issued']} {ver['number']} ({ver['kind']})", f"# 시행: {ver['effective']}",
            f"# 출처: 국가법령정보센터 행정규칙 (행정규칙일련번호 {ver['serial']}), {today()} 변경 확인", ""]
    text += ["[조문]"] + got["조문내용"] + ["", "[별표]"] + got["별표내용"] + ["", "[부칙]"] + got["부칙내용"]
    (OUT_DIR / f"{stem}.txt").write_text("\n".join(text) + "\n", encoding="utf-8")
    pdfs = ["https://www.law.go.kr" + p if p.startswith("/") else p for p in got["별표서식PDF파일링크"]]
    meta = {"notice": notice["key"], "source": notice["source"], "keys": notice["keys"], "hint": notice.get("hint", ""), **ver,
            "tables": got["별표제목"], "table_pdfs": [p for p in pdfs if p.startswith("https://www.law.go.kr/")]}
    (OUT_DIR / f"{stem}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return stem


def main() -> None:
    ap = argparse.ArgumentParser(description="중앙 고시 변경 확인")
    ap.add_argument("--init", action="store_true", help="지금 고시를 기준으로만 기록")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    oc = os.environ.get("LAW_OC", "").strip()
    if not oc:
        sys.exit("LAW_OC 환경변수에 국가법령정보 공동활용 API 인증값(OC)을 넣어 주세요.")

    notices, origin = watched_notices()
    print(f"감시 고시 {len(notices)}종 ({origin})")
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    init = args.init or not state
    if init:
        print("기준 기록 모드: 지금 고시를 기록만 하고 AI 제안은 만들지 않습니다.")
    STATE_DIR.mkdir(exist_ok=True)

    new, failed, missing, added = [], [], [], []
    for n in notices:
        # 관리자 화면에서 새로 더한 고시(기록 없음)는 이번엔 시행 중인 버전을 기준으로만 기록한다
        first = n["key"] not in state
        try:
            ver = latest_version(oc, n, in_force_only=init or first)
        except RuntimeError as e:
            failed.append(f"{n['key']} ({e})")
            continue
        if not ver:
            missing.append(n["key"])
            print(f"[{n['key']}] 검색 결과 없음 (검색어·match 확인)")
            continue
        old = state.get(n["key"], {})
        print(f"[{n['key']}] {ver['name']} · 발령 {ver['issued']} {ver['number']} · 시행 {ver['effective']}")
        if old.get("serial") == ver["serial"]:
            continue
        if not init and int(ver["issued"] or 0) < int(old.get("issued") or 0):
            continue  # 더 옛 버전이 검색되면 무시
        if first and not init:
            added.append(n["key"])  # 새로 더한 고시: 기준만 기록, 다음 실행부터 새 버전을 잡는다
        elif not init:
            try:
                stem = save_body(oc, n, ver)
            except RuntimeError as e:
                failed.append(f"{n['key']} 본문 ({e})")
                continue  # 기록을 바꾸지 않아 다음 날 다시 시도
            ver["file"] = stem
            new.append({**ver, "key": n["key"], "source": n["source"], "stem": stem})
            print(f"  새 고시: {stem}")
        state[n["key"]] = {**ver, "checked": today()}
        time.sleep(0.3)

    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    lines = [f"## 중앙 고시 변경 확인 ({today()})", ""]
    if init:
        lines.append(f"처음 실행이라 지금 고시 {len(state)}건을 기준으로 기록했어요. 내일부터 새 고시만 잡아요.")
    elif new:
        lines += ["새 고시가 올라왔어요. AI가 바뀐 값을 관리자 화면 **중앙 기준값**에 제안해요. 원문과 대조해 승인하면 시행일부터 반영돼요.", "",
                  "| 출처 | 고시 | 발령 | 시행일 |", "|---|---|---|---|"]
        lines += [f"| {x['source']} | {x['name']} | {x['issued']} {x['number']} | {x['effective']} |" for x in new]
    elif not added:
        lines.append("새 고시가 없어요.")
    if added:
        lines += ["", "새로 감시하기 시작한 고시 (지금 시행 중인 버전을 기준으로 기록): " + ", ".join(added)]
    if missing:
        lines += ["", "검색되지 않은 고시 (이름이 바뀌었을 수 있어요, 관리자 화면 '운영 설정'에서 확인): " + ", ".join(missing)]
    if failed:
        lines += ["", "확인하지 못한 것 (다음 실행 때 다시): " + ", ".join(failed)]
    SUMMARY.write_text("\n".join(lines) + "\n", encoding="utf-8")
    upsert("system_status", {"key": "notice_watch", "checked_at": datetime.now(timezone.utc).isoformat(),
                             "summary": {"notices": len(notices), "new": len(new)}})
    print(f"완료: 새 고시 {len(new)}건")


if __name__ == "__main__":
    main()
