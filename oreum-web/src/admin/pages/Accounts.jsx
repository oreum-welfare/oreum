import { useCallback, useEffect, useState } from "react";
import { ROLE_LABEL } from "../../lib/permissions.js";
import { supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { PageHead } from "../adminUi.jsx";
import { DEMO_USERS, RegionPicker, SignIn, useSession } from "../session.jsx";

const areaText = (p) => (p.role === "admin" ? "전체 지역" : p.region || (p.sido ? `${p.sido} 전체` : "지역 없음"));

// 계정 관리: 담당자 가입 신청을 승인하며 담당 지역을 정하고, 기존 계정의 지역을 바꾸거나 권한을 회수한다 (시스템 관리자만)
export default function Accounts() {
  const { mode, user, ready, signOut } = useSession();
  const { data: rules } = useJson("/data/rules.json");
  const [requests, setRequests] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const sb = await supabaseClient();
      const [{ data: reqs, error: e1 }, { data: profs, error: e2 }] = await Promise.all([
        sb.from("access_requests").select("*").order("created_at", { ascending: false }),
        sb.from("profiles").select("*").order("created_at"),
      ]);
      if (e1 || e2) throw e1 || e2;
      setRequests(reqs);
      setProfiles(profs);
    } catch {
      setRequests([]); setProfiles([]);
      setMsg("계정 정보를 불러오지 못했어요. Supabase에서 schema.sql(7절)을 실행했는지 확인해 주세요.");
    }
  }, []);
  useEffect(() => { if (mode === "supabase" && user?.role === "admin") load(); }, [mode, user, load]);

  const head = <PageHead title="계정 관리" desc="담당자 가입 신청을 확인하고 담당 지역을 정해 승인합니다. 권한은 시스템 관리자만 주고 바꿀 수 있어요." />;
  if (!ready) return <p className="hint">불러오는 중…</p>;
  if (!user) return <div className="page">{head}<SignIn /></div>;
  if (user.role !== "admin") return <div className="page">{head}<p className="empty">시스템 관리자만 계정을 관리할 수 있어요. 지금 계정: {user.name} · <button type="button" className="link-btn" onClick={signOut}>다른 계정으로 로그인</button></p></div>;
  if (mode === "demo") {
    return (
      <div className="page">{head}
        <p className="notice">데모 모드에서는 아래 데모 계정만 있어요. Supabase를 연결하면 담당자가 로그인 화면에서 가입 신청하고, 여기서 승인해요.</p>
        <ul className="acc-list">{DEMO_USERS.map((u) => <li key={u.id}><b>{u.name}</b><span className="pill">{ROLE_LABEL[u.role]}</span><span>{areaText(u)}</span></li>)}</ul>
      </div>
    );
  }

  const run = async (fn, done) => {
    setMsg("");
    try {
      const sb = await supabaseClient();
      const { error } = await fn(sb);
      if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return; }
      setMsg(done);
      load();
    } catch {
      setMsg("서버에 연결하지 못했어요.");
    }
  };
  const approve = (req, { role, region, sido }) => run(async (sb) => {
    const p = { id: req.id, email: req.email, name: req.name, role, region: role === "admin" ? null : region, sido: role === "admin" ? null : sido };
    const r1 = await sb.from("profiles").upsert(p);
    if (r1.error) return r1;
    return sb.from("access_requests").update({ status: "승인", decided_by: user.name, decided_at: new Date().toISOString() }).eq("id", req.id);
  }, `${req.name} 님을 승인했어요. 이제 로그인하면 ${role === "admin" ? "전체 지역" : region || `${sido} 전체`} 제도를 볼 수 있어요.`);
  const reject = (req) => run((sb) => sb.from("access_requests").update({ status: "반려", decided_by: user.name, decided_at: new Date().toISOString() }).eq("id", req.id), `${req.name} 님의 신청을 반려했어요.`);
  const change = (p, { role, region, sido }) => run((sb) => sb.from("profiles").update({ role, region: role === "admin" ? null : region, sido: role === "admin" ? null : sido }).eq("id", p.id), `${p.name} 님의 권한을 바꿨어요.`);
  const revoke = (p) => {
    if (!window.confirm(`${p.name} 님의 권한을 회수할까요? 계정은 남지만 제도를 볼 수 없게 돼요.`)) return;
    run((sb) => sb.from("profiles").delete().eq("id", p.id), `${p.name} 님의 권한을 회수했어요.`);
  };

  const pending = (requests || []).filter((r) => r.status === "대기");
  return (
    <div className="page">{head}
      {msg && <p className="notice" role="status">{msg}</p>}
      <section className="card">
        <h2 className="card-title">가입 신청 {pending.length}건</h2>
        {!requests ? <p className="hint">불러오는 중…</p> : pending.length === 0 ? <p className="hint">처리할 신청이 없어요.</p> : (
          <ul className="acc-list">{pending.map((r) => <RequestRow key={r.id} r={r} regions={rules?.regions} onApprove={approve} onReject={reject} />)}</ul>
        )}
      </section>
      <section className="card">
        <h2 className="card-title">계정 {profiles?.length ?? ""}개</h2>
        {!profiles ? <p className="hint">불러오는 중…</p> : (
          <ul className="acc-list">{profiles.map((p) => <ProfileRow key={p.id} p={p} me={p.id === user.id} regions={rules?.regions} onChange={change} onRevoke={revoke} />)}</ul>
        )}
        <p className="hint">처음부터 있던 계정은 이메일이 비어 있을 수 있어요. 담당자는 로그인 화면의 "담당자 가입 신청"으로 계정을 만들어요.</p>
      </section>
    </div>
  );
}

