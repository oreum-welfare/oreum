// 중앙 기준값 (기준 중위소득·기준임대료 등 고시 값) 갱신.
// 새 고시를 AI가 읽어 '검토 대기'로 제안 → 시스템 관리자가 원문 대조 후 승인 → 시행일부터 계산기에 자동 반영.
// 계산식(engine.js)은 그대로이고, rules.json의 같은 자리 값만 바꾼다. 같은 규칙을 DB(supabase/schema.sql 6절)도 검사한다.

// 한국 시간 오늘 (YYYY-MM-DD)
export const todayKST = (now = new Date()) => new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let o = obj;
  for (const k of keys) {
    o[k] = { ...o[k] }; // 바꾸는 길만 복사 (원본 rules는 그대로)
    o = o[k];
  }
  o[last] = value;
}

// 지금 값과 같은 모양인가 (같은 키·같은 개수·숫자는 0 이상)
export function sameShape(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i]));
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object" || Array.isArray(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameShape(a[k], b[k]));
  }
  if (typeof a === "number") return typeof b === "number" && Number.isFinite(b) && b >= 0;
  return typeof a === typeof b;
}

// 바뀐 칸만: [경로, 지금, 새 값]
export function diffLeaves(a, b, prefix = "") {
  if (a && typeof a === "object") {
    return Object.keys(a).flatMap((k) => diffLeaves(a[k], b?.[k], Array.isArray(a) ? `${prefix}[${k}]` : prefix ? `${prefix}.${k}` : k));
  }
  return a === b ? [] : [[prefix, a, b]];
}

// 키마다, 승인됐고 시행일이 date 이전인 것 중 가장 최근 값
export function inForce(rows = [], date = todayKST()) {
  const best = {};
  for (const r of rows) {
    if (r.status !== "승인" || !r.effective_from || r.effective_from > date) continue;
    if (!best[r.key] || r.effective_from > best[r.key].effective_from) best[r.key] = r;
  }
  return best;
}

// rules.json 위에 시행 중인 승인 값을 덮어 쓴다. 모양이 다른 값은 쓰지 않는다 (계산이 깨지지 않게)
export function applyCentral(rules, rows = [], date = todayKST()) {
  const picked = inForce(rows, date);
  const out = { ...rules };
  const applied = [];
  for (const [key, r] of Object.entries(picked)) {
    const cur = getPath(rules, key);
    if (cur === undefined || !sameShape(cur, r.value)) continue;
    setPath(out, key, r.value);
    applied.push({ key, effective_from: r.effective_from, notice: r.notice?.name });
  }
  return applied.length ? { ...out, central_applied: applied } : rules;
}

// 사람이 읽는 이름
export const KEY_LABEL = {
  "lines.saeng_32": "생계급여 선정기준 (기준 중위소득 32%, 월)",
  "lines.jugeo_48": "주거급여 선정기준 (기준 중위소득 48%, 월)",
  "params.rent": "주거급여 기준임대료 (급지·가구원수별, 월)",
  "params.jugeo_self_share": "주거급여 자기부담 비율",
  "params.edu_annual": "교육급여 교육활동지원비 (연)",
  "params.basic_pension_line": "기초연금 선정기준액 (월)",
  "params.basic_pension_amount": "기초연금 기준연금액 (월)",
  "params.basic_pension_earned_deduction": "기초연금 근로소득 공제 (월)",
  "params.dis_pension": "장애인연금 선정기준액 등",
  "params.sp_child": "한부모 아동양육비",
  "params.bukgu_min_premium": "건강보험 지역가입자 최저보험료 (월)",
  // 감시 고시 밖의 값: 관리자가 근거와 함께 직접 입력 → 승인
  "params.earned_deduction_rate": "근로·사업소득 공제율 (기초생활보장)",
  "params.youth_deduction": "청년(34세 이하) 근로소득 추가 공제",
  "params.senior_disabled_deduction": "노인·장애인 근로소득 추가 공제",
  "params.assets": "재산의 소득환산율·공제 (기초생활보장·기초연금·근로장려금)",
  "params.basic_pension_couple_cut": "기초연금 부부 감액 비율",
  "params.energy_annual": "에너지바우처 (가구원수별, 연)",
  "params.telecom_monthly": "통신요금 감면 (월 최대)",
  "params.munhwa": "문화누리카드 (1인당 연)",
  "params.medical_value_per_person": "의료급여 가치 추정 (1인당 월)",
  "params.eitc": "근로장려금 구간 (점증·평탄·점감·최대액)",
  "params.ctc_max_per_child": "자녀장려금 1인당 최대액",
  "params.ctc_limit": "자녀장려금 소득 상한",
  "params.ctc_full_until": "자녀장려금 최대액 지급 소득 구간",
};
