// 매일 변경 확인 결과(pipeline/state/gone.json)를 Supabase 지자체 제도에 표시한다 (폐지 의심).
// - 복지로 목록에서 3일 연속 사라진 서비스 → 그 서비스와 연결된 제도의 source_gone_since에 날짜
// - 다시 보이면 표시를 지운다. 상태(승인·중지)는 바꾸지 않는다: 중지는 담당자가 확인하고 누른다
// 제도 ↔ 서비스 연결: service_id → AI 초안 원문 이름(origin.service_id) → 출처 문구의 servId (oreum-web/src/lib/programs.js serviceIdOf와 같음)
// 실행 (키는 환경변수로만): node supabase/mark_gone.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) {
  console.error("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY 환경변수를 먼저 설정하세요.");
  process.exit(1);
}
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const gone = read("pipeline/state/gone.json");
const programs = [...read("data/rules.json").local_programs, ...read("pipeline/local_drafts.json").drafts];
const pick = (s) => (String(s || "").match(/WLF\d+/) || [])[0];
const sidOf = (p) => pick(p.service_id) || pick(p.origin?.service_id) || pick(p.source) || null;

const headers = { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", Prefer: "return=minimal" };
const patch = async (ids, since, extra = "") => {
  if (!ids.length) return;
  const list = ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",");
  const res = await fetch(`${url}/rest/v1/local_programs?id=in.(${encodeURIComponent(list)})${extra}`, {
    method: "PATCH", headers, body: JSON.stringify({ source_gone_since: since }),
  });
  if (!res.ok) {
    console.error(`실패: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
};

const linked = programs.filter((p) => sidOf(p));
const bySince = {};
for (const p of linked) {
  const g = gone[sidOf(p)];
  if (g) (bySince[g.since] ||= []).push(p.id);
}
for (const [since, ids] of Object.entries(bySince)) await patch(ids, since);
// 다시 보이는 제도는 표시 해제 (표시가 있는 행만 건드린다)
await patch(linked.filter((p) => !gone[sidOf(p)]).map((p) => p.id), null, "&source_gone_since=not.is.null");
const marked = Object.values(bySince).flat();
console.log(`폐지 의심 표시 ${marked.length}건${marked.length ? `: ${marked.join(", ")}` : ""} (연결된 제도 ${linked.length}건 확인)`);
