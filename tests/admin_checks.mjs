// 지자체 제도 검토 권한·상태 규칙 검사 (supabase/schema.sql의 RLS·트리거와 같은 규칙)
// 실행: node tests/admin_checks.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { canReview, decide, computable } = await import(pathToFileURL(join(root, "oreum-web/src/lib/permissions.js")));
const { mergePrograms, newerVersionOf } = await import(pathToFileURL(join(root, "oreum-web/src/lib/programs.js")));
const { createEngine } = await import(pathToFileURL(join(root, "oreum-web/src/lib/engine.js")));
const data = JSON.parse(readFileSync(join(root, "data/rules.json"), "utf8"));
const drafts = JSON.parse(readFileSync(join(root, "pipeline/local_drafts.json"), "utf8")).drafts;
const facts = data.local_program_spec.facts;

let bad = 0;
const check = (name, ok, detail) => { if (!ok) bad++; console.log(`${ok ? "통과" : "실패"}: ${name}${detail ? ` (${detail})` : ""}`); };

const gs = { name: "경산 담당", role: "officer", region: "경상북도 경산시", sido: "경상북도" };
const bk = { name: "북구 담당", role: "officer", region: "대구광역시 북구", sido: "대구광역시" };
const gb = { name: "경북 담당", role: "officer", region: null, sido: "경상북도" };
const admin = { name: "관리자", role: "admin" };
const all = mergePrograms(data.local_programs, drafts, {});
// 출산 축하박스: 신생아·거주 지역은 계산, "2026년도 이후 출생아"는 신청할 때 확인
const gsDraft = all.find((p) => p.id === "ai_t12_WLF00004906");
const laterIdx = gsDraft.conditions.map((c, i) => (c.field === "other" ? i : -1)).filter((i) => i >= 0);
const bkDraft = all.find((p) => p.region === "대구광역시 북구" && p.status === "검토 대기");

check("담당자는 자기 지자체 제도만", canReview(gs, gsDraft) && !canReview(gs, bkDraft) && canReview(bk, bkDraft));
check("관리자는 전체", canReview(admin, gsDraft) && canReview(admin, bkDraft));
check("시·도 담당자는 시군구 제도는 못 하고 시·도 제도만", !canReview(gb, gsDraft) && canReview(gb, { sido: "경상북도" }) && !canReview(gs, { sido: "경상북도" }));
check("로그인 안 하면 검토 불가", !canReview(null, gsDraft));
check("AI 초안은 모두 '검토 대기'로 들어옴", drafts.every((d) => d.status === "검토 대기"), `${drafts.length}건`);

{
  const r = decide(bk, gsDraft, "승인", { facts });
  check("다른 지역 담당자의 승인은 거절", Boolean(r.error), r.error);
  check("문장 조건이 남아 있으면 승인 불가", Boolean(decide(gs, gsDraft, "승인", { facts }).error));
  const ok = decide(gs, gsDraft, "승인", { facts, applyChecks: laterIdx, monthly: 50000 });
  check("문장 조건을 '신청할 때 확인'으로 두면 승인 → 이력·승인자 기록", ok.program?.status === "승인" && ok.program.approved_by === gs.name && ok.program.history.length === 1 && ok.program.apply_checks.length === laterIdx.length, ok.error);
  check("거주 지역 조건만 남으면 승인 불가", Boolean(decide(gs, { ...gsDraft, conditions: gsDraft.conditions.filter((c) => c.field !== "newborn") }, "승인", { facts, applyChecks: gsDraft.conditions.filter((c) => c.field !== "newborn").map((c, i) => (c.field === "other" ? i : -1)).filter((i) => i >= 0) }).error));
  const again = decide(gs, ok.program, "반려", { reason: "x", facts });
  check("승인된 제도를 바로 반려할 수 없음 (중지만 가능)", Boolean(again.error));
  check("반려·중지는 사유 필수", Boolean(decide(gs, gsDraft, "반려", { reason: " ", facts }).error) && Boolean(decide(gs, ok.program, "중지", { facts }).error));
  const engOk = createEngine({ ...data, local_programs: [...data.local_programs, ok.program] });
  const baby = { region: "경상북도 경산시", age: 32, spouse: true, infants: 1, newborn: true, birthOrder: 1 };
  const got = engOk.evaluate(baby, 2000000).find((b) => b.id === gsDraft.id);
  check("승인 후 계산: 신생아 가구에 월 금액 + '신청할 때 확인' 안내", got?.monthly === 50000 && got.note.includes("신청할 때 확인"), got?.note);
  check("승인 후 계산: 신생아가 없으면 제외", !engOk.evaluate({ ...baby, newborn: false }, 2000000).some((b) => b.id === gsDraft.id));

  // 승인하면 그 지역 계산기에만 들어간다
  const eng = createEngine({ ...data, local_programs: [...data.local_programs, ok.program] });
  check("승인한 제도는 그 지역에서만 계산 대상", eng.localProgramsFor("경상북도 경산시").some((p) => p.id === gsDraft.id) && !eng.localProgramsFor("대구광역시 북구").some((p) => p.id === gsDraft.id), gsDraft.name);
  const engDraft = createEngine({ ...data, local_programs: [...data.local_programs, gsDraft] });
  check("검토 대기 초안은 계산하지 않음", !engDraft.localProgramsFor("경상북도 경산시").some((p) => p.id === gsDraft.id));
}

// 매일 변경 확인: 같은 서비스의 새 버전 초안이 있으면 옛 초안은 승인 대상이 아니다
{
  const oldDraft = { id: "ai_t12_WLF00004906", origin: { service_id: "t12_WLF00004906" } };
  const v1 = { id: "ai_u_WLF00004906_20261201", status: "검토 대기", origin: { service_id: "u_WLF00004906_20261201" } };
  const v2 = { id: "ai_u_WLF00004906_20261215", status: "검토 대기", origin: { service_id: "u_WLF00004906_20261215" } };
  const other = { id: "ai_u_WLF00000001_20261220", origin: { service_id: "u_WLF00000001_20261220" } };
  const all = [oldDraft, v1, v2, other];
  check("새 버전 초안: 가장 새 것을 가리킴", newerVersionOf(oldDraft, all)?.id === v2.id && newerVersionOf(v1, all)?.id === v2.id);
  check("새 버전 초안: 가장 새 버전·다른 서비스는 해당 없음", !newerVersionOf(v2, all) && !newerVersionOf(other, all));
}

if (bad) { console.error(`${bad}개 검사 실패`); process.exit(1); }
console.log("권한·상태 규칙 검사 모두 통과");
