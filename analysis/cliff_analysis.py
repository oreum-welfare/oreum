"""오름 - 복지 절벽 데이터 분석 (파이썬)

가구 유형(rules.json의 analysis_households) × 지역을 모두 시뮬레이션해서
절벽 요약표와 '혜택이 끊기는 구간' 분포를 CSV로 저장한다.
React 앱의 데이터 분석 페이지(/analysis)와 같은 계산이다.

실행:  python analysis/cliff_analysis.py
결과:  analysis/output/cliff_summary.csv, analysis/output/benefit_endings.csv
"""
from __future__ import annotations

import csv
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rules import DATA, Household, find_cliffs, median_income, simulate  # noqa: E402

REGIONS = DATA.get("analysis_regions") or list(DATA["regions"])  # 분석 대상 지역 (제안서 분석: 대구 북구·경산시)

STEP = 10_000
EXTRA = 100_000
RANGE = 2  # 분석 범위: 기준중위소득의 200% (Analysis.jsx와 같음)
OUT = Path(__file__).resolve().parent / "output"


def run_all() -> list[dict]:
    cases = []
    for t in DATA["analysis_households"]:
        for region in REGIONS:
            hh = Household(region=region, **t["hh"])
            m = median_income(hh.size)
            max_income = round(m * RANGE / STEP) * STEP
            df, elig = simulate(hh, max_income, STEP, include_inkind=True)
            cliffs = find_cliffs(df, elig)
            for c in cliffs:
                c["pct"] = c["income"] / m * 100
            incomes = df["income"].tolist()
            disp = df["disposable"].tolist()
            endings = [
                {"name": name, "income": incomes[i], "pct": incomes[i] / m * 100}
                for i in range(1, len(incomes))
                for name in sorted(elig[i - 1] - elig[i])  # 집합은 실행마다 순서가 달라 정렬해서 결과 파일 순서를 고정
            ]
            k = EXTRA // STEP
            retained = [disp[i + k] - disp[i] for i in range(len(disp) - k)]
            max_cliff = max(cliffs, key=lambda c: c["drop"]) if cliffs else None
            cases.append({
                "type": t["label"], "region": region, "size": hh.size, "median": m,
                "cliffs": cliffs, "endings": endings, "retained": retained, "max_cliff": max_cliff,
                "loss_zones": sum(1 for r in retained if r < 0),
            })
    return cases


def save(cases: list[dict]) -> None:
    OUT.mkdir(exist_ok=True)
    with open(OUT / "cliff_summary.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["가구유형", "지역", "가구원수", "기준중위소득", "절벽수", "첫절벽_소득", "첫절벽_중위%",
                    "최대손해", "최대손해_소득", "최대손해_중위%", "최대손해_사라지는혜택", "10만원더벌때_최악",
                    "10만원더벌때_평균증가액"])
        for c in cases:
            first, mc = (c["cliffs"][0] if c["cliffs"] else None), c["max_cliff"]
            w.writerow([
                c["type"], c["region"], c["size"], c["median"], len(c["cliffs"]),
                first["income"] if first else "", round(first["pct"], 1) if first else "",
                round(mc["drop"]) if mc else "", mc["income"] if mc else "", round(mc["pct"], 1) if mc else "",
                ", ".join(mc["lost"]) if mc else "", round(min(c["retained"])),
                round(sum(c["retained"]) / len(c["retained"])),
            ])
    with open(OUT / "benefit_endings.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["가구유형", "지역", "혜택", "끊기는_월소득", "중위%", "5%구간"])
        for c in cases:
            for e in c["endings"]:
                b = min(19, max(0, math.ceil(e["pct"] / 5) - 1))
                w.writerow([c["type"], c["region"], e["name"], e["income"], round(e["pct"], 1), f"{b * 5}~{b * 5 + 5}%"])


def report(cases: list[dict]) -> None:
    top = max((c for c in cases if c["max_cliff"]), key=lambda c: c["max_cliff"]["drop"])
    mc = top["max_cliff"]
    print(f"가장 큰 절벽: {top['type']} ({top['region']}) - 월 {mc['income']:,}원(중위 {mc['pct']:.0f}%)에서 "
          f"{mc['drop']:,.0f}원 손해 / 사라지는 혜택: {', '.join(mc['lost'])}")
    ends = [e for c in cases for e in c["endings"]]
    best = max(((frm, sum(1 for e in ends if frm < e["pct"] <= frm + 10)) for frm in range(0, RANGE * 100 - 9)), key=lambda x: x[1])
    print(f"혜택이 끊기는 지점 {len(ends)}개 중 {best[1] / len(ends):.0%}({best[1]}개)가 근로소득 기준 중위 {best[0]}~{best[0] + 10}% 구간")
    print(f"10만 원을 더 벌어도 손해인 구간이 있는 경우: {sum(1 for c in cases if c['loss_zones'])}/{len(cases)}")
    for r in REGIONS:
        cs = [c for c in cases if c["region"] == r and c["max_cliff"]]
        avg = sum(c["max_cliff"]["drop"] for c in cs) / len(cs) if cs else 0
        print(f"  {r}: 절벽 {sum(len(c['cliffs']) for c in cases if c['region'] == r)}개, 가장 큰 절벽 평균 {avg:,.0f}원")


if __name__ == "__main__":
    results = run_all()
    save(results)
    report(results)
    print(f"저장: {OUT / 'cliff_summary.csv'}, {OUT / 'benefit_endings.csv'}")
