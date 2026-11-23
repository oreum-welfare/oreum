// 사용자 화면에서 쓰는 기본값·예시 가구·이름표와 숫자 표기
export const STEP = 10000;
export const RANGE_MEDIAN_MULTIPLE = 2; // 기본 계산 범위: 기준중위소득 200% (기초연금 등 중위 100% 위의 절벽까지)
export const MAX_MEDIAN_MULTIPLE = 3; // 계산 범위 상한: 잘못 넣은 아주 큰 소득으로 화면이 멈추지 않게

export const DEFAULT_HH = {
  region: "경상북도 경산시", age: 40, spouse: false, spouse65: false, dualEarner: false,
  infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1,
  disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60,
  housingAsset: 0, financialAsset: 0, debt: 0,
};

export const PRESETS = [
  { key: "single-parent", icon: "👩‍👧‍👦", title: "한부모 + 자녀 2명", sub: "경산시 · 월 300만 원", income: 3000000,
    hh: { region: "경상북도 경산시", age: 38, singleParent: true, elem: 1, middle: 1 } },
  { key: "senior-couple", icon: "👵👴", title: "어르신 부부", sub: "대구 북구 · 월 150만 원", income: 1500000,
    hh: { region: "대구광역시 북구", age: 70, spouse: true, spouse65: true } },
  { key: "youth", icon: "🧑", title: "1인 청년", sub: "경산시 · 월 100만 원", income: 1000000, hh: { region: "경상북도 경산시", age: 29 } },
  { key: "family", icon: "👨‍👩‍👧‍👦", title: "4인 가구", sub: "경산시 · 월 250만 원", income: 2500000,
    hh: { region: "경상북도 경산시", age: 36, spouse: true, infants: 1, elem: 1 } },
];

export const REGION_SHORT = { "대구광역시 북구": "대구 북구", "경상북도 경산시": "경산시" };
export const SIDO_SHORT = {
  서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전",
  울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남",
  전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주",
};
// "대구광역시 북구" → "대구 북구", "충청북도 청주시" → "충북 청주시"
export const short = (r) => {
  if (REGION_SHORT[r]) return REGION_SHORT[r];
  const [sido, ...rest] = String(r).split(" ");
  return rest.length ? `${SIDO_SHORT[sido] || sido} ${rest.join(" ")}` : SIDO_SHORT[sido] || r;
};
// 시·도별 시군구 목록 (rules.json regions 순서 유지)
export function regionsBySido(regions) {
  const out = {};
  for (const [key, r] of Object.entries(regions)) (out[r.sido] ||= []).push(key);
  return out;
}
// 지자체 자체 혜택이 승인돼 계산에 들어가는 지역 (시·도 단위 제도 포함)
export function localReady(data, key) {
  const r = data.regions[key];
  return (data.local_programs || []).some((p) => p.status === "승인" && (p.region ? p.region === key : p.sido === r?.sido));
}
// "다른 지역이라면?" 비교 지역: 지금 지역 + 급지별 대표 + 지자체 혜택이 있는 지역
export const COMPARE_REGIONS = ["서울특별시 관악구", "경기도 남양주시", "대구광역시 북구", "경상북도 경산시", "전라남도 신안군"];
// 계산 기준 연도: rules.json 연도, 또는 시행 중인 새 고시 값(관리자 승인)이 있으면 그 시행 연도
export const baseYear = (data) => Math.max(Number(data?.year) || 2026, ...(data?.central_applied || []).map((a) => Number(String(a.effective_from).slice(0, 4)) || 0));
export const ORDINAL = { 1: "첫째", 2: "둘째", 3: "셋째", 4: "넷째 이상" };

export const NAMES = {
  saeng: "생계급여", medical: "의료급여", jugeo: "주거급여", edu: "교육급여", energy: "에너지바우처",
  telecom: "이동통신요금 감면", eitc: "근로장려금", ctc: "자녀장려금", basic_pension: "기초연금",
  gs_birth: "출산장려금", gs_clinic: "65세 이상 진료비 감면", bk_nhis: "건강보험료지원", gs_multichild: "다자녀가정 지원",
  sp_child: "한부모 아동양육비", munhwa: "문화누리카드", dis_pension: "장애인연금", gs_loan: "저소득주민생활안정자금(융자)",
};

