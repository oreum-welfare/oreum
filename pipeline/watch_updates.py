"""지자체 복지서비스 변경 확인 (매일 자동 실행용)

공공데이터포털 API는 '새 정책이 올라왔다'는 알림을 주지 않는다. 그래서 매일 목록을 받아
지난번과 비교해 새로 생겼거나 바뀐 제도만 원문을 저장한다. 저장한 원문은 convert.py가 AI 초안으로 바꾸고,
export_local_drafts.py가 '검토 대기' 초안으로 내보낸다 (.github/workflows/policy-watch.yml).

바뀜 판단: 목록의 최종 수정일(lastModYmd)이 같으면 건너뛴다. 다르면 상세 원문을 받아,
본문(지원대상·선정기준·서비스 내용 등, 문의처 같은 참고 정보 제외)이 실제로 달라졌을 때만 '바뀜'으로 본다.

실행 예 (PowerShell):
  $env:DATA_GO_KR_KEY = "발급받은_일반인증키(Decoding)"
  python pipeline/watch_updates.py                 # 기본 지역(경산시·대구 북구·영천시) 확인
  python pipeline/watch_updates.py --region "경상북도 경산시"
  python pipeline/watch_updates.py --init          # 지금 상태를 기준으로만 기록 (AI 변환할 원문을 만들지 않음)
  python pipeline/watch_updates.py --pending       # AI 초안이 아직 없는 원문 이름 출력 (API 키 불필요)

처음 실행(기록 파일 없음)은 자동으로 --init처럼 동작한다. 이미 있는 제도 수십 건을 한꺼번에 AI로 변환하지 않기 위해서다.
결과:
  pipeline/raw/u_<서비스ID>_<수정일>.txt     바뀐 제도 원문 (버전마다 새 파일 → 새 초안 id, 승인된 이전 버전은 그대로 계산)
  pipeline/state/watch_state.json            제도별 마지막 확인 기록
  pipeline/state/summary.md                  이번 실행 요약 (PR 본문)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_bokjiro import ENDPOINTS, ApiTimeout, call, format_body, leaves, parse_detail  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW_DIR, RULES_DIR = HERE / "raw", HERE / "runs_watch_rules"
STATE_DIR = HERE / "state"
STATE, SUMMARY = STATE_DIR / "watch_state.json", STATE_DIR / "summary.md"
DEFAULT_REGIONS = ["경상북도 경산시", "대구광역시 북구", "경상북도 영천시"]
SAFE = re.compile(r"[^A-Za-z0-9_]")  # 파일 이름·명령 인자에 들어가므로 API 값에서 안전한 글자만 남긴다
KST = timezone(timedelta(hours=9))


def today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def list_region(key: str, region: str) -> list[dict]:
    sido, _, sgg = region.partition(" ")
    base, list_op, _ = ENDPOINTS["local"]
    items, page = [], 1
    while True:
        root = call(base, list_op, key, pageNo=page, numOfRows=100, ctpvNm=sido, **({"sggNm": sgg} if sgg else {}))
        batch = [leaves(it) for it in root.iter("servList")]
        items += batch
        total = int(root.findtext(".//totalCount") or 0)
        if not batch or len(items) >= total:
            return items
        page += 1


def core_hash(body: list[str]) -> str:
    core = "\n".join(b for b in body if not b.startswith("[참고 정보]"))
    return hashlib.sha256(core.encode("utf-8")).hexdigest()[:16]


def pending() -> list[str]:
    """원문은 있는데 AI 초안이 아직 없는 것 (변환이 실패했거나 키가 없던 날 것도 다음 날 다시 시도)"""
    return [p.stem for p in sorted(RAW_DIR.glob("u_*.txt")) if not (RULES_DIR / f"{p.stem}.json").exists()]


def main() -> None:
    ap = argparse.ArgumentParser(description="지자체 복지서비스 변경 확인")
    ap.add_argument("--region", action="append", help='확인할 지역 (예: "경상북도 경산시"). 여러 번 쓸 수 있음')
    ap.add_argument("--init", action="store_true", help="지금 상태를 기준으로만 기록")
    ap.add_argument("--pending", action="store_true", help="AI 초안이 아직 없는 원문 이름만 출력")
    ap.add_argument("--max-changes", type=int, default=30, help="하루에 원문으로 저장할 최대 건수 (나머지는 다음 날)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.pending:
        print(" ".join(pending()))
        return

    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        sys.exit("DATA_GO_KR_KEY 환경변수에 공공데이터포털 인증키를 넣어 주세요.")
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    init = args.init or not state
    if init:
        print("기준 기록 모드: 지금 있는 제도를 기록만 하고 AI 변환할 원문은 만들지 않습니다.")
    base, _, detail_op = ENDPOINTS["local"]
    RAW_DIR.mkdir(exist_ok=True)
    STATE_DIR.mkdir(exist_ok=True)

    changes, skipped, deferred = [], [], 0
    for region in args.region or DEFAULT_REGIONS:
        try:
            items = list_region(key, region)
        except ApiTimeout as e:
            skipped.append(f"{region} 목록 ({e})")
            continue
        print(f"[{region}] 목록 {len(items)}건")
        for it in items:
            sid = SAFE.sub("", it.get("servId", ""))
            if not sid:
                continue
            mod = SAFE.sub("", it.get("lastModYmd", ""))
            old = state.get(sid)
            if old and mod and old.get("mod") == mod:
                continue  # 수정일이 같으면 상세를 받지 않는다
            if not init and len(changes) >= args.max_changes:
                deferred += 1
                continue  # 기록을 바꾸지 않으므로 다음 날 다시 잡힌다
            try:
                detail = parse_detail(call(base, detail_op, key, servId=sid))
            except ApiTimeout as e:
                skipped.append(f"{it.get('servNm', sid)} ({e})")
                continue
            mod = mod or SAFE.sub("", detail.get("lastModYmd", ""))
            body = format_body(detail)
            h = core_hash(body)
            name = detail.get("servNm") or it.get("servNm", sid)
            entry = {"name": name, "region": region, "mod": mod, "hash": h, "checked": today()}
            if old and old.get("hash") == h:
                state[sid] = {**old, "mod": mod, "checked": today()}  # 수정일만 바뀌고 본문은 같음
                continue
            if not init:
                stem = f"u_{sid}_{mod or today().replace('-', '')}"
                (RAW_DIR / f"{stem}.txt").write_text(
                    f"# 서비스명: {name}\n# 제공주체: {region}\n# 출처: 공공데이터포털 지자체복지서비스 API (servId={sid}), {today()} 변경 확인\n\n"
                    + "\n".join(body) + "\n", encoding="utf-8")
                entry["raw"] = stem
                changes.append({"name": name, "region": region, "mod": mod, "kind": "바뀜" if old else "새 제도", "stem": stem})
                print(f"  {'바뀜' if old else '새 제도'}: {name} ({mod})")
            state[sid] = entry
            time.sleep(0.2)

    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    lines = [f"## 지자체 제도 변경 확인 ({today()})", ""]
    if init:
        lines.append(f"처음 실행이라 지금 있는 제도 {len(state)}건을 기준으로 기록했어요. 내일부터 바뀐 것만 잡아요.")
    elif changes:
        lines += ["새로 생겼거나 바뀐 제도예요. AI 초안이 **검토 대기**로 올라가고, 담당자가 승인해야 계산에 들어가요.", "",
                  "| 지역 | 제도 | 구분 | 최종 수정일 |", "|---|---|---|---|"]
        lines += [f"| {c['region']} | {c['name']} | {c['kind']} | {c['mod']} |" for c in changes]
    else:
        lines.append("바뀐 제도가 없어요.")
    if deferred:
        lines += ["", f"하루 최대 건수를 넘은 {deferred}건은 다음 실행 때 처리해요."]
    if skipped:
        lines += ["", "응답이 없어 건너뛴 것 (다음 실행 때 다시 확인): " + ", ".join(skipped)]
    SUMMARY.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"완료: 새 제도·바뀐 제도 {len(changes)}건, 기록 {len(state)}건")


if __name__ == "__main__":
    main()
