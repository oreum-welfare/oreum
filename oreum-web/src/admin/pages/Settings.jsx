import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { PageHead } from "../adminUi.jsx";
import { RegionPicker, SignIn, useSession } from "../session.jsx";

// 데모 모드: 이 브라우저에만 저장
const DEMO_KEY = "oreum-settings-demo-v1";
const demoLoad = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {}; } catch { return {}; } };
const demoSave = (v) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
export const DEFAULT_WATCH_REGIONS = ["경상북도 경산시", "대구광역시 북구", "경상북도 영천시"];

// 운영 설정: 매일 자동 확인이 무엇을 볼지 시스템 관리자가 정한다 (개발자 없이)
export default function Settings() {
  const { mode, user, ready, signOut } = useSession();
  const head = <PageHead title="운영 설정" desc="매일 아침 자동 확인이 무엇을 볼지 정합니다. 바꾼 설정은 다음 날 확인부터 적용돼요." />;
  if (!ready) return <p className="hint">불러오는 중…</p>;
  if (!user) return <div className="page">{head}<SignIn /></div>;
  if (user.role !== "admin") return <div className="page">{head}<p className="empty">시스템 관리자만 운영 설정을 바꿀 수 있어요. 지금 계정: {user.name} · <button type="button" className="link-btn" onClick={signOut}>다른 계정으로 로그인</button></p></div>;
  return (
    <div className="page">{head}
      {mode === "demo" && <p className="notice">데모 모드: 설정은 이 브라우저에만 저장되고 실제 자동 확인에는 쓰이지 않아요.</p>}
      <WatchRegions mode={mode} user={user} />
    </div>
  );
}

// 표 하나를 읽고 쓰는 공통 도우미 (Supabase 또는 데모 저장)
export function useTable(mode, table, demoDefault, order) {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    if (mode !== "supabase") { setRows(demoLoad()[table] ?? demoDefault); return; }
    try {
      const sb = await supabaseClient();
      const { data, error } = await sb.from(table).select("*").order(order);
      if (error) throw error;
      setRows(data);
    } catch {
      setRows([]);
      setMsg("설정을 불러오지 못했어요. Supabase에서 schema.sql을 다시 실행했는지 확인해 주세요.");
    }
  }, [mode, table, demoDefault, order]);
  useEffect(() => { load(); }, [load]);
  // op: (sb) => Promise<{error}> (Supabase) / demoFn: (rows) => rows (데모)
  const save = async (op, demoFn, done) => {
    setMsg("");
    if (mode !== "supabase") {
      const next = demoFn(rows || []);
      demoSave({ ...demoLoad(), [table]: next });
      setRows(next);
      setMsg(done);
      return;
    }
    try {
      const sb = await supabaseClient();
      const { error } = await op(sb);
      if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return; }
      setMsg(done);
      load();
    } catch {
      setMsg("서버에 연결하지 못했어요.");
    }
  };
  return { rows, msg, save };
}

const DEMO_REGIONS = DEFAULT_WATCH_REGIONS.map((region) => ({ region, active: true, added_by: "처음 설정" }));

function WatchRegions({ mode, user }) {
  const { data: rules } = useJson("/data/rules.json");
  const { rows, msg, save } = useTable(mode, "watch_regions", DEMO_REGIONS, "region");
  const [area, setArea] = useState({ region: null, sido: "" });
  const exists = (k) => (rows || []).some((r) => r.region === k);
  const add = () => {
    const k = area.region;
    if (!k || exists(k)) return;
    save((sb) => sb.from("watch_regions").insert({ region: k, added_by: user.name }),
      (rs) => [...rs, { region: k, active: true, added_by: user.name }],
      `${k}을(를) 감시 지역에 더했어요. 다음 확인부터 이 지역 제도가 AI 초안으로 '검토 대기'에 들어와요 (하루 최대 30건씩).`);
  };
  const toggle = (r) => save((sb) => sb.from("watch_regions").update({ active: !r.active }).eq("region", r.region),
    (rs) => rs.map((x) => (x.region === r.region ? { ...x, active: !x.active } : x)),
    `${r.region} 감시를 ${r.active ? "멈췄어요" : "다시 켰어요"}.`);
  const remove = (r) => {
    if (!window.confirm(`${r.region}을(를) 감시 지역에서 뺄까요? 이미 들어온 제도는 그대로 남아요.`)) return;
    save((sb) => sb.from("watch_regions").delete().eq("region", r.region), (rs) => rs.filter((x) => x.region !== r.region), `${r.region}을(를) 뺐어요.`);
  };
  const active = (rows || []).filter((r) => r.active).length;
  return (
    <section className="card">
      <h2 className="card-title">감시 지역 <small className="hint">사용 중 {active}곳</small></h2>
      <p className="hint">매일 아침 공공데이터포털 API로 이 시군구의 지자체 복지제도가 새로 생기거나 바뀌었는지 확인해요. 바뀐 제도는 AI 초안으로 그 지역 담당자의 '지자체 제도 검토'에 들어가요.</p>
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="acc-edit">
        <RegionPicker regions={rules?.regions} value={area.region} sido={area.sido} onChange={setArea} />
        <button type="button" className="btn sm primary" onClick={add} disabled={!area.region || exists(area.region)}>{area.region && exists(area.region) ? "이미 있어요" : "감시 지역에 더하기"}</button>
      </div>
      {!rows ? <p className="hint">불러오는 중…</p> : (
        <ul className="acc-list">
          {rows.map((r) => (
            <li key={r.region} className="acc-row">
              <div><b>{r.region}</b> <small className="hint">{r.added_by || ""}</small></div>
              <span className={`pill ${r.active ? "s-ok" : ""}`}>{r.active ? "사용 중" : "멈춤"}</span>
              <div className="acc-edit">
                <button type="button" className="btn sm" onClick={() => toggle(r)}>{r.active ? "멈추기" : "다시 켜기"}</button>
                <button type="button" className="btn sm ghost" onClick={() => remove(r)}>빼기</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">새 지역의 제도는 담당자 계정이 있어야 검토할 수 있어요. '계정 관리'에서 그 지역 담당자를 승인해 주세요.</p>
    </section>
  );
}
