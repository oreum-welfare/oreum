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


def first_line(source: str) -> str:
    """근거 인용으로 쓸 원문 한 줄 (원문에 실제로 있는 문장)"""
    return next(line.strip() for line in source.splitlines() if len(line.strip()) >= 5)


def as_ai(gold: dict, source: str) -> dict:
    """정답을 그대로 AI 결과 형식으로 바꾼다 (근거 인용은 원문 첫 줄)."""
    ev = first_line(source)
    conds = []
    for c in gold["conditions"]:
        f = c["field"][0] if isinstance(c["field"], list) else c["field"]
        conds.append({"field": f, "op": c["op"], "value": c["value"], "group": c.get("group", ""), "evidence": ev})
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
    r = evaluate_service(g, as_ai(g, src), src)
    check(f"정답 그대로 넣으면 정답 - {n}", r["correct"] == r["gold_required"] and not r["extras"] and r["precision_hits"] == r["ai_conditions"],
          f"조건 {r['correct']}/{r['gold_required']}, 정밀도 {r['precision_hits']}/{r['ai_conditions']}")

# 3. 에너지바우처: '하나만 충족'(OR)을 '모두 충족'(AND)으로 바꾸면 오답
g, src = load("c06_energy")
ai = as_ai(g, src)
for c in ai["conditions"]:
    c["group"] = ""
r = evaluate_service(g, ai, src)
check("AND/OR 바꿈은 오답", not r["service_ok"] and r["correct"] < r["gold_required"],
      f"조건 {r['correct']}/{r['gold_required']}, " + ", ".join(sorted({d['result'] for d in r['details']})))

# 4. 기초연금: '65세 이상'을 '65세 이하'로 바꾸면 정밀도도 100%가 아님
g, src = load("c05_basic_pension")
ai = as_ai(g, src)
for c in ai["conditions"]:
    if c["field"] == "age":
        c["op"] = "<="
r = evaluate_service(g, ai, src)
check("이상↔이하 바꿈은 정밀도에서도 제외", r["precision_hits"] < r["ai_conditions"] and not r["service_ok"],
      f"정밀도 {r['precision_hits']}/{r['ai_conditions']}")

# 5. 경산 생활안정자금: 지역명을 빈칸으로 두면 오답
g, src = load("l02_gs_loan")
ai = as_ai(g, src)
for c in ai["conditions"]:
    if c["field"] == "residence_region":
        c["value"] = ""
r = evaluate_service(g, ai, src)
check("지역명 빈칸은 오답", not r["service_ok"] and r["correct"] < r["gold_required"], f"조건 {r['correct']}/{r['gold_required']}")

# (2차) 4. 목록 조건을 '!=' 여러 개로 나눠 쓰면 오답
g, src = load("c06_energy")
ai = as_ai(g, src)
rs = [c for c in ai["conditions"] if c["field"] == "recipient_status"][0]
ai["conditions"].remove(rs)
for v in rs["value"].split(","):
    ai["conditions"].append({"field": "recipient_status", "op": "!=", "value": v, "group": "수급", "evidence": first_line(src)})
r = evaluate_service(g, ai, src)
check("목록 조건을 '!='로 나눠 쓰면 오답", not r["service_ok"] and r["correct"] < r["gold_required"])

# (2차) 5. 지역명을 '경' 한 글자로 쓰면 오답, '경산'처럼 정답을 담으면 정답
g, src = load("l02_gs_loan")
ai = as_ai(g, src)
for c in ai["conditions"]:
    if c["field"] == "residence_region":
        c["value"] = "경"
r_bad = evaluate_service(g, ai, src)
for c in ai["conditions"]:
    if c["field"] == "residence_region":
        c["value"] = "경상북도 경산시"
r_ok = evaluate_service(g, ai, src)
check("지역명 '경'은 오답, '경상북도 경산시'는 정답", not r_bad["service_ok"] and r_ok["correct"] == r_ok["gold_required"])

# (2차) 6. 정답 값이 '*'인 조건에 엉뚱한 값을 넣으면 정밀도에서 정답으로 세지 않음 (미검증)
g, src = load("c04_edu")
ai = as_ai(g, src)
ai["conditions"].append({"field": "child_age", "op": "between", "value": "40,99", "group": "", "evidence": first_line(src)})
r = evaluate_service(g, ai, src)
check("정답 값이 '*'인 조건의 엉뚱한 값은 정밀도에서 제외(미검증)", "child_age between 40,99" in r["unverified"] and r["precision_hits"] == r["precision_base"] - len(r["extras"]))

# (2차) 7. 근거 인용이 원문과 다르면 서비스 오답
g, src = load("c05_basic_pension")
ai = as_ai(g, src)
for c in ai["conditions"]:
    c["evidence"] = "원문에 없는 문장"
r = evaluate_service(g, ai, src)
check("근거 인용이 원문과 다르면 서비스 오답", not r["service_ok"])

# (2차) 8. 나이 65를 65.3으로 쓰면 오답 (기준값은 정확히)
g, src = load("c05_basic_pension")
ai = as_ai(g, src)
for c in ai["conditions"]:
    if c["field"] == "age":
        c["value"] = "65.3"
r = evaluate_service(g, ai, src)
check("나이 65 → 65.3은 오답", not r["service_ok"])

if bad:
    sys.exit(f"{bad}개 검사 실패")
print("채점기 검사 모두 통과")