// 숫자 표기: 10만 원 이상은 만 원 단위 정수, 그 아래는 소수 한 자리
export const manwon = (won) => {
  const v = won / 10000;
  if (Math.abs(v) >= 10) return `${Math.round(v).toLocaleString("ko-KR")}만`;
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}만`;
};

// "약 ○만 원"용: 1만 원 이상은 만 원 단위로 반올림 (9.7만 → 10만)
export const about = (won) => (Math.abs(won) >= 10000 ? `${Math.round(won / 10000).toLocaleString("ko-KR")}만` : manwon(won));
export const won = (x) => `${Math.round(x).toLocaleString("ko-KR")}원`;

// 받침에 따라 '이/가'
export const iga = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? "이" : "가"; };

// 근거 확인 정도 (확인 / 일부 추정 / 추정). 재산 근거(asset_*)는 재산을 넣었을 때만
export const statusClass = (status) => (status.startsWith("추정") ? "est" : status.includes("추정") ? "part" : "ok");
// 계산 기준 시트의 '숫자별 확인 상태'에 보여 줄 항목 이름 (rules.json verification 키)
export const CHECK_LABEL = {
  earned_deduction_rate: "근로소득공제율", youth_deduction: "청년 근로소득공제", senior_disabled_deduction: "노인·장애인 근로소득공제",
  rent: "주거급여 기준임대료", jugeo_self_share: "주거급여 자기부담", edu_annual: "교육급여 금액", energy_annual: "에너지바우처 금액",
  telecom_monthly: "통신요금 감면액", medical_value_per_person: "의료급여 가치", basic_pension_amount: "기초연금 금액",
  basic_pension_couple_cut: "기초연금 부부 감액", eitc: "근로장려금 최대액", ctc: "자녀장려금", bukgu_min_premium: "북구 최저보험료",
  bukgu_nhis_value: "북구 건강보험료 지원액", gs_clinic_value: "경산 진료비 감면 가치", gs_multichild_annual: "경산 다자녀 지원액",
  sp_child: "한부모 아동양육비", munhwa: "문화누리카드", dis_pension: "장애인연금", asset_basic: "재산 기본공제(기초생활)",
  asset_pension: "재산 공제(기초·장애인연금)", asset_eitc: "장려금 재산 기준",
};
export const LEVEL_LABEL = { ok: "확인", part: "일부 추정", est: "추정" };
export const sourceKeys = (data, id, hasAssets) => (data.benefit_sources?.[id]?.verification || []).filter((k) => hasAssets || !k.startsWith("asset_"));
export const levelOf = (data, id, hasAssets) => {
  const st = sourceKeys(data, id, hasAssets).map((k) => statusClass(data.verification[k].status));
  return st.includes("est") ? "est" : st.includes("part") ? "part" : "ok";
};

// 이 혜택을 어떻게 계산했나 (AI를 어디에 썼는지 밝힌다)
// 중앙 제도: 법령·고시 기준값으로 계산 (새 고시 값은 AI 판독 후 관리자 승인), 지자체 제도: AI 초안을 담당자가 승인했거나 담당자가 직접 입력
export function provenance(data, b) {
  if (b.level !== "지자체") {
    return (data.central_applied || []).length
      ? { ai: true, text: "고시 기준 계산 · 새 고시 값은 AI가 읽고 관리자가 승인" }
      : { ai: false, text: "법령·고시 기준 계산 · AI 미사용" };
  }
  const t = (data.local_programs || []).find((p) => p.id === b.id)?.origin?.type;
  if (t === "ai") return { ai: true, text: "AI가 원문에서 만든 초안 · 지자체 담당자 승인" };
  if (t === "manual") return { ai: false, text: "지자체 담당자가 직접 입력 · 승인 · AI 미사용" };
  return { ai: false, text: "조례 기준 · 지자체 담당자 확인 · AI 미사용" };
}
