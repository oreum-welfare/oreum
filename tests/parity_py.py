"""세 엔진 일치 검사 1단계: 파이썬 엔진(rules.py)으로 테스트 가구를 계산해 JSON으로 저장한다.

실행: python tests/parity_py.py  →  tests/py_out.json
다음 단계: node tests/parity.mjs (JS 엔진과 비교)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from rules import Household, find_cliffs, median_income, simulate  # noqa: E402

cases = json.loads((ROOT / "tests" / "cases.json").read_text(encoding="utf-8"))
out = []
for c in cases:
    hh = Household(**c)
    mx = int(round(median_income(hh.size), -4))
    df, el = simulate(hh, mx)
    out.append({
        "disp": [round(x, 4) for x in df["disposable"]],
        "cliffs": [[x["income"], round(x["drop"], 4), x["lost"]] for x in find_cliffs(df, el)],
    })
(ROOT / "tests" / "py_out.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(f"파이썬 엔진: 테스트 가구 {len(out)}개 계산 완료")
