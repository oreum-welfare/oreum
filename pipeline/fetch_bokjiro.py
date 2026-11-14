"""복지로 서비스 원문 자동 수집 (공공데이터포털, 한국사회보장정보원 복지서비스 정보 API)

실행 예 (PowerShell):
  $env:DATA_GO_KR_KEY = "발급받은_일반인증키(Decoding)"
  python pipeline/fetch_bokjiro.py --local --sido 경상북도 --sigungu 경산시 --limit 30
  python pipeline/fetch_bokjiro.py --central --search 생계급여 --limit 5
  python pipeline/fetch_bokjiro.py --central --limit 20          # 검색어 없이 목록 앞쪽부터

결과: pipeline/raw/api_<서비스ID>.txt  (convert.py가 그대로 읽는 형식)
API마다 공공데이터포털에서 따로 활용신청해야 한다 (같은 인증키를 씀).
  - 지자체: 한국사회보장정보원_지자체복지서비스 (data.go.kr/data/15108347)
  - 중앙부처: 한국사회보장정보원_중앙부처복지서비스 (data.go.kr/data/15090532)

검증: 2026-11-14 지자체 API로 경산시 18건 수집. 복지로 상세 페이지에서 모은 원문과 14건 중 13건 동일,
   1건은 API 쪽이 더 완전함(소제목 포함).
   중앙부처 API는 주소·응답 항목 이름을 공공데이터포털 명세(Swagger)로 확인함. 요청 변수(callTp, srchKeyCode, searchWrd)는 실제 호출로 확인 필요.
주의: API 원문에는 줄바꿈이 없음 (복지로 화면의 줄바꿈이 빠진 채 제공됨).
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
ENDPOINTS = {
    "local": ("https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations",
              "LcgvWelfarelist", "LcgvWelfaredetailed"),
    "central": ("https://apis.data.go.kr/B554287/NationalWelfareInformationsV001",
                "NationalWelfarelistV001", "NationalWelfaredetailedV001"),
}
# 원문 본문 (AI 변환에 쓰는 항목). 지자체·중앙부처 API의 항목 이름이 조금 다르다.
PREFERRED = ["servDgst", "wlfareInfoOutlCn", "sprtTrgtCn", "tgtrDtlCn", "slctCritCn", "alwServCn", "aplyMtdCn"]
LABELS = {
    "servDgst": "서비스 요약", "wlfareInfoOutlCn": "서비스 요약",   # 지자체 / 중앙부처
    "sprtTrgtCn": "지원대상", "tgtrDtlCn": "지원대상",               # 지자체 / 중앙부처
    "slctCritCn": "선정기준", "alwServCn": "서비스 내용", "aplyMtdCn": "신청방법",
}
# 중앙부처 상세 응답의 목록 항목 → 원문에 덧붙일 이름
NESTED = {"applmetList": "신청방법", "baslawList": "근거법령", "inqplCtadrList": "문의처"}
# 참고 정보 (파일 끝에 짧게 남김)
META = {
    "jurMnofNm": "소관부처", "bizChrDeptNm": "담당부서", "crtrYr": "기준연도",
    "sprtCycNm": "지원주기", "srvPvsnNm": "제공유형", "aplyMtdNm": "신청 경로",
    "trgterIndvdlNmArray": "대상 특성", "trgterIndvdlArray": "가구유형",
    "lifeNmArray": "생애주기", "lifeArray": "생애주기",
    "intrsThemaNmArray": "관심주제", "intrsThemaArray": "관심주제",
    "rprsCtadr": "대표 문의처", "wlfareInfoReldNm": "관련 첨부파일", "lastModYmd": "최종 수정일",
}


def format_body(detail: dict) -> list:
    """원문 본문(AI 변환용) + 참고 정보. 내부 코드 항목(resultMessage 등)은 뺀다."""
    body, seen = [], set()
    for k in PREFERRED:
        if detail.get(k) and LABELS[k] not in seen:
            body.append(f"[{LABELS[k]}]\n{detail[k]}")
            seen.add(LABELS[k])
    for k, label in NESTED.items():
        if detail.get(k) and label not in seen:
            body.append(f"[{label}]\n{detail[k]}")
            seen.add(label)
    meta = [f"- {label}: {detail[k]}" for k, label in META.items() if detail.get(k) and detail[k] != "첨부파일없음.hwp"]
    if meta:
        body.append("[참고 정보]\n" + "\n".join(meta))
    return body


def call(base: str, op: str, key: str, **params) -> ET.Element:
    params["serviceKey"] = key
    r = requests.get(f"{base}/{op}", params=params, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    # 인증 오류 등은 OpenAPI_ServiceResponse 형식으로 온다
    err = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    if err and err != "NORMAL SERVICE.":
        hint = " (활용신청 직후라면 1~2시간 뒤 다시 실행하세요. 이 API를 활용신청했는지도 확인하세요.)" if "KEY" in err else ""
        sys.exit(f"API 오류: {err}{hint}")
    msg = (root.findtext(".//resultMessage") or "").upper()
    if msg and not any(ok in msg for ok in ("SUCCESS", "NORMAL", "정상")):
        sys.exit(f"API 오류: {root.findtext('.//resultCode') or ''} {root.findtext('.//resultMessage')}")
    return root


def parse_detail(root: ET.Element) -> dict[str, str]:
    """상세 응답 → {항목: 값}. 중앙부처의 목록 항목(applmetList 등)은 이름을 모아 한 줄씩 붙인다."""
    nested_nodes = set()
    detail: dict[str, list[str]] = {}
    for tag in NESTED:
        lines = []
        for node in root.iter(tag):
            nested_nodes.update(node.iter())
            name = (node.findtext("servSeDetailNm") or "").strip()
            link = (node.findtext("servSeDetailLink") or "").strip()
            if name:
                lines.append(f"- {name}" + (f" ({link})" if link and tag == "inqplCtadrList" else ""))
        if lines:
            detail[tag] = ["\n".join(lines)]
    out = {k: v[0] for k, v in detail.items()}
    for e in root.iter():
        if e in nested_nodes or len(e):
            continue
        text = (e.text or "").strip()
        if text:
            out.setdefault(e.tag, text)
    return out


def leaves(node: ET.Element) -> dict[str, str]:
    return {e.tag: (e.text or "").strip() for e in node.iter() if len(e) == 0 and (e.text or "").strip()}


def main() -> None:
    ap = argparse.ArgumentParser()
    kind = ap.add_mutually_exclusive_group(required=True)
    kind.add_argument("--local", action="store_true", help="지자체 복지서비스")
    kind.add_argument("--central", action="store_true", help="중앙부처 복지서비스")
    ap.add_argument("--sido", help="시도명 (지자체)")
    ap.add_argument("--sigungu", help="시군구명 (지자체)")
    ap.add_argument("--search", help="검색어 (서비스명 기준)")
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
        params["srchKeyCode"] = "001"  # 001 = 서비스명으로 검색
    if args.search:
        params["searchWrd"] = args.search

    root = call(base, list_op, key, **params)
    total = root.findtext(".//totalCount")
    items = [leaves(it) for it in root.iter("servList")]
    print(f"목록 {len(items)}건" + (f" (전체 {total}건)" if total else ""))
    RAW_DIR.mkdir(exist_ok=True)
    for it in items:
        sid = it.get("servId")
        if not sid:
            continue
        detail = parse_detail(call(base, detail_op, key, servId=sid, **({} if args.local else {"callTp": "D"})))
        name = detail.get("servNm") or it.get("servNm", sid)
        if args.local:
            region = " ".join(x for x in [it.get("ctpvNm"), it.get("sggNm")] if x) or "지자체"
        else:
            region = f"중앙부처 ({detail.get('jurMnofNm') or it.get('jurMnofNm', '')})".replace(" ()", "")
        body = format_body(detail)
        (RAW_DIR / f"api_{sid}.txt").write_text(
            f"# 서비스명: {name}\n# 제공주체: {region}\n# 출처: 공공데이터포털 복지서비스 API (servId={sid})\n\n" + "\n".join(body) + "\n",
            encoding="utf-8")
        print(f"  저장: api_{sid}.txt  {name}")
        time.sleep(0.2)


if __name__ == "__main__":
    main()
