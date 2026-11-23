// 지자체 제도 저장소.
// - 데모 모드(기본): 담당자 결정을 이 브라우저(localStorage)에만 저장한다. 권한 검사는 화면에서만 하므로 보안이 아니다.
// - Supabase 모드: VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY가 있으면 로그인·DB를 쓰고, 권한은 DB(RLS)가 강제한다.
// 계산기(사용자 화면)는 어느 모드든 '승인'된 제도만 받아 쓴다. 가구 입력값은 어디로도 보내지 않는다.

const STORE_KEY = "oreum-local-programs-v1";

export const backendMode = () =>
  import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY ? "supabase" : "demo";

let clientPromise = null;
export function supabaseClient() {
  if (backendMode() !== "supabase") return null;
  clientPromise ||= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY));
  return clientPromise;
}

// 데모 저장: { [제도 id]: 결정 반영된 제도 전체 }
export function loadOverlay() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
export function saveOverlay(overlay) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(overlay)); return true; } catch { return false; }
}
export function resetOverlay() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* 저장 불가 환경 */ }
}

// 기본 제도(rules.json, 이미 승인) + AI 초안 + 데모 결정 → 지금 상태의 전체 목록
export function mergePrograms(base = [], drafts = [], overlay = {}) {
  const all = [...base.map((p) => ({ ...p, origin: p.origin || { type: "rules" } })), ...drafts];
  return all.map((p) => overlay[p.id] || p);
}

// 복지로 서비스 ID (매일 변경 확인과 연결): 직접 적은 service_id → AI 초안의 원문 이름(t12_WLF… / u_WLF…_날짜) → 출처 문구
export function serviceIdOf(p) {
  const pick = (s) => (String(s || "").match(/WLF\d+/) || [])[0];
  return pick(p.service_id) || pick(p.origin?.service_id) || pick(p.source) || null;
}

// 복지로 목록에서 사라진 제도인가 (폐지 의심). DB 표시(source_gone_since) 또는 매일 변경 확인 결과(source_gone.json)
export function goneInfo(p, goneMap = {}) {
  if (p.source_gone_since) return { since: p.source_gone_since };
  const sid = serviceIdOf(p);
  return (sid && goneMap[sid]) || null;
}

// 계산기에 넣을 '승인' 제도 (rules.json의 local_programs를 대신한다)
export async function publishedPrograms(data) {
  const base = data.local_programs || [];
  if (backendMode() === "supabase") {
    try {
      const sb = await supabaseClient();
      const { data: rows, error } = await sb.from("local_programs").select("*").eq("status", "승인");
      if (error) throw error;
      // DB에 연결되면 DB만 믿는다. 기본 제도를 섞으면 DB에서 '중지'한 제도가 계속 계산된다
      // (로그인 없는 계산기는 RLS 때문에 '승인' 행만 보여서 중지 여부를 알 수 없다). 승인 제도가 0건이면 0건 그대로.
      return rows;
    } catch {
      return base; // 연결이 안 되면 저장소에 들어 있는 승인 제도만
    }
  }
  const overlay = loadOverlay();
  const changed = Object.values(overlay);
  if (changed.length === 0) return base;
  const ids = new Set(changed.map((p) => p.id));
  return [...base.filter((p) => !ids.has(p.id)), ...changed].filter((p) => p.status === "승인");
}
