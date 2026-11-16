"""AI 채점기 검사: 일부러 틀리게 바꾼 AI 규칙을 채점기가 잡아내는지 확인한다.

실행: python tests/grader_checks.py
팀원 테스트에서 발견된 경우(AND/OR 바꿈, 이상↔이하 바꿈, 지역명 빈칸)가 다시 정답으로 채점되지 않게 막는다.
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
sys.path.insert(0, str(PIPE))
from evaluate import evaluate_service  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")


def load(name: str):
    gold = json.loads((PIPE / "gold" / f"{name}.json").read_text(encoding="utf-8"))
    source = (PIPE / "raw" / f"{name}.txt").read_text(encoding="utf-8")
    return gold, source


def as_ai(gold: dict) -> dict:
    """정답을 그대로 AI 결과 형식으로 바꾼다 (근거 인용은 원문 첫 줄)."""
    conds = []
    for c in gold["conditions"]:
        f = c["field"][0] if isinstance(c["field"], list) else c["field"]
        conds.append({"field": f, "op": c["op"], "value": c["value"], "group": c.get("group", ""), "evidence": ""})
    return {"service_name": gold["id"], "judgeable": gold["judgeable"], "conditions": conds,
            "benefit": {"monthly_amount_won": gold["benefit"]["amount_accept"][0]}}


bad = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global bad
    bad += not ok
    print(f"{'통과' if ok else '실패'}: {name}{f' ({detail})' if detail else ''}")


# 0. 정답을 그대로 넣으면 정답
for n in ["c05_basic_pension", "c06_energy", "l02_gs_loan"]:
    g, src = load(n)
    r = evaluate_service(g, as_ai(g), src)
    check(f"정답 그대로 넣으면 정답 - {n}", r["correct"] == r["gold_required"] and not r["extras"] and r["precision_hits"] == r["ai_conditions"],
          f"조건 {r['correct']}/{r['gold_required']}, 정밀도 {r['precision_hits']}/{r['ai_conditions']}")

# 3. 에너지바우처: '하나만 충족'(OR)을 '모두 충족'(AND)으로 바꾸면 오답
g, src = load("c06_energy")
ai = as_ai(g)
for c in ai["conditions"]:
    c["group"] = ""
r = evaluate_service(g, ai, src)
check("AND/OR 바꿈은 오답", not r["service_ok"] and r["correct"] < r["gold_required"],
      f"조건 {r['correct']}/{r['gold_required']}, " + ", ".join(sorted({d['result'] for d in r['details']})))

# 4. 기초연금: '65세 이상'을 '65세 이하'로 바꾸면 정밀도도 100%가 아님
g, src = load("c05_basic_pension")
ai = as_ai(g)
for c in ai["conditions"]:
    if c["field"] == "age":
        c["op"] = "<="
r = evaluate_service(g, ai, src)
check("이상↔이하 바꿈은 정밀도에서도 제외", r["precision_hits"] < r["ai_conditions"] and not r["service_ok"],
      f"정밀도 {r['precision_hits']}/{r['ai_conditions']}")

# 5. 경산 생활안정자금: 지역명을 빈칸으로 두면 오답
g, src = load("l02_gs_loan")
ai = as_ai(g)
for c in ai["conditions"]:
    if c["field"] == "residence_region":
        c["value"] = ""
r = evaluate_service(g, ai, src)
check("지역명 빈칸은 오답", not r["service_ok"] and r["correct"] < r["gold_required"], f"조건 {r['correct']}/{r['gold_required']}")

if bad:
    sys.exit(f"{bad}개 검사 실패")
print("채점기 검사 모두 통과")
