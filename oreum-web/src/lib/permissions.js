// 지자체 제도 검토 권한과 상태 규칙 (관리자 화면·데모 저장소·테스트가 함께 쓴다)
// 실제 운영(Supabase)에서는 같은 규칙을 DB의 행 단위 보안(RLS)과 트리거가 다시 검사한다 (supabase/schema.sql).

export const ROLE_LABEL = { admin: "시스템 관리자", officer: "지자체 담당자" };

// 상태: AI 초안은 '검토 대기'로 들어오고, 담당자가 원문과 대조해 승인·반려한다. 계산에는 '승인'만 쓴다.
export const STATUS = ["검토 대기", "승인", "반려", "중지"];
export const TRANSITIONS = {
  "검토 대기": ["승인", "반려"],
  반려: ["검토 대기"],
  승인: ["중지"],          // 조례 폐지·개정 등으로 계산에서 뺄 때
  중지: ["검토 대기"],
};

// 이 사용자가 이 제도를 검토·승인할 수 있나: 관리자는 전체, 담당자는 자기 지자체(시군구) 제도만,
// 시·도 담당자(region 없이 sido만 가진 담당자)는 그 시·도 단위 제도만
export function canReview(user, program) {
  if (!user || !program) return false;
  if (user.role === "admin") return true;
  if (user.role !== "officer") return false;
  if (program.region) return Boolean(user.region) && program.region === user.region;
  return Boolean(program.sido) && !user.region && program.sido === user.sido;
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// 계산할 수 있는 조건인지: 엔진이 아는 항목만 쓰여야 승인 후 실제로 계산된다
// apply_checks에 넣은 조건(담당자가 '신청할 때 확인'으로 둔 문장 조건)은 계산에서 빼고 안내만 한다.
// 그래도 계산하는 조건이 하나 이상 남아야 승인할 수 있다 (아니면 모든 가구에 혜택이 붙는다)
export function computable(program, facts) {
  const known = new Set(facts);
  const skip = new Set(program.apply_checks || []);
  const used = (program.conditions || []).filter((_, i) => !skip.has(i));
  const unknown = used.filter((c) => !known.has(c.field));
  const meaningful = used.some((c) => known.has(c.field) && c.field !== "residence_region");
  const amountOk = program.amount && (program.amount.type !== "fixed" || program.amount.param || Number.isFinite(Number(program.amount.monthly)));
  return { ok: unknown.length === 0 && meaningful && amountOk, unknown, meaningful };
}

// 결정 하나를 검사하고 기록을 만든다. 문제가 있으면 error 문자열
export function decide(user, program, to, { reason = "", monthly, applyChecks, facts = [] } = {}, now = new Date()) {
  if (!canReview(user, program)) return { error: "이 지자체 제도를 검토할 권한이 없어요" };
  if (!canTransition(program.status, to)) return { error: `'${program.status}'에서 '${to}'(으)로 바꿀 수 없어요` };
  if ((to === "반려" || to === "중지") && !reason.trim()) return { error: "사유를 적어 주세요" };
  const next = { ...program, status: to };
  if (applyChecks && program.status === "검토 대기") next.apply_checks = [...new Set(applyChecks)].filter((i) => (program.conditions || [])[i]?.field === "other").sort((a, b) => a - b);
  if (monthly != null && program.amount?.type === "fixed" && !program.amount.param) next.amount = { ...program.amount, monthly: Math.max(0, Math.round(Number(monthly) || 0)) };
  if (to === "승인") {
    const c = computable(next, facts);
    if (!c.ok) return { error: c.unknown.length ? `계산할 수 없는 조건이 있어요: ${c.unknown.map((x) => x.field).join(", ")}` : !c.meaningful ? "계산하는 조건이 하나도 없어요 (거주 지역 말고 소득·나이 같은 조건이 필요해요)" : "금액을 확인해 주세요" };
    next.approved_by = user.name;
    next.approved_at = now.toISOString().slice(0, 10);
  }
  if (to === "반려" || to === "중지") next.reason = reason.trim();
  const event = { at: now.toISOString(), by: user.name, role: user.role, from: program.status, to, reason: reason.trim() };
  next.history = [...(program.history || []), event];
  return { program: next, event };
}
