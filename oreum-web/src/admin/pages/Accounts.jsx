import { useCallback, useEffect, useMemo, useState } from "react";
import { ROLE_LABEL } from "../../lib/permissions.js";
import { supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { ConfirmModal, PageHead, StatRow } from "../adminUi.jsx";
import { DEMO_USERS, RegionPicker, SignIn, useSession } from "../session.jsx";

// 누가 어디까지 관리하나 (계정 관리 화면의 핵심)
const areaText = (p) => (p.role === "admin" ? "전체 지역 관리 권한" : p.region ? `${p.region} 담당` : p.sido ? `${p.sido} 전체 담당` : "담당 지역 없음");
const areaOf = (p) => p.region || p.requested_region || (p.sido || p.requested_sido ? `${p.sido || p.requested_sido} 전체` : "");

// 계정 관리: 담당자 가입 신청을 승인하며 담당 지역을 정하고, 기존 계정의 지역을 바꾸거나 권한을 회수한다 (시스템 관리자만)
export default function Accounts() {
  const { mode, user, ready, signOut } = useSession();
  const { data: rules } = useJson("/data/rules.json");
  const [requests, setRequests] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(null); // { title, target, body, label, run }
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [sido, setSido] = useState("all");

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

  const demo = mode === "demo";
  const accounts = demo ? DEMO_USERS : profiles;
  const pending = (requests || []).filter((r) => r.status === "대기");
  const sidos = useMemo(() => [...new Set((accounts || []).map((p) => p.sido || rules?.regions?.[p.region]?.sido).filter(Boolean))].sort(), [accounts, rules]);
  const shown = (accounts || []).filter((p) => (role === "all" || p.role === role)
    && (sido === "all" || (p.sido || rules?.regions?.[p.region]?.sido) === sido)
    && (!q.trim() || `${p.name} ${p.email || ""} ${p.region || ""} ${p.sido || ""}`.includes(q.trim())));

  const head = <PageHead title="계정 관리" desc="누가 어느 지역 제도를 검토할 수 있는지 관리합니다. 권한은 시스템 관리자만 주고 바꿀 수 있어요." />;
  if (!ready) return <p className="hint">불러오는 중…</p>;
  if (!user) return <div className="page">{head}<SignIn /></div>;
  if (user.role !== "admin") return <div className="page">{head}<p className="empty">시스템 관리자만 계정을 관리할 수 있어요. 지금 계정: {user.name} · <button type="button" className="link-btn" onClick={signOut}>다른 계정으로 로그인</button></p></div>;

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
  const approve = (req, { role: r, region, sido: s }) => run(async (sb) => {
    const p = { id: req.id, email: req.email, name: req.name, role: r, region: r === "admin" ? null : region, sido: r === "admin" ? null : s };
    const r1 = await sb.from("profiles").upsert(p);
    if (r1.error) return r1;
    return sb.from("access_requests").update({ status: "승인", decided_by: user.name, decided_at: new Date().toISOString() }).eq("id", req.id);
  }, `${req.name} 님을 승인했어요. 이제 로그인하면 ${r === "admin" ? "전체 지역" : region || `${s} 전체`} 제도를 볼 수 있어요.`);
  const reject = (req) => setConfirm({
    title: "가입 신청을 반려할까요?", target: `${req.name} (${req.email || ""})`, body: "반려하면 이 계정은 관리자 화면에 들어올 수 없어요. 다시 신청하려면 관리자에게 문의해야 해요.", label: "반려",
    run: () => run((sb) => sb.from("access_requests").update({ status: "반려", decided_by: user.name, decided_at: new Date().toISOString() }).eq("id", req.id), `${req.name} 님의 신청을 반려했어요.`),
  });
  const change = (p, { role: r, region, sido: s }) => run((sb) => sb.from("profiles").update({ role: r, region: r === "admin" ? null : region, sido: r === "admin" ? null : s }).eq("id", p.id), `${p.name} 님의 권한을 바꿨어요.`);
  const revoke = (p) => setConfirm({
    title: "계정 권한을 회수할까요?", target: `${p.name} · ${areaText(p)}`, body: "회수하면 이 계정은 관리자 화면에 들어올 수 없어요. 계정은 남아 있어서 다시 권한을 줄 수 있어요.", label: "권한 회수",
    run: () => run((sb) => sb.from("profiles").delete().eq("id", p.id), `${p.name} 님의 권한을 회수했어요.`),
  });

  const officers = (accounts || []).filter((p) => p.role === "officer").length;
  const admins = (accounts || []).filter((p) => p.role === "admin").length;
  return (
    <div className="page">{head}
      <StatRow items={[
        { label: "전체 계정", value: accounts ? `${accounts.length}개` : "…" },
        { label: "시스템 관리자", value: `${admins}명` },
        { label: "지자체 담당자", value: `${officers}명` },
        { label: "가입 신청", value: demo ? "—" : `${pending.length}건`, tone: pending.length ? "warn" : "ok", note: demo ? "Supabase 연결 시" : pending.length ? "아래에서 확인해 주세요" : "모두 확인 완료" },
      ]} />
      {demo && <p className="notice">데모 모드: 아래 데모 계정만 있어요. Supabase를 연결하면 담당자가 로그인 화면에서 가입 신청하고, 여기서 승인해요.</p>}
      {msg && <p className="notice" role="status">{msg}</p>}

      {pending.length > 0 && (
        <section className="card">
          <h2 className="card-title">가입 신청 {pending.length}건 <small className="hint">희망 지역을 확인하고 실제 담당 지역을 정해 승인해 주세요</small></h2>
          <ul className="acc-list">{pending.map((r) => <RequestRow key={r.id} r={r} regions={rules?.regions} onApprove={approve} onReject={reject} />)}</ul>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">계정 목록</h2>
        <div className="list-tools">
          <input type="search" placeholder="이름·이메일·지역 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="계정 검색" />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="권한">
            <option value="all">전체 권한</option><option value="admin">시스템 관리자</option><option value="officer">지자체 담당자</option>
          </select>
          <select value={sido} onChange={(e) => setSido(e.target.value)} aria-label="지역">
            <option value="all">전체 지역</option>{sidos.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="count">{shown.length}개 계정</span>
        </div>
        {!accounts ? <p className="hint">불러오는 중…</p> : shown.length === 0 ? <p className="hint">조건에 맞는 계정이 없어요.</p> : (
          <ul className="acc-list">{shown.map((p) => <ProfileRow key={p.id} p={p} me={p.id === user.id} demo={demo} regions={rules?.regions} onChange={change} onRevoke={revoke} />)}</ul>
        )}
        {!demo && <p className="hint">담당자는 로그인 화면의 "담당자 가입 신청"으로 계정을 만들어요. 처음부터 있던 계정은 이메일이 비어 있을 수 있어요.</p>}
      </section>
      {confirm && <ConfirmModal title={confirm.title} target={confirm.target} body={confirm.body} confirmLabel={confirm.label}
        onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c.run(); }} />}
    </div>
  );
}

function RoleArea({ regions, init, onSubmit, label, wanted }) {
  const [role, setRole] = useState(init.role || "officer");
  const [area, setArea] = useState({ region: init.region || null, sido: init.sido || regions?.[init.region]?.sido || "" });
  const chosen = role === "admin" ? "전체" : area.region || (area.sido ? `${area.sido} 전체` : "");
  const differs = wanted && role === "officer" && chosen && chosen !== wanted;
  return (
    <div className="acc-edit">
      <select aria-label="역할" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="officer">지자체 담당자</option>
        <option value="admin">시스템 관리자</option>
      </select>
      {role === "officer" && <RegionPicker regions={regions} value={area.region} sido={area.sido} onChange={setArea} allowSido />}
      <button type="button" className="btn sm primary" disabled={role === "officer" && !area.sido} onClick={() => onSubmit({ role, ...area })}>{label}</button>
      {differs && <span className="pill warn">희망 지역({wanted})과 달라요</span>}
    </div>
  );
}

function RequestRow({ r, regions, onApprove, onReject }) {
  return (
    <li className="acc-row">
      <div className="acc-main">
        <b className="acc-name">{r.name}</b>
        <span className="hint">{r.email} · 신청 {String(r.created_at).slice(0, 10)}</span>
        <span className="hint">희망 담당 지역: <b>{areaOf(r) || "—"}</b>{r.note ? ` · ${r.note}` : ""}</span>
      </div>
      <RoleArea regions={regions} init={{ role: "officer", region: r.requested_region, sido: r.requested_sido }} wanted={areaOf(r)} onSubmit={(v) => onApprove(r, v)} label="승인" />
      <button type="button" className="btn sm danger" onClick={() => onReject(r)}>반려</button>
    </li>
  );
}

function ProfileRow({ p, me, demo, regions, onChange, onRevoke }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="acc-row">
      <div className="acc-main">
        <div className="acc-title">
          <b className="acc-name">{p.name}</b>
          <span className={`pill ${p.role === "admin" ? "brand" : ""}`}>{ROLE_LABEL[p.role]}</span>
          {me && <span className="pill ok">본인 계정</span>}
        </div>
        <span className="acc-area">{areaText(p)}</span>
        {p.email && <span className="hint">{p.email}</span>}
      </div>
      {editing
        ? <RoleArea regions={regions} init={p} onSubmit={(v) => { setEditing(false); onChange(p, v); }} label="저장" />
        : <div className="acc-edit">
            <button type="button" className="btn sm" onClick={() => setEditing(true)} disabled={me || demo} title={me ? "본인 권한은 다른 관리자가 바꿔요" : demo ? "데모 모드에서는 바꿀 수 없어요" : ""}>권한·지역 바꾸기</button>
            <button type="button" className="btn sm danger" onClick={() => onRevoke(p)} disabled={me || demo} title={me ? "본인 권한은 회수할 수 없어요" : ""}>권한 회수</button>
          </div>}
    </li>
  );
}
