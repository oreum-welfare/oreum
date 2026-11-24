// 자동 확인 상태: 매일 확인(지자체 제도·중앙 고시)이 마지막으로 돈 시각과 범위.
// Supabase(system_status)가 있으면 그것, 없으면 배포에 들어간 기록(/data/freshness.json). 더 최근 쪽을 쓴다.
import { useEffect, useState } from "react";
import { backendMode, supabaseClient } from "./programs.js";

async function fromDb() {
  if (backendMode() !== "supabase") return {};
  try {
    const sb = await supabaseClient();
    const { data, error } = await sb.from("system_status").select("key, checked_at, summary");
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.key, { checked_at: r.checked_at, summary: r.summary || {} }]));
  } catch {
    return {};
  }
}

async function fromFile() {
  try {
    const r = await fetch("/data/freshness.json");
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

const newer = (a, b) => (!a ? b : !b ? a : String(a.checked_at) >= String(b.checked_at) ? a : b);

export function useFreshness() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fromDb(), fromFile()]).then(([db, file]) => {
      if (!alive) return;
      setStatus({ local_watch: newer(db.local_watch, file?.local_watch), notice_watch: newer(db.notice_watch, file?.notice_watch) });
    });
    return () => { alive = false; };
  }, []);
  return status;
}

// "11월 24일" (한국 시간)
export function dayLabel(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00+09:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

// 화면에 쓸 한 줄: "매일 자동 확인: 중앙 고시 7종 · 지자체 제도 3개 지역 · 마지막 확인 11월 24일"
export function freshnessText(s) {
  if (!s || (!s.local_watch && !s.notice_watch)) return "";
  const n = s.notice_watch?.summary?.notices, r = s.local_watch?.summary?.regions;
  const what = [n && `중앙 고시 ${n}종`, r && `지자체 제도 ${r}개 지역`].filter(Boolean);
  const last = [s.local_watch?.checked_at, s.notice_watch?.checked_at].filter(Boolean).sort().pop();
  return ["매일 자동 확인: " + (what.join(" · ") || "제도 변경"), last && `마지막 확인 ${dayLabel(last)}`].filter(Boolean).join(" · ");
}
