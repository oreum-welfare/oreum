"""오름 AI 변환 파이프라인 - 판정 규칙 형식 (AI 출력과 사람이 만든 정답이 같은 형식을 쓴다)"""

# 판정 조건에 쓸 수 있는 항목 (오름 판정 엔진의 입력과 대응)
FIELDS = {
    "age": "신청자 나이 (세)",
    "household_size": "가구원 수 (명)",
    "income_recognized_pct_median": "소득인정액이 기준중위소득의 몇 % (예: 32, 48, 50)",
    "income_recognized_won": "소득인정액 금액 기준 (원/월)",
    "total_income_annual": "연간 총소득 기준 (원/년)",
    "assets": "재산 합계액 기준 (원)",
    "recipient_status": "기초생활보장 수급 자격 (값 예: 생계,의료,주거,교육,차상위)",
    "basic_pension_recipient": "기초연금 수급자 여부 (true/false)",
    "residence_region": "거주(주민등록) 지역 (값 예: 경산시, 대구광역시 북구)",
    "residence_months": "현 거주지 계속 거주 기간 (개월)",
    "child_count": "자녀 수 (명, 값에 나이 조건이 있으면 evidence에 남김)",
    "child_age": "자녀 나이 (세)",
    "child_birth_order": "자녀 출생 순위 (예: 3 = 셋째 이상)",
    "newborn": "신생아 출생 여부 (true/false)",
    "school_enrolled": "초·중·고 재학 여부 (true/false)",
    "disabled": "등록장애인 여부 (true/false)",
    "single_parent": "한부모가족 여부 (true/false)",
    "senior_in_household": "65세 이상(노인) 가구원 여부 (true/false)",
    "nhis_premium": "건강보험료 부과액 기준 (원/월 또는 '최저보험료')",
    "other": "위 항목으로 표현할 수 없는 조건 (판정 불가 사유가 될 수 있음)",
}
OPS = ["<=", "<", ">=", ">", "==", "in", "between"]
BENEFIT_TYPES = ["cash", "inkind", "loan", "none"]

# Claude 구조화 출력용 JSON Schema (strict: 모든 속성 required, additionalProperties false)
RULE_SCHEMA = {
    "type": "object",
    "properties": {
        "service_name": {"type": "string"},
        "judgeable": {"type": "boolean", "description": "사용자 입력 항목만으로 자격을 판정할 수 있으면 true"},
        "not_judgeable_reason": {"type": "string", "description": "judgeable=false일 때 이유, 아니면 빈 문자열"},
        "conditions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "enum": list(FIELDS)},
                    "op": {"type": "string", "enum": OPS},
                    "value": {"type": "string", "description": "숫자는 단위 없이(예: 32, 2470000), 목록은 쉼표로, 범위는 '7,18', 참/거짓은 true/false"},
                    "group": {"type": "string", "description": "빈 문자열이면 반드시 충족(AND). 같은 이름의 그룹끼리는 '하나 이상 충족'(OR)"},
                    "evidence": {"type": "string", "description": "이 조건의 근거가 된 원문 구절을 그대로 인용"},
                },
                "required": ["field", "op", "value", "group", "evidence"],
                "additionalProperties": False,
            },
        },
        "benefit": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": BENEFIT_TYPES},
                "amount_text": {"type": "string", "description": "원문의 지원 금액 설명. 원문에 금액이 없으면 '금액 미기재'"},
                "monthly_amount_won": {"type": "integer", "description": "대표 월 금액(원). 연액이면 12로 나눔. 계산식이거나 원문에 없으면 0"},
                "evidence": {"type": "string"},
            },
            "required": ["type", "amount_text", "monthly_amount_won", "evidence"],
            "additionalProperties": False,
        },
    },
    "required": ["service_name", "judgeable", "not_judgeable_reason", "conditions", "benefit"],
    "additionalProperties": False,
}
