"""복지로 서비스 원문 자동 수집 (공공데이터포털, 한국사회보장정보원 복지서비스 정보 API)

실행 예:
  set DATA_GO_KR_KEY=발급받은_일반인증키(Decoding)
  python pipeline/fetch_bokjiro.py --local --sido 경상북도 --sigungu 경산시 --limit 30
  python pipeline/fetch_bokjiro.py --central --search 급여 --limit 20

결과: pipeline/raw/api_<서비스ID>.txt  (convert.py가 그대로 읽는 형식)

⚠️ 엔드포인트·요청 변수·응답 항목 이름은 공공데이터포털 '활용가이드'와 반드시 대조하세요.
   아래 기본값은 문서 확인 전 추정값이며, 응답의 모든 텍스트 항목을 저장하므로 항목 이름이 달라도 원문은 남습니다.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

RAW_DIR = Path(__file__).resolve().parent / "raw"
ENDPOINTS = {  # 활용가이드로 확인 필요
    "local": ("https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations",
              "LcgvWelfarelist", "LcgvWelfaredetailed"),
    "central": ("https://apis.data.go.kr/B554287/NationalWelfareInformationsV001",
                "NationalWelfarelistV001", "NationalWelfaredetailedV001"),
}
# 상세 응답에서 원문으로 남길 항목 (있으면 이 순서로, 나머지는 뒤에)
PREFERRED = ["servNm", "servDgst", "sprtTrgtCn", "slctCritCn", "alwServCn", "trgterIndvdlArray", "aplyMtdCn"]
LABELS = {"servDgst": "서비스 요약", "sprtTrgtCn": "지원대상", "slctCritCn": "선정기준", "alwServCn": "서비스 내용", "aplyMtdCn": "신청방법"}


def call(base: str, op: str, key: str, **params) -> ET.Element:
    params["serviceKey"] = key
    r = requests.get(f"{base}/{op}", params=params, timeout=30)
    r.raise_for_status()
    return ET.fromstring(r.content)


def leaves(node: ET.Element) -> dict[str, str]:
    return {e.tag: (e.text or "").strip() for e in node.iter() if len(e) == 0 and (e.text or "").strip()}


def main() -> None:
    ap = argparse.ArgumentParser()
    kind = ap.add_mutually_exclusive_group(required=True)
    kind.add_argument("--local", action="store_true", help="지자체 복지서비스")
    kind.add_argument("--central", action="store_true", help="중앙부처 복지서비스")
    ap.add_argument("--sido", help="시도명 (지자체)")
    ap.add_argument("--sigungu", help="시군구명 (지자체)")
    ap.add_argument("--search", help="검색어")
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        sys.exit("DATA_GO_KR_KEY 환경변수에 공공데이터포털 인증키를 넣어 주세요.")
    base, list_op, detail_op = ENDPOINTS["local" if args.local else "central"]

    params = {"pageNo": 1, "numOfRows": args.limit}
    if args.local:
        if args.sido:
            params["ctpvNm"] = args.sido
        if args.sigungu:
            params["sggNm"] = args.sigungu
    else:
        params["callTp"] = "L"
        params["srchKeyCode"] = "001"
    if args.search:
        params["searchWrd"] = args.search

    root = call(base, list_op, key, **params)
    items = [leaves(it) for it in root.iter("servList")]
    print(f"목록 {len(items)}건")
    RAW_DIR.mkdir(exist_ok=True)
    for it in items:
        sid = it.get("servId")
        if not sid:
            continue
        detail = leaves(call(base, detail_op, key, servId=sid, **({} if args.local else {"callTp": "D"})))
        name = detail.get("servNm") or it.get("servNm", sid)
        region = " ".join(x for x in [it.get("ctpvNm"), it.get("sggNm")] if x) or "중앙"
        body = []
        for k in PREFERRED + [k for k in detail if k not in PREFERRED]:
            if k in detail and k != "servNm" and len(detail[k]) > 1:
                body.append(f"[{LABELS.get(k, k)}]\n{detail[k]}")
        (RAW_DIR / f"api_{sid}.txt").write_text(
            f"# 서비스명: {name}\n# 제공주체: {region}\n# 출처: 공공데이터포털 복지서비스 API (servId={sid})\n\n" + "\n".join(body) + "\n",
            encoding="utf-8")
        print(f"  저장: api_{sid}.txt  {name}")
        time.sleep(0.2)


if __name__ == "__main__":
    main()
