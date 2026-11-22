"""오름 - 복지 절벽 판정 규칙 엔진 (파이썬, 데이터 분석용)

규칙과 금액은 data/rules.json 한 곳에서 읽는다 (React 앱의 JS 엔진과 같은 파일).
금액을 바꿀 때는 rules.json만 고치면 웹과 분석에 함께 반영된다.
계산 로직을 바꾸면 oreum-web/src/lib/engine.js도 똑같이 바꿔야 한다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

import pandas as pd

DATA = json.loads((Path(__file__).parent / "data" / "rules.json").read_text(encoding="utf-8"))
_P = DATA["params"]


def _intkeys(d: dict) -> dict:
    return {int(k): v for k, v in d.items()}


YEAR = DATA["year"]
SAENG_LINE = _intkeys(DATA["lines"]["saeng_32"])
JUGEO_LINE = _intkeys(DATA["lines"]["jugeo_48"])

EARNED_DEDUCTION_RATE = _P["earned_deduction_rate"]
YOUTH_DEDUCTION = _P.get("youth_deduction")
SENIOR_DISABLED_DEDUCTION = _P.get("senior_disabled_deduction")
RENT = {g: _intkeys(v) for g, v in _P["rent"].items()}
JUGEO_SELF_SHARE = _P["jugeo_self_share"]
EDU_ANNUAL = _P["edu_annual"]
ENERGY_ANNUAL = _intkeys(_P["energy_annual"])
TELECOM_MONTHLY = _P["telecom_monthly"]
MEDICAL_VALUE_PER_PERSON = _P["medical_value_per_person"]
BASIC_PENSION_LINE = _P["basic_pension_line"]
BASIC_PENSION_EARNED_DEDUCTION = _P["basic_pension_earned_deduction"]
BASIC_PENSION_AMOUNT = _P["basic_pension_amount"]
BASIC_PENSION_COUPLE_CUT = _P["basic_pension_couple_cut"]
EITC = {k: tuple(v) for k, v in _P["eitc"].items()}
CTC_MAX_PER_CHILD = _P["ctc_max_per_child"]
CTC_LIMIT = _P["ctc_limit"]
CTC_FULL_UNTIL = _P["ctc_full_until"]
SP_CHILD = _P.get("sp_child")
MUNHWA = _P.get("munhwa")
DIS_PENSION = _P.get("dis_pension")
REGIONS = DATA["regions"]
ASSETS = _P.get("assets")


def line_at(table: dict, size: int) -> float:
    """7인 이상 가구: 1인이 늘 때마다 '6인 기준 − 5인 기준' 차이를 6인 기준에 더한다 (engine.js lineAt과 같음)."""
    s = max(1, size)
    return table[s] if s <= 6 else table[6] + (table[6] - table[5]) * (s - 6)


def median_income(size: int) -> int:
    """기준중위소득 100% (월). 생계급여 32% 기준표에서 역산 (주거급여 48% 표와 일치 확인)."""
    return round(line_at(SAENG_LINE, size) / 0.32)


def rent_for(grade: str, size: int) -> float:
    """기준임대료 (고시): 7인은 6인과 같고, 8인부터 2인 늘 때마다 6인 기준의 10%를 더한다 (engine.js rentFor와 같음)."""
    row = RENT[grade]
    if size <= 7:
        return row[min(max(1, size), 6)]
    return row[6] + row[6] * ((size - 6) // 2) / 10


def jugeo_line(size: int) -> int:
    if size <= 6 and max(1, size) in JUGEO_LINE:
        return JUGEO_LINE[max(1, size)]
    return round(median_income(size) * 0.48)


# ---------------------------------------------------------------------------
# 가구 정보
# ---------------------------------------------------------------------------
@dataclass
class Household:
    region: str = "경상북도 경산시"
    age: int = 40
    spouse: bool = False
    spouse_65: bool = False
    dual_earner: bool = False
    infants: int = 0  # 0~6세 (영유아)
    elem: int = 0
    middle: int = 0
    high: int = 0
    newborn: bool = False
    birth_order: int = 1
    disabled: bool = False
    severe_disabled: bool = False  # 심한 장애 (장애인연금 대상)
    single_parent: bool = False
    third_child_7to18: bool = False
    residence_months: int = 60
    housing_asset: float = 0  # 주택·전세보증금 (원)
    financial_asset: float = 0  # 예금·적금 등 (원)
    debt: float = 0  # 부채 (원)

    @property
    def children(self) -> int:
        return self.infants + self.elem + self.middle + self.high

    @property
    def school_kids(self) -> int:
        return self.elem + self.middle + self.high

    @property
    def size(self) -> int:
        return 1 + int(self.spouse) + self.children  # 7인 이상도 그대로 (기준선은 line_at으로 늘림)

    @property
    def is_disabled(self) -> bool:
        return self.disabled or self.severe_disabled

    @property
    def seniors(self) -> int:
        return int(self.age >= 65) + int(self.spouse and self.spouse_65)


@dataclass
class Benefit:
    id: str
    name: str
    level: str  # 중앙 / 지자체
    kind: str  # cash(현금) / inkind(감면·현물) / access(자격·융자)
    monthly: float
    note: str = ""


KIND_LABEL = {"cash": "현금", "inkind": "감면·현물", "access": "자격·융자"}


def _eitc_type(hh: Household) -> str:
    if hh.dual_earner:
        return "dual"
    if hh.spouse or hh.children > 0:
        return "one"
    return "single"


def _eitc(annual: float, typ: str) -> float:
    a, b, c, mx = EITC[typ]
    if annual <= 0 or annual >= c:
        return 0.0
    if annual < a:
        return mx * annual / a
    if annual <= b:
        return float(mx)
    return mx * (c - annual) / (c - b)


def _ctc(annual: float, typ: str, kids: int) -> float:
    if kids == 0 or typ == "single" or annual >= CTC_LIMIT:
        return 0.0
    full_until = CTC_FULL_UNTIL[typ]
    if annual <= full_until:
        return CTC_MAX_PER_CHILD * kids
    ratio = 1 - 0.5 * (annual - full_until) / (CTC_LIMIT - full_until)
    return CTC_MAX_PER_CHILD * kids * ratio


def _asset_incomes(hh: Household, region: dict) -> tuple[float, float, float]:
    """재산의 소득환산액 (월): (기초생활보장·한부모 방식, 기초연금·장애인연금 방식, 장려금 재산 요건 배율)"""
    if not ASSETS:
        return 0.0, 0.0, 1.0
    a_basic, a_pen, a_eitc = ASSETS["basic"], ASSETS["pension"], ASSETS["eitc"]
    H, F, D = hh.housing_asset, hh.financial_asset, hh.debt
    hin = min(H, region["housing_limit"])
    hover = H - hin
    fin = max(0, F - a_basic["financial_living_allowance"])
    ded = region["asset_base"] + D  # 기본재산액·부채: 주거용(한도 내) → 한도 초과분 → 금융재산 순으로 공제
    t = min(hin, ded); hin -= t; ded -= t
    t = min(hover, ded); hover -= t; ded -= t
    t = min(fin, ded); fin -= t
    basic = hin * a_basic["rate_housing"] + hover * a_basic["rate_general"] + fin * a_basic["rate_financial"]
    general = max(0, H - region["pension_asset_deduction"])
    pfin = max(0, F - a_pen["financial_deduction"])
    pension = (max(0, general + pfin - D) * a_pen["annual_rate"]) / 12
    total = H + F
    factor = 0.0 if total >= a_eitc["limit"] else 0.5 if total >= a_eitc["half_from"] else 1.0  # 1억7천만 원 이상 50%
    return basic, pension, factor


# ---------------------------------------------------------------------------
# 판정
# ---------------------------------------------------------------------------
def normalize(hh: Household) -> Household:
    """입력값 정리: 자녀 수·나이는 0 이상의 정수, 배우자가 있으면 한부모 가구가 아님 (engine.js normalize와 같음)."""
    def to_int(v) -> int:
        try:
            return max(0, int(float(v or 0) // 1))
        except (TypeError, ValueError):
            return 0
    kids = [to_int(hh.infants), to_int(hh.elem), to_int(hh.middle), to_int(hh.high)]
    return replace(hh, age=to_int(hh.age), infants=kids[0], elem=kids[1], middle=kids[2], high=kids[3],
                   birth_order=min(4, max(1, to_int(hh.birth_order) or 1), max(1, sum(kids))),  # 자녀 수보다 클 수 없음
                   newborn=bool(hh.newborn and kids[0] >= 1),
                   residence_months=to_int(hh.residence_months),
                   housing_asset=max(0.0, float(hh.housing_asset or 0)), financial_asset=max(0.0, float(hh.financial_asset or 0)),
                   debt=max(0.0, float(hh.debt or 0)),
                   third_child_7to18=bool(hh.third_child_7to18 and sum(kids) >= 3 and sum(kids[1:]) >= 1),
                   single_parent=bool(hh.single_parent and not hh.spouse),
                   spouse_65=bool(hh.spouse and hh.spouse_65), dual_earner=bool(hh.spouse and hh.dual_earner))


def evaluate(hh: Household, earned: float) -> list[Benefit]:
    hh = normalize(hh)
    """월 근로소득(가구 합계) earned 일 때 받을 수 있는 혜택 목록."""
    size = hh.size
    m = median_income(size)
    region = REGIONS[hh.region]
    out: list[Benefit] = []
    asset_basic, asset_pension, eitc_factor = _asset_incomes(hh, region)

    # 기초연금 (소득인정액 계산에 들어가므로 먼저)
    bp = 0.0
    if hh.seniors > 0:  # 본인 또는 배우자 중 65세 이상인 사람이 받는다 (부부가구는 부부 선정기준액)
        couple = hh.spouse
        line = BASIC_PENSION_LINE["couple" if couple else "single"]
        eval_income = 0.7 * max(0.0, earned - BASIC_PENSION_EARNED_DEDUCTION) + asset_pension
        if eval_income <= line:
            if hh.seniors == 2:
                bp = 2 * BASIC_PENSION_AMOUNT * (1 - BASIC_PENSION_COUPLE_CUT)
            else:
                bp = BASIC_PENSION_AMOUNT
            out.append(Benefit("basic_pension", "기초연금", "중앙", "cash", bp,
                               "소득인정액이 선정기준액 이하"))

    # 장애인연금 기초급여 (18~64세 중증장애인). 기초연금처럼 생계급여 소득인정액에 포함(추정)
    dp_basic = 0.0
    if DIS_PENSION and hh.severe_disabled and DIS_PENSION["age_min"] <= hh.age <= DIS_PENSION["age_max"]:
        line = DIS_PENSION["line_couple"] if hh.spouse else DIS_PENSION["line_single"]
        if 0.7 * max(0.0, earned - DIS_PENSION["earned_deduction"]) + asset_pension <= line:
            dp_basic = DIS_PENSION["basic"]

    # 기초생활보장 소득인정액 = 소득평가액 + 재산의 소득환산액 + 기초연금·장애인연금 기초급여
    # 근로소득공제 (2026 사업안내): 청년(34세 이하) 60만 원, 노인(65세+)·장애인 20만 원을 먼저 뺀 뒤 30%
    flat = 0
    if YOUTH_DEDUCTION and hh.age <= YOUTH_DEDUCTION["age_max"]:
        flat = YOUTH_DEDUCTION["flat"]
    elif SENIOR_DISABLED_DEDUCTION and (hh.age >= SENIOR_DISABLED_DEDUCTION["age_min"] or hh.is_disabled):
        flat = SENIOR_DISABLED_DEDUCTION["flat"]
    eval_earned = max(0.0, earned - flat)
    ri = eval_earned * (1 - EARNED_DEDUCTION_RATE) + asset_basic + bp + dp_basic

    saeng_line = line_at(SAENG_LINE, size)
    saeng = max(0.0, saeng_line - ri)
    if saeng > 0:
        out.append(Benefit("saeng", "생계급여", "중앙", "cash", saeng,
                           "중위 32% − 소득인정액 (기초연금은 소득으로 차감됨)"))

    # 의료급여: 일반 근로소득공제 30%는 생계·주거·교육급여에만 적용. 의료급여는 유형별 공제(34세 이하·65세 이상·장애인 등)만 (2026 사업안내)
    ri_medical = (eval_earned * (1 - EARNED_DEDUCTION_RATE) if flat else earned) + asset_basic + bp + dp_basic
    medical = ri_medical <= 0.40 * m
    if medical:
        out.append(Benefit("medical", "의료급여", "중앙", "inkind", MEDICAL_VALUE_PER_PERSON * size,
                           "소득인정액 ≤ 중위 40%, 건강보험 전환 시 본인부담 추정 1인당 월 46,450원"))

    # 주거급여: 기준선 이하여도 지급액이 0원이면 수급자로 보지 않는다 (engine.js와 같음)
    jugeo_elig = False
    if ri <= jugeo_line(size):
        rent = rent_for(region["rent_grade"], size)
        deduct = 0.0 if ri <= saeng_line else JUGEO_SELF_SHARE * (ri - saeng_line)
        jugeo = max(0.0, rent - deduct)
        if jugeo > 0:
            jugeo_elig = True
            out.append(Benefit("jugeo", "주거급여", "중앙", "cash", jugeo,
                               f"소득인정액 ≤ 중위 48%, {region['rent_grade']} 기준임대료 (임차 가정)"))

    edu_elig = ri <= 0.50 * m and hh.school_kids > 0
    if edu_elig:
        edu = (hh.elem * EDU_ANNUAL["elem"] + hh.middle * EDU_ANNUAL["middle"]
               + hh.high * EDU_ANNUAL["high"]) / 12
        out.append(Benefit("edu", "교육급여", "중앙", "cash", edu, "소득인정액 ≤ 중위 50%, 정액"))

    recipient = saeng > 0 or medical or jugeo_elig or edu_elig
    near_poor = (not recipient) and ri <= 0.50 * m  # 차상위 근사

    trait = (hh.seniors > 0 or hh.infants > 0 or hh.is_disabled or hh.single_parent
             or hh.children >= 2)
    if recipient and trait:
        energy = ENERGY_ANNUAL[min(size, 4)] / 12
        out.append(Benefit("energy", "에너지바우처", "중앙", "inkind", energy,
                           "기초수급자 + 노인·영유아·장애인·한부모·다자녀 등"))

    if saeng > 0 or medical:
        out.append(Benefit("telecom", "이동통신요금 감면", "중앙", "inkind",
                           TELECOM_MONTHLY["saeng_medical"], "생계·의료급여 수급자 (월 최대)"))
    elif recipient or near_poor:
        out.append(Benefit("telecom", "이동통신요금 감면", "중앙", "inkind",
                           TELECOM_MONTHLY["housing_edu_nearpoor"], "주거·교육급여 수급자, 차상위 (월 최대)"))
    elif bp > 0 or hh.is_disabled:
        out.append(Benefit("telecom", "이동통신요금 감면", "중앙", "inkind",
                           TELECOM_MONTHLY["pension_disabled"], "기초연금 수급자, 장애인 (월 최대)"))

    # 문화누리카드: 6세 이상 기초수급자·차상위, 1인당 연 15만 원 (영유아 제외)
    if MUNHWA and (recipient or near_poor):
        n = 1 + int(hh.spouse) + hh.elem + hh.middle + hh.high
        out.append(Benefit("munhwa", "문화누리카드", "중앙", "inkind", MUNHWA["annual_per_person"] * n / 12,
                           f"기초수급자·차상위, 6세 이상 {n}명 × 연 {MUNHWA['annual_per_person']:,}원"))

    # 장애인연금 = 기초급여 + 부가급여(소득계층별)
    if dp_basic > 0:
        add = DIS_PENSION["additional"]
        extra = add["recipient"] if recipient else add["near_poor"] if near_poor else add["above"]
        out.append(Benefit("dis_pension", "장애인연금", "중앙", "cash", dp_basic + extra,
                           f"18~64세 중증장애인, 기초급여 {dp_basic:,.0f}원 + 부가급여 {extra:,}원"))
    elif DIS_PENSION and hh.severe_disabled and hh.age > DIS_PENSION["age_max"] and bp > 0:
        # 65세 이상: 기초급여 대신 기초연금, 부가급여만 계속 (금액은 18~64세 표 적용, 추정)
        add = DIS_PENSION["additional"]
        extra = add["recipient"] if recipient else add["near_poor"] if near_poor else add["above"]
        out.append(Benefit("dis_pension", "장애인연금(부가급여)", "중앙", "cash", extra,
                           f"65세 이상 중증장애인 + 기초연금 수급, 부가급여 {extra:,}원 (65세 이상 금액은 추정)"))

    typ = _eitc_type(hh)
    annual = earned * 12
    e = _eitc(annual, typ) * eitc_factor
    if e > 0:
        out.append(Benefit("eitc", "근로장려금", "중앙", "cash", e / 12,
                           "연 지급액을 월로 환산 (전년도 소득 기준 지급)"))
    c = _ctc(annual, typ, hh.children) * eitc_factor
    if c > 0:
        out.append(Benefit("ctc", "자녀장려금", "중앙", "cash", c / 12, "연 지급액을 월로 환산"))

    # 한부모가족 아동양육비: 소득인정액(근로소득 30% 공제) ≤ 중위 65%, 18세 미만 자녀 1인당 월 23만 원
    if SP_CHILD and hh.single_parent and hh.children > 0:
        ri_sp = earned * (1 - EARNED_DEDUCTION_RATE) + asset_basic
        if ri_sp <= SP_CHILD["pct_median"] / 100 * m:
            out.append(Benefit("sp_child", "한부모 아동양육비", "중앙", "cash", SP_CHILD["monthly_per_child"] * hh.children,
                               f"한부모 + 소득인정액 ≤ 중위 {SP_CHILD['pct_median']}%, 자녀 {hh.children}명 × 월 {SP_CHILD['monthly_per_child']:,}원"))

    # ---- 지자체 (rules.json local_programs 중 이 지역의 '승인' 제도만, engine.js와 같음) ----
    recipient_status = [s for s, ok in (("생계", saeng > 0), ("의료", medical), ("주거", jugeo_elig),
                                         ("교육", edu_elig), ("차상위", near_poor)) if ok]
    facts = {
        "age": hh.age, "household_size": size, "income_recognized_pct_median": ri / m * 100, "income_recognized_won": ri,
        "total_income_annual": earned * 12, "assets": hh.housing_asset + hh.financial_asset, "recipient_status": recipient_status,
        "basic_pension_recipient": bp > 0, "residence_months": hh.residence_months, "child_count": hh.children,
        "newborn": hh.newborn, "school_enrolled": hh.school_kids > 0, "disabled": hh.is_disabled,
        "single_parent": hh.single_parent, "senior_in_household": hh.seniors > 0,
        "third_child_7to18": hh.third_child_7to18, "child_birth_order": hh.birth_order,
    }
    for prog in local_programs_for(hh.region):
        f = dict(facts)
        rate_key = (prog.get("facts") or {}).get("nhis_premium_rate")
        if rate_key:
            f["nhis_premium"] = earned * _P[rate_key]
        if not conditions_met(prog.get("conditions"), f):
            continue
        monthly, vars_ = _program_amount(prog["amount"], hh)
        out.append(Benefit(prog["id"], prog["name"], "지자체", prog["kind"], monthly, _fill_note(prog.get("note", ""), vars_)))
    return out


# ---------------------------------------------------------------------------
# 지자체 제도 (데이터). engine.js의 localProgramsFor·conditionsMet과 같다.
# ---------------------------------------------------------------------------
LOCAL_PROGRAMS = DATA.get("local_programs", [])


def _param_value(v):
    return _P[v[1:]] if isinstance(v, str) and v.startswith("@") else v


def local_programs_for(region_key: str) -> list[dict]:
    region = REGIONS.get(region_key)
    return [p for p in LOCAL_PROGRAMS if p.get("status") == "승인"
            and (p["region"] == region_key if p.get("region") else bool(p.get("sido") and region and p["sido"] == region["sido"]))]


def _condition_ok(c: dict, facts: dict) -> bool:
    if c["field"] not in facts or facts[c["field"]] is None:
        return False  # 판정할 수 없는 항목(other 등)
    fact = facts[c["field"]]
    raw = _param_value(c["value"])
    items = [s.strip() for s in str(raw).split(",")]
    if c["op"] in ("in", "not_in"):
        hit = any(str(x) in items for x in fact) if isinstance(fact, (list, set, tuple)) else str(fact) in items
        return hit if c["op"] == "in" else not hit
    if isinstance(fact, bool):
        return c["op"] == "==" and fact == (str(raw) == "true")
    x = float(fact)
    if c["op"] == "between":
        return float(items[0]) <= x <= float(items[1])
    v = float(raw)
    return {"<=": x <= v, "<": x < v, ">=": x >= v, ">": x > v, "==": x == v}.get(c["op"], False)


def conditions_met(conds, facts: dict) -> bool:
    groups: dict[str, list] = {}
    for c in conds or []:
        if not c.get("group"):
            if not _condition_ok(c, facts):
                return False
        else:
            groups.setdefault(c["group"], []).append(c)
    return all(any(_condition_ok(c, facts) for c in g) for g in groups.values())


def _won(n) -> str:
    n = float(n)
    return f"{int(n):,}" if n == int(n) else f"{n:,}"


def _program_amount(a: dict, hh: Household) -> tuple[float, dict]:
    if a["type"] == "per_senior":
        return _P[a["param"]] * hh.seniors, {}
    if a["type"] == "by_birth_order":
        amt, months = _P[a["param"]][str(min(hh.birth_order, 4))]
        return amt, {"amount": _won(amt), "months": months, "lump": _won(_P.get(a.get("lump_param"), 0))}
    if a["type"] == "child_band_annual":
        # 셋째의 나이를 알 수 없어, 초·중학생이 있으면 7~15세, 고등학생만 있으면 16~18세 금액 (engine.js와 같음)
        band = "7-15" if hh.elem + hh.middle > 0 else "16-18"
        annual = _P[a["param"]][band]
        return annual / 12, {"annual_man": _won(annual / 10000), "band_label": "7~15세" if band == "7-15" else "16~18세"}
    return (_P[a["param"]] if a.get("param") else a.get("monthly", 0)), {}  # fixed


def _fill_note(note: str, vars_: dict) -> str:
    import re
    return re.sub(r"\{(\w+)\}", lambda mt: str(vars_.get(mt.group(1), "{" + mt.group(1) + "}")), note or "")


def simulate(hh: Household, max_income: int, step: int = 10_000,
             include_inkind: bool = True) -> tuple[pd.DataFrame, list[set[str]]]:
    rows, elig = [], []
    for inc in range(0, max_income + 1, step):  # 최대 소득을 넘지 않음 (engine.js와 같음)
        bs = evaluate(hh, inc)
        row = {"income": inc}
        for b in bs:
            if b.kind == "cash" or (include_inkind and b.kind == "inkind"):
                row[b.name] = b.monthly
        rows.append(row)
        elig.append({b.name for b in bs})
    df = pd.DataFrame(rows).fillna(0.0)
    cols = [c for c in df.columns if c != "income"]
    df["benefit_total"] = df[cols].sum(axis=1)
    df["disposable"] = df["income"] + df["benefit_total"]
    return df, elig


def find_cliffs(df: pd.DataFrame, elig: list[set[str]], min_drop: float = 1_000) -> list[dict]:
    """소득이 한 단계 늘었는데 '근로소득 + 혜택' 합계가 줄어드는 지점."""
    cliffs = []
    disp = df["disposable"].tolist()
    inc = df["income"].tolist()
    for i in range(1, len(df)):
        drop = disp[i - 1] - disp[i]
        if drop >= min_drop:
            lost = sorted(elig[i - 1] - elig[i])
            cliffs.append({"income": inc[i], "drop": drop, "lost": lost})
    return cliffs


# ---------------------------------------------------------------------------
# 화면 표시용 메타데이터
# ---------------------------------------------------------------------------
RULE_TABLE = [(r["service"], r["provider"], r["condition"], r["status"], r["amount"])
              for r in DATA["rule_table"]]
ASSUMPTIONS = DATA["assumptions"]
