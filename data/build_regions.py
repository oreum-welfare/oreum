"""전국 시군구 목록(data/sources/regions.csv)으로 rules.json의 regions를 만든다.

중앙 제도는 전국 공통이고, 지역에 따라 달라지는 값은 아래 4개뿐이다.
  - 주거급여 기준임대료 급지      (국토교통부고시 제2025-506호 기준임대료 표)
  - 기초생활보장 기본재산액       (2026 사업안내, 복지로 모의계산 '거주지별 기본공제 재산액')
  - 기초생활보장 주거용재산 한도  (2026 사업안내)
  - 기초연금 기본재산 공제        (기초연금 선정기준 고시 제8조, 적용지역 구분 포함)

실행: python data/build_regions.py  (rules.json의 regions·region_classes만 바꾼다)
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).parent
RULES = ROOT / "rules.json"
CSV = ROOT / "sources" / "regions.csv"

METRO = {"부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시"}

# 기초생활보장 기본재산액·주거용재산 한도 (원)
ASSET = {
    "서울": (99_000_000, 172_000_000),
    "경기": (80_000_000, 151_000_000),
    "광역시": (77_000_000, 146_000_000),   # 광역시·세종·창원
    "그 외 지역": (53_000_000, 112_000_000),
}
# 기초연금 기본재산 공제 (원). 대도시: 특별시·광역시의 구(군 포함)·특례시 / 중소도시: 도의 시·세종 / 농어촌: 도의 군
PENSION = {"대도시": 135_000_000, "중소도시": 85_000_000, "농어촌": 72_500_000}
# 주거급여 급지: 1급지 서울 / 2급지 경기·인천 / 3급지 광역시·세종·수도권 외 특례시 / 4급지 그 외
RENT_GRADE = {1: "1급지(서울)", 2: "2급지(경기·인천)", 3: "3급지(광역시·세종·창원)", 4: "4급지(그 외 지역)"}


def classify(sido: str, typ: str) -> dict:
    if sido == "서울특별시":
        grade, asset, pension = 1, "서울", "대도시"
    elif sido == "인천광역시":
        grade, asset, pension = 2, "광역시", "대도시"
    elif sido in METRO:
        grade, asset, pension = 3, "광역시", "대도시"
    elif sido == "세종특별자치시":
        grade, asset, pension = 3, "광역시", "중소도시"
    elif sido == "경기도":
        grade, asset = 2, "경기"
        pension = "대도시" if typ == "특례시" else ("농어촌" if typ == "군" else "중소도시")
    elif typ == "특례시":  # 수도권 밖 특례시 = 창원시
        grade, asset, pension = 3, "광역시", "대도시"
    else:
        grade, asset = 4, "그 외 지역"
        pension = "농어촌" if typ == "군" else "중소도시"
    base, limit = ASSET[asset]
    return {
        "rent_grade": RENT_GRADE[grade],
        "asset_class": asset,
        "asset_base": base,
        "housing_limit": limit,
        "pension_class": pension,
        "pension_asset_deduction": PENSION[pension],
    }


def main() -> None:
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    regions = {}
    with CSV.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sido, sgg, typ = row["시도"], row["시군구"], row["유형"]
            key = f"{sido} {sgg}".strip()
            regions[key] = {"sido": sido, "sigungu": sgg or sido, "type": typ, **classify(sido, typ)}
    rules["regions"] = regions
    rules["region_classes"] = {
        "note": "지역별로 달라지는 중앙 제도 값. data/build_regions.py가 data/sources/regions.csv로 만든다.",
        "asset": {k: {"asset_base": v[0], "housing_limit": v[1]} for k, v in ASSET.items()},
        "pension_asset_deduction": PENSION,
        "rent_grades": list(RENT_GRADE.values()),
    }
    # 기준임대료 급지 이름 정리 (3급지는 창원 포함)
    rent = rules["params"]["rent"]
    if "3급지(광역시·세종)" in rent:
        rent["3급지(광역시·세종·창원)"] = rent.pop("3급지(광역시·세종)")
    rent.setdefault("1급지(서울)", {"1": 369000, "2": 414000, "3": 492000, "4": 571000, "5": 591000, "6": 699000})
    rent.setdefault("2급지(경기·인천)", {"1": 300000, "2": 335000, "3": 401000, "4": 463000, "5": 479000, "6": 568000})
    rules["params"]["rent"] = {g: rent[g] for g in RENT_GRADE.values()}
    RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"regions {len(regions)}곳 저장")


if __name__ == "__main__":
    main()
