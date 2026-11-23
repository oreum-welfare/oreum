// 규칙 데이터(data/rules.json), AI 검수 데이터(pipeline/review_export.json), AI 성능 요약(pipeline/ai_results.json)을 oreum-web으로 복사한다.
// 원본은 저장소의 다른 폴더에 있으므로, 원본이 없는 환경(예: Vercel 빌드)에서는 이미 복사된 파일을 그대로 쓴다.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pairs = [
  ["../../data/rules.json", "../public/data/rules.json"],
  ["../../pipeline/review_export.json", "../public/data/review.json"],
  ["../../pipeline/ai_results.json", "../public/data/ai_results.json"],
  ["../../pipeline/local_drafts.json", "../public/data/local_drafts.json"],
  ["../../pipeline/state/gone.json", "../public/data/source_gone.json"],
  ["../../pipeline/central_drafts.json", "../public/data/central_drafts.json"], // 중앙 기준값 제안 (관리자 화면 데모용) // 매일 변경 확인: 복지로 목록에서 사라진 제도
];
mkdirSync(resolve(here, "../public/data"), { recursive: true });
for (const [from, to] of pairs) {
  const src = resolve(here, from), dst = resolve(here, to);
  if (existsSync(src)) {
    copyFileSync(src, dst);
    console.log(`복사: ${from} → ${to}`);
  } else if (existsSync(dst)) {
    console.log(`원본 없음, 기존 파일 사용: ${to}`);
  } else {
    console.warn(`경고: ${from} 도 ${to} 도 없습니다.`);
  }
}

// 자동 확인 상태 (Supabase가 없을 때 쓰는 기본값): 저장소에 남은 매일 확인 기록에서 마지막 확인 시각·범위를 뽑는다
import { readFileSync, writeFileSync } from "node:fs";
const readJson = (rel) => { try { return JSON.parse(readFileSync(resolve(here, rel), "utf8")); } catch { return null; } };
const lastChecked = (state) => Object.values(state || {}).map((e) => e.checked || "").sort().pop() || null;
const watch = readJson("../../pipeline/state/watch_state.json");
const notices = readJson("../../pipeline/state/notice_state.json");
if (watch || notices) {
  const status = {
    local_watch: watch ? { checked_at: lastChecked(watch), summary: { regions: new Set(Object.values(watch).map((e) => e.region)).size, programs: Object.keys(watch).length } } : null,
    notice_watch: notices ? { checked_at: lastChecked(notices), summary: { notices: Object.keys(notices).length } } : null,
  };
  writeFileSync(resolve(here, "../public/data/freshness.json"), JSON.stringify(status, null, 1) + "\n");
  console.log("자동 확인 상태: ../public/data/freshness.json");
}
