// 새 고시에서 AI가 읽은 중앙 기준값 제안(pipeline/central_drafts.json)을 Supabase central_values에 '검토 대기'로 넣는다.
// 이미 있는 id는 건드리지 않는다 (관리자가 결정한 상태를 덮어쓰지 않게). 매일 고시 확인(notice-watch.yml)이 실행한다.
// 실행 (키는 환경변수로만): node supabase/seed_central.mjs
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
const drafts = JSON.parse(readFileSync(join(root, "pipeline/central_drafts.json"), "utf8")).drafts;
if (!drafts.length) {
  console.log("넣을 중앙 기준값 제안 없음");
  process.exit(0);
}
const cols = ["id", "key", "value", "effective_from", "notice", "evidence", "location", "proposed_by", "status"];
const rows = drafts.map((d) => Object.fromEntries(cols.map((c) => [c, d[c] ?? null])));
const res = await fetch(`${url}/rest/v1/central_values?on_conflict=id`, {
  method: "POST",
  headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
if (!res.ok) {
  console.error(`실패: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`중앙 기준값 제안 ${rows.length}건 확인 (새 것만 '검토 대기'로 추가)`);
