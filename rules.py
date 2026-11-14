"""오름 - 복지 절벽 판정 규칙 엔진 (파이썬, 데이터 분석용)

규칙과 금액은 data/rules.json 한 곳에서 읽는다 (React 앱의 JS 엔진과 같은 파일).
금액을 바꿀 때는 rules.json만 고치면 웹과 분석에 함께 반영된다.
계산 로직을 바꾸면 oreum-app/src/lib/engine.js도 똑같이 바꿔야 한다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
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
GS_BIRTH_MONTHLY = {int(k): tuple(v) for k, v in _P["gs_birth_monthly"].items()}
GS_BIRTH_LUMP = _P["gs_birth_lump"]
GS_CLINIC_VALUE = _P["gs_clinic_value"]
GS_MULTICHILD_ANNUAL = _P["gs_multichild_annual"]
SP_CHILD = _P.get("sp_child")
MUNHWA = _P.get("munhwa")
DIS_PENSION = _P.get("dis_pension")
BUKGU_NHIS_RATE = _P["bukgu_nhis_rate"]
BUKGU_MIN_PREMIUM = _P["bukgu_min_premium"]
BUKGU_NHIS_VALUE = _P["bukgu_nhis_value"]
REGIONS = DATA["regions"]
ASSETS = _P.get("assets")


def median_income(size: int) -> int:
    """기준중위소득 100% (월). 생계급여 32% 기준표에서 역산 (주거급여 48% 표와 일치 확인)."""
    s = min(max(size, 1), 6)
    return round(SAENG_LINE[s] / 0.32)


def jugeo_line(size: int) -> int:
    s = min(max(size, 1), 6)
    return JUGEO_LINE.get(s, round(median_income(s) * 0.48))


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
        return min(1 + int(self.spouse) + self.children, 6)

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
    factor = 0.0 if total >= a_eitc["limit"] else 0.5 if total > a_eitc["half_over"] else 1.0
    return basic, pension, factor


# ---------------------------------------------------------------------------
# 판정
# ---------------------------------------------------------------------------
def evaluate(hh: Household, earned: float) -> list[Benefit]:
    """월 근로소득(가구 합계) earned 일 때 받을 수 있는 혜택 목록."""
    size = hh.size
    m = median_income(size)
    region = REGIONS[hh.region]
    out: list[Benefit] = []
    asset_basic, asset_pension, eitc_factor = _asset_incomes(hh, region)

    # 기초연금 (소득인정액 계산에 들어가므로 먼저)
    bp = 0.0
    if hh.age >= 65:
        couple = hh.spouse
        line = BASIC_PENSION_LINE["couple" if couple else "single"]
        eval_income = 0.7 * max(0.0, earned - BASIC_PENSION_EARNED_DEDUCTION) + asset_pension
        if eval_income <= line:
            if couple and hh.spouse_65:
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

    saeng_line = SAENG_LINE[size]
    saeng = max(0.0, saeng_line - ri)
    if saeng > 0:
        out.append(Benefit("saeng", "생계급여", "중앙", "cash", saeng,
                           "중위 32% − 소득인정액 (기초연금은 소득으로 차감됨)"))

    medical = ri <= 0.40 * m
    if medical:
        out.append(Benefit("medical", "의료급여", "중앙", "inkind", MEDICAL_VALUE_PER_PERSON * size,
                           "소득인정액 ≤ 중위 40%, 건강보험 전환 시 본인부담 추정 1인당 월 46,450원"))

    jugeo_elig = ri <= jugeo_line(size)
    if jugeo_elig:
        rent = RENT[region["rent_grade"]][size]
        deduct = 0.0 if ri <= saeng_line else JUGEO_SELF_SHARE * (ri - saeng_line)
        jugeo = max(0.0, rent - deduct)
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

    # ---- 지자체 ----
    if hh.region == "경상북도 경산시":
        if hh.seniors > 0:
            out.append(Benefit("gs_clinic", "65세 이상 진료비 감면", "지자체", "inkind",
                               GS_CLINIC_VALUE * hh.seniors, "경산시 주민등록 65세 이상, 보건기관 내과"))
        if hh.newborn:
            amt, months = GS_BIRTH_MONTHLY[min(hh.birth_order, 4)]
            out.append(Benefit("gs_birth", "출산장려금", "지자체", "cash", amt,
                               f"월 {amt:,}원 × {months}개월 + 출산축하금 {GS_BIRTH_LUMP:,}원(일시)"))
        if saeng > 0 or medical or jugeo_elig:
            out.append(Benefit("gs_loan", "저소득주민생활안정자금(융자)", "지자체", "access", 0,
                               "생계·의료·주거 수급자, 최대 1,200만 원 융자"))
        if hh.third_child_7to18 and hh.residence_months >= 36:
            out.append(Benefit("gs_multichild", "다자녀가정 지원", "지자체", "cash", GS_MULTICHILD_ANNUAL["7-15"] / 12,
                               "셋째 이상 + 3년 이상 거주, 연 50만 원(7~15세) 기준 월 환산 (16~18세는 연 100만 원)"))
    elif hh.region == "대구광역시 북구":
        qualifying = hh.seniors > 0 or hh.is_disabled or hh.single_parent
        premium = earned * BUKGU_NHIS_RATE
        if qualifying and not medical and premium <= BUKGU_MIN_PREMIUM:
            out.append(Benefit("bk_nhis", "건강보험료지원", "지자체", "inkind", BUKGU_NHIS_VALUE,
                               "의료급여 수급권자 아님 + 최저보험료 이하 + 노인·장애인·한부모, 건강·장기요양보험료 전액 (조례)"))
    return out


def simulate(hh: Household, max_income: int, step: int = 10_000,
             include_inkind: bool = True) -> tuple[pd.DataFrame, list[set[str]]]:
    rows, elig = [], []
    for inc in range(0, max_income + step, step):
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
