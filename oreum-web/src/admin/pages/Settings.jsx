import { useCallback, useEffect, useState } from "react";
import { KEY_LABEL } from "../../lib/central.js";
import { dayLabel, useFreshness } from "../../lib/freshness.js";
import { supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { ConfirmModal, PageHead, StatRow } from "../adminUi.jsx";
import { RegionPicker, SignIn, useSession } from "../session.jsx";

// 데모 모드: 이 브라우저에만 저장
const DEMO_KEY = "oreum-settings-demo-v1";
const demoLoad = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {}; } catch { return {}; } };
const demoSave = (v) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
export const DEFAULT_WATCH_REGIONS = ["경상북도 경산시", "대구광역시 북구", "경상북도 영천시"];
const DEMO_REGIONS = DEFAULT_WATCH_REGIONS.map((region) => ({ region, active: true, added_by: "처음 설정" }));

// 마지막 자동 확인이 이틀 안이면 정상 (매일 아침 6시에 돈다)
const healthy = (iso) => Boolean(iso) && Date.now() - new Date(String(iso).length <= 10 ? `${iso}T00:00:00+09:00` : iso).getTime() < 2 * 86400000;

// 운영 설정: 매일 자동 확인이 무엇을 볼지 시스템 관리자가 정한다 (개발자 없이)
export default function Settings() {
  const { mode, user, ready, signOut } = useSession();
  const regions = useTable(mode, "watch_regions", DEMO_REGIONS, "region");
  const notices = useTable(mode, "watched_notices", DEMO_NOTICES, "key");
  const fresh = useFreshness();
  const [confirm, setConfirm] = useState(null);
  const head = <PageHead title="운영 설정" desc="자동으로 확인할 지역과 복지 관련 고시를 관리합니다. 바꾼 설정은 다음 날 아침 확인부터 적용돼요." />;
  if (!ready) return <p className="hint">불러오는 중…</p>;
  if (!user) return <div className="page">{head}<SignIn /></div>;
  if (user.role !== "admin") return <div className="page">{head}<p className="empty">시스템 관리자만 운영 설정을 바꿀 수 있어요. 지금 계정: {user.name} · <button type="button" className="link-btn" onClick={signOut}>다른 계정으로 로그인</button></p></div>;

  const last = [fresh?.local_watch?.checked_at, fresh?.notice_watch?.checked_at].filter(Boolean).sort().pop();
  const ok = healthy(fresh?.local_watch?.checked_at) && healthy(fresh?.notice_watch?.checked_at);
  const activeR = (regions.rows || []).filter((r) => r.active).length, activeN = (notices.rows || []).filter((r) => r.active).length;
  return (
    <div className="page">{head}
      <StatRow items={[
        { label: "감시 지역", value: `${activeR}곳`, note: `전체 ${(regions.rows || []).length}곳 · 중지 ${(regions.rows || []).length - activeR}곳` },
        { label: "감시 고시", value: `${activeN}종`, note: `전체 ${(notices.rows || []).length}종 · 중지 ${(notices.rows || []).length - activeN}종` },
        { label: "자동 확인 상태", value: !fresh ? "…" : ok ? "정상" : "확인 필요", tone: !fresh ? "" : ok ? "ok" : "warn",
          note: last ? `마지막 확인 ${dayLabel(last)} · 매일 오전 6시` : "아직 확인 기록이 없어요" },
      ]} />
      {mode === "demo" && <p className="notice">데모 모드: 설정은 이 브라우저에만 저장되고 실제 자동 확인에는 쓰이지 않아요.</p>}
      <WatchRegions t={regions} user={user} lastCheck={fresh?.local_watch?.checked_at} ask={setConfirm} />
      <WatchedNotices t={notices} user={user} lastCheck={fresh?.notice_watch?.checked_at} ask={setConfirm} />
      {confirm && <ConfirmModal title={confirm.title} target={confirm.target} body={confirm.body} confirmLabel={confirm.label}
        onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c.run(); }} />}
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

function StatusPill({ active }) {
  return <span className={`pill ${active ? "s-ok" : "s-warn"}`}>{active ? "감시 중" : "중지됨"}</span>;
}