function RoleArea({ regions, init, onSubmit, label }) {
  const [role, setRole] = useState(init.role || "officer");
  const [area, setArea] = useState({ region: init.region || null, sido: init.sido || regions?.[init.region]?.sido || "" });
  return (
    <div className="acc-edit">
      <select aria-label="역할" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="officer">지자체 담당자</option>
        <option value="admin">시스템 관리자</option>
      </select>
      {role === "officer" && <RegionPicker regions={regions} value={area.region} sido={area.sido} onChange={setArea} allowSido />}
      <button type="button" className="btn sm primary" disabled={role === "officer" && !area.sido} onClick={() => onSubmit({ role, ...area })}>{label}</button>
    </div>
  );
}

function RequestRow({ r, regions, onApprove, onReject }) {
  return (
    <li className="acc-row">
      <div><b>{r.name}</b> <small className="hint">{r.email} · {String(r.created_at).slice(0, 10)}</small></div>
      <div className="hint">희망: {r.requested_region || (r.requested_sido ? `${r.requested_sido} 전체` : "—")}{r.note ? ` · ${r.note}` : ""}</div>
      <RoleArea regions={regions} init={{ role: "officer", region: r.requested_region, sido: r.requested_sido }} onSubmit={(v) => onApprove(r, v)} label="승인" />
      <button type="button" className="btn sm ghost" onClick={() => onReject(r)}>반려</button>
    </li>
  );
}

function ProfileRow({ p, me, regions, onChange, onRevoke }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="acc-row">
      <div><b>{p.name}</b>{me && <span className="pill brand">나</span>} <small className="hint">{p.email || ""}</small></div>
      <div><span className="pill">{ROLE_LABEL[p.role]}</span> {areaText(p)}</div>
      {editing
        ? <RoleArea regions={regions} init={p} onSubmit={(v) => { setEditing(false); onChange(p, v); }} label="저장" />
        : <div className="acc-edit">
            <button type="button" className="btn sm" onClick={() => setEditing(true)} disabled={me}>권한·지역 바꾸기</button>
            <button type="button" className="btn sm ghost" onClick={() => onRevoke(p)} disabled={me}>권한 회수</button>
          </div>}
    </li>
  );
}
