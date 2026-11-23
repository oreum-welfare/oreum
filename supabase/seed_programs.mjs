// 지자체 제도를 Supabase DB에 처음 넣는다 (이미 있는 id는 건드리지 않음).
// - data/rules.json local_programs  → 상태 그대로 ('승인' 시범 데이터)
// - pipeline/local_drafts.json      → '검토 대기' AI 초안
// 실행 (서비스 키는 코드·채팅·GitHub에 올리지 않고 환경변수로만):
//   PowerShell: $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node supabase/seed_programs.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// URL 끝의 / 나 /rest/v1 은 떼어 낸다 (대시보드에서 API URL을 통째로 복사해도 되게)
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) {
  console.error("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY 환경변수를 먼저 설정하세요.");
  process.exit(1);
}
const rules = JSON.parse(readFileSync(join(root, "data/rules.json"), "utf8"));
const drafts = JSON.parse(readFileSync(join(root, "pipeline/local_drafts.json"), "utf8")).drafts;
const cols = ["id", "name", "region", "sido", "kind", "conditions", "apply_checks", "facts","amount", "amount_text", "note", "source", "origin", "text", "status", "approved_by", "approved_at", "effective_from"];
const rows = [...rules.local_programs.map((p) => ({ ...p, origin: p.origin || { type: "rules" } })), ...drafts]
  .map((p) => Object.fromEntries(cols.map((c) => [c, p[c] ?? (c === "apply_checks" ? [] : null)])));

const res = await fetch(`${url}/rest/v1/local_programs?on_conflict=id`, {
  method: "POST",
  // 새 형식 비밀 키(sb_secret_...)는 apikey 헤더로만, 예전 service_role 키(JWT)는 Authorization에도 넣는다
  headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
if (!res.ok) {
  console.error(`실패: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`지자체 제도 ${rows.length}건 넣음 (이미 있는 id는 그대로)`);