function WatchRegions({ t, user, lastCheck, ask }) {
  const { data: rules } = useJson("/data/rules.json");
  const { rows, msg, save } = t;
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
    `${r.region} 감시를 ${r.active ? "중지했어요" : "다시 시작했어요"}.`);
  const remove = (r) => ask({
    title: "감시 지역을 삭제할까요?", target: r.region, body: "삭제하면 이 지역은 더 이상 매일 확인하지 않아요. 이미 들어온 제도와 승인한 제도는 그대로 남아요. 잠시 멈추려면 '감시 중지'를 쓰세요.", label: "삭제",
    run: () => save((sb) => sb.from("watch_regions").delete().eq("region", r.region), (rs) => rs.filter((x) => x.region !== r.region), `${r.region}을(를) 삭제했어요.`),
  });
  return (
    <section className="card">
      <h2 className="card-title"><span className="section-no">01</span>감시 지역 관리</h2>
      <p className="hint">매일 아침 공공데이터포털 API로 이 시군구의 지자체 복지제도가 새로 생기거나 바뀌었는지 확인해요. 바뀐 제도는 AI 초안으로 그 지역 담당자의 '지자체 제도 검토'에 들어가요.</p>
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="add-box">
        <b>지역 추가</b>
        <div className="acc-edit">
          <RegionPicker regions={rules?.regions} value={area.region} sido={area.sido} onChange={setArea} />
          <button type="button" className="btn sm primary" onClick={add} disabled={!area.region || exists(area.region)}>{area.region && exists(area.region) ? "이미 있어요" : "+ 감시 지역에 더하기"}</button>
        </div>
      </div>
      {!rows ? <p className="hint">불러오는 중…</p> : (
        <ul className="acc-list">
          {rows.map((r) => (
            <li key={r.region} className="acc-row">
              <div className="acc-main">
                <div className="acc-title"><b className="acc-name">{r.region}</b><StatusPill active={r.active} /></div>
                <span className="hint">{r.added_by || ""}{r.active && lastCheck ? ` · 마지막 확인 ${dayLabel(lastCheck)}` : ""}</span>
              </div>
              <div className="acc-edit">
                <button type="button" className="btn sm" onClick={() => toggle(r)}>{r.active ? "감시 중지" : "다시 감시"}</button>
                <button type="button" className="btn sm danger" onClick={() => remove(r)}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">새 지역의 제도는 그 지역 담당자 계정이 있어야 검토할 수 있어요. '계정 관리'에서 담당자를 승인해 주세요.</p>
    </section>
  );
}

// 처음 설정 (pipeline/notices.json과 같다)
const DEMO_NOTICES = [{"key": "median_saeng", "source": "S04", "query": "기준 중위소득", "match": ["기준 중위소득", "생계"], "keys": ["lines.saeng_32"], "hint": "생계급여 선정기준(기준 중위소득 32%) 가구원수별 월 금액. 1~6인", "active": true, "added_by": "처음 설정"}, {"key": "housing", "source": "S05", "query": "주거급여 선정기준", "match": ["주거급여", "선정기준"], "keys": ["lines.jugeo_48", "params.rent", "params.jugeo_self_share"], "hint": "주거급여 선정기준(기준 중위소득 48%) 1~5인, 급지별·가구원수별 기준임대료(1~6인, 원/월), 자기부담 비율(소수, 예: 0.3)", "active": true, "added_by": "처음 설정"}, {"key": "education", "source": "S06", "query": "교육급여의 선정기준", "match": ["교육급여", "선정기준"], "keys": ["params.edu_annual"], "hint": "교육활동지원비 연액: elem(초)·middle(중)·high(고)", "active": true, "added_by": "처음 설정"}, {"key": "basic_pension", "source": "S08", "query": "기초연금 지급대상자 선정기준액", "match": ["기초연금", "선정기준액"], "keys": ["params.basic_pension_line", "params.basic_pension_amount", "params.basic_pension_earned_deduction"], "hint": "선정기준액 single(단독)·couple(부부) 월액, 기준연금액 월액, 근로소득 공제액(월)", "active": true, "added_by": "처음 설정"}, {"key": "disability_pension", "source": "S10", "query": "장애인연금 수급권자 선정기준액", "match": ["장애인연금", "선정기준액"], "keys": ["params.dis_pension"], "hint": "선정기준액 line_single·line_couple, 근로소득 공제(earned_deduction), 기초급여액 등. 나이(age_min·age_max)는 고시가 아니라 법이 정하므로 그대로 둔다", "active": true, "added_by": "처음 설정"}, {"key": "single_parent", "source": "S11", "query": "한부모가족 지원대상자의 범위", "match": ["한부모가족", "지원대상자"], "keys": ["params.sp_child"], "hint": "아동양육비 소득 기준(기준 중위소득 %)과 자녀 1인당 월 금액", "active": true, "added_by": "처음 설정"}, {"key": "nhis_caps", "source": "S13", "query": "월별 건강보험료액의 상한과 하한", "match": ["건강보험료액", "상한", "하한"], "keys": ["params.bukgu_min_premium"], "hint": "지역가입자 월별 보험료액의 하한(최저보험료, 원/월)", "active": true, "added_by": "처음 설정"}];

function WatchedNotices({ t, user, lastCheck, ask }) {
  const { rows, msg, save } = t;
  const [form, setForm] = useState({ query: "", match: "", source: "", keys: [], hint: "" });
  const [q, setQ] = useState("");
  const [state, setState] = useState("all");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleKey = (k) => set("keys", form.keys.includes(k) ? form.keys.filter((x) => x !== k) : [...form.keys, k]);
  const ok = form.query.trim() && form.keys.length > 0;
  const add = () => {
    const row = { key: `n${Date.now().toString(36)}`, source: form.source.trim() || null, query: form.query.trim(),
      match: (form.match.trim() || form.query.trim()).split(",").map((s) => s.trim()).filter(Boolean), keys: form.keys, hint: form.hint.trim(), added_by: user.name };
    save((sb) => sb.from("watched_notices").insert(row), (rs) => [...rs, { ...row, active: true }],
      `'${row.query}' 고시를 감시 목록에 더했어요. 다음 확인 때 지금 시행 중인 버전을 기준으로 기록하고, 그 뒤 새 버전이 나오면 AI가 값을 제안해요.`);
    setForm({ query: "", match: "", source: "", keys: [], hint: "" });
  };
  const toggle = (r) => save((sb) => sb.from("watched_notices").update({ active: !r.active }).eq("key", r.key),
    (rs) => rs.map((x) => (x.key === r.key ? { ...x, active: !x.active } : x)), `'${r.query}' 감시를 ${r.active ? "중지했어요" : "다시 시작했어요"}.`);
  const remove = (r) => ask({
    title: "감시 고시를 삭제할까요?", target: `${r.query}${r.source ? ` (${r.source})` : ""}`, body: "삭제하면 이 고시의 새 버전을 더 이상 확인하지 않아요. 이미 승인한 기준값은 그대로예요. 잠시 멈추려면 '감시 중지'를 쓰세요.", label: "삭제",
    run: () => save((sb) => sb.from("watched_notices").delete().eq("key", r.key), (rs) => rs.filter((x) => x.key !== r.key), `'${r.query}'을(를) 삭제했어요.`),
  });
  const all = rows || [];
  const shown = all.filter((r) => (state === "all" || (state === "on" ? r.active : !r.active))
    && (!q.trim() || `${r.query} ${r.source || ""} ${(r.keys || []).map((k) => KEY_LABEL[k] || k).join(" ")}`.includes(q.trim())));
  const active = all.filter((r) => r.active).length;
  return (
    <section className="card">
      <h2 className="card-title"><span className="section-no">02</span>감시 고시 관리 <small className="hint">전체 {all.length}종 · 감시 중 {active}종</small></h2>
      <p className="hint">매일 아침 국가법령정보 API로 이 고시들의 새 버전(다음 연도 고시·개정)을 확인해요. 새 버전이 나오면 AI가 표까지 읽어 '감시 대상 값'의 새 값을 '중앙 기준값'에 제안해요.</p>
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="list-tools">
        <input type="search" placeholder="고시 이름·코드·값 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="고시 검색" />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="상태">
          <option value="all">전체 상태</option><option value="on">감시 중</option><option value="off">중지됨</option>
        </select>
        <span className="count">{shown.length}종</span>
      </div>
      {!rows ? <p className="hint">불러오는 중…</p> : (
        <ul className="acc-list">
          {shown.map((r) => (
            <li key={r.key} className="acc-row notice-card">
              <div className="acc-main">
                <div className="acc-title"><b className="acc-name">{r.query}</b><StatusPill active={r.active} /></div>
                <span className="hint">{[r.source, (r.match || []).join(" · ")].filter(Boolean).join(" · ")}</span>
                <div className="nc-values"><span className="nc-label">감시 대상 값</span>{(r.keys || []).map((k) => <span key={k} className="nc-value">{KEY_LABEL[k] || k}</span>)}</div>
                {r.active && lastCheck && <span className="hint">마지막 확인 {dayLabel(lastCheck)} 오전 6시</span>}
              </div>
              <div className="acc-edit">
                <button type="button" className="btn sm" onClick={() => toggle(r)}>{r.active ? "감시 중지" : "다시 감시"}</button>
                <button type="button" className="btn sm danger" onClick={() => remove(r)}>삭제</button>
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="hint">조건에 맞는 고시가 없어요.</li>}
        </ul>
      )}
      <details className="lp-text add-box">
        <summary>+ 고시 더하기</summary>
        <div className="cv-form">
          <label className="field"><span>고시 이름 (연도는 빼고, 국가법령정보센터에서 검색되는 이름)</span>
            <input value={form.query} onChange={(e) => set("query", e.target.value)} placeholder="예: 에너지바우처 지원 기준" /></label>
          <label className="field"><span>이름에 꼭 들어갈 말 (쉼표로, 비우면 위 이름 그대로)</span>
            <input value={form.match} onChange={(e) => set("match", e.target.value)} placeholder="예: 에너지바우처, 지원" /></label>
          <label className="field"><span>출처 번호 (선택)</span><input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="예: S19" /></label>
          <div className="field"><span>이 고시가 정하는 값 (AI는 고른 값만 제안해요)</span>
            <div className="cv-keys">{Object.entries(KEY_LABEL).map(([k, label]) => (
              <label key={k} className="check-later"><input type="checkbox" checked={form.keys.includes(k)} onChange={() => toggleKey(k)} /> {label}</label>
            ))}</div></div>
          <label className="field"><span>AI에게 줄 값 설명 (선택)</span><input value={form.hint} onChange={(e) => set("hint", e.target.value)} placeholder="예: 가구원수별 연간 지원액" /></label>
          <button type="button" className="btn primary" disabled={!ok} onClick={add}>감시 고시에 더하기</button>
        </div>
      </details>
    </section>
  );
}
