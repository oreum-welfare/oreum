import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { backendMode, supabaseClient } from "../lib/programs.js";
import { useJson } from "../lib/useJson.js";

// 데모 계정: 실제 비밀번호 없이 역할만 고른다 (Supabase를 연결하면 실제 로그인으로 바뀐다)
export const DEMO_USERS = [
  { id: "demo-gs", name: "경산시 복지정책과 담당자", role: "officer", region: "경상북도 경산시", sido: "경상북도" },
  { id: "demo-bk", name: "대구 북구 복지정책과 담당자", role: "officer", region: "대구광역시 북구", sido: "대구광역시" },
  { id: "demo-yc", name: "영천시 복지정책과 담당자", role: "officer", region: "경상북도 영천시", sido: "경상북도" },
  { id: "demo-admin", name: "오름 시스템 관리자", role: "admin", region: null, sido: null },
];
const SESSION_KEY = "oreum-admin-demo-user";

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const mode = backendMode();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  // Supabase: 로그인 계정의 역할·지자체는 profiles 표에서 읽는다 (사용자가 스스로 바꿀 수 없음)
  const loadProfile = useCallback(async (sb, authUser) => {
    if (!authUser) { setUser(null); return; }
    const { data, error: e } = await sb.from("profiles").select("name, role, region, sido").eq("id", authUser.id).maybeSingle();
    if (e || !data) {
      setUser(null);
      // 권한이 아직 없으면: 가입 신청 상태를 보여 준다. 가입할 때 적은 신청 내용(user_metadata)이 있는데 신청이 없으면 지금 접수
      let { data: req } = await sb.from("access_requests").select("status").eq("id", authUser.id).maybeSingle();
      const m = authUser.user_metadata || {};
      if (!req && m.request_name) {
        const { error: ie } = await sb.from("access_requests").insert({ id: authUser.id, email: authUser.email, name: m.request_name,
          requested_region: m.request_region || null, requested_sido: m.request_sido || null, note: m.request_note || null });
        if (!ie) req = { status: "대기" };
      }
      setError(req?.status === "대기" ? "가입 신청을 접수했어요. 시스템 관리자가 승인하면 로그인할 수 있어요."
        : req?.status === "반려" ? "가입 신청이 반려됐어요. 시스템 관리자에게 문의하세요."
        : "권한 정보가 없는 계정이에요. 시스템 관리자에게 권한을 요청하세요.");
      return;
    }
    setError("");
    setUser({ id: authUser.id, email: authUser.email, ...data });
  }, []);

  useEffect(() => {
    let off = () => {};
    (async () => {
      if (mode === "supabase") {
        try {
          const sb = await supabaseClient();
          const { data } = await sb.auth.getSession();
          await loadProfile(sb, data.session?.user);
          const sub = sb.auth.onAuthStateChange((_e, s) => { loadProfile(sb, s?.user).catch(() => setError("서버에 연결하지 못했어요.")); });
          off = () => sub.data.subscription.unsubscribe();
        } catch {
          setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.");
        }
      } else {
        try { setUser(DEMO_USERS.find((u) => u.id === sessionStorage.getItem(SESSION_KEY)) || null); } catch { /* 저장 불가 */ }
      }
      setReady(true);
    })();
    return () => off();
  }, [mode, loadProfile]);

  const signIn = async (arg) => {
    setError("");
    if (mode === "supabase") {
      try {
        const sb = await supabaseClient();
        const { error: e } = await sb.auth.signInWithPassword({ email: arg.email, password: arg.password });
        if (e) setError(e.status === 400 ? "이메일이나 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 뒤 다시 해 주세요.");
      } catch {
        setError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
      }
      return;
    }
    const u = DEMO_USERS.find((x) => x.id === arg.demoId);
    try { sessionStorage.setItem(SESSION_KEY, u.id); } catch { /* 저장 불가 */ }
    setUser(u);
  };
  // 담당자 가입 신청: 계정을 만들고 신청 내용을 남긴다. 권한(profiles)은 시스템 관리자가 승인할 때만 생긴다
  const signUp = async ({ email, password, name, region, sido, note }) => {
    setError("");
    try {
      const sb = await supabaseClient();
      const { data, error: e } = await sb.auth.signUp({ email, password,
        options: { data: { request_name: name, request_region: region || "", request_sido: sido || "", request_note: note || "" } } });
      if (e) { setError(e.message.includes("registered") ? "이미 가입된 이메일이에요. 로그인해 주세요." : `가입하지 못했어요: ${e.message}`); return false; }
      if (!data.session) { setError("가입했어요. 이메일 인증을 마친 뒤 로그인하면 신청이 접수돼요."); return true; }
      await loadProfile(sb, data.user); // 로그인 상태가 되면 신청을 바로 접수
      return true;
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
      return false;
    }
  };
  const signOut = async () => {
    if (mode === "supabase") await (await supabaseClient()).auth.signOut();
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 저장 불가 */ }
    setUser(null);
    setError("");
  };

  return <Ctx.Provider value={{ mode, user, ready, error, signIn, signUp, signOut }}>{children}</Ctx.Provider>;
}

// 지역 고르기 (시·도 → 시군구). value: rules.json 지역 키, sidoOnly면 시·도 단위 담당
export function RegionPicker({ regions, value, sido, onChange, allowSido = false }) {
  const bySido = {};
  for (const [k, r] of Object.entries(regions || {})) (bySido[r.sido] ||= []).push(k);
  const curSido = sido || regions?.[value]?.sido || "";
  return (
    <div className="region-picker">
      <select aria-label="시·도" value={curSido} onChange={(e) => onChange({ region: allowSido ? null : bySido[e.target.value]?.[0] || null, sido: e.target.value })}>
        <option value="">시·도 선택</option>
        {Object.keys(bySido).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {curSido && (
        <select aria-label="시·군·구" value={value || ""} onChange={(e) => onChange({ region: e.target.value || null, sido: curSido })}>
          {allowSido && <option value="">시·도 전체 (시·도 담당)</option>}
          {(bySido[curSido] || []).map((k) => <option key={k} value={k}>{regions[k].sigungu || k}</option>)}
        </select>
      )}
    </div>
  );
}

// 로그인 화면 (지자체 제도 검토에 들어갈 때)
export function SignIn() {
  const { mode, signIn, signUp, error } = useSession();
  const { data: rules } = useJson("/data/rules.json");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState({ region: null, sido: "" });
  const [note, setNote] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fieldErr, setFieldErr] = useState({});
  if (mode === "supabase" && joining) {
    return (
      <form className="card signin" onSubmit={(e) => { e.preventDefault(); signUp({ email, password, name: name.trim(), region: area.region, sido: area.sido, note }); }}>
        <h2 className="card-title">담당자 가입 신청</h2>
        <p className="hint">신청하면 시스템 관리자가 확인한 뒤 담당 지역을 정해 승인해요. 승인 전에는 제도를 볼 수 없어요.</p>
        <label className="field"><span>이름·소속 (예: 경산시 복지정책과 홍길동)</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>이메일 (업무용)</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>비밀번호 (8자 이상)</span><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <div className="field"><span>희망 담당 지역</span><RegionPicker regions={rules?.regions} value={area.region} sido={area.sido} onChange={setArea} allowSido /></div>
        <label className="field"><span>메모 (선택)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 복지정책과 주무관" /></label>
        {error && <p className="warn">{error}</p>}
        <button type="submit" className="btn primary" disabled={!area.sido}>가입 신청</button>
        <button type="button" className="link-btn" onClick={() => setJoining(false)}>로그인으로 돌아가기</button>
      </form>
    );
  }
  if (mode === "supabase") {
    // 입력 오류는 그 칸 아래, 계정 불일치는 버튼 위, 가입 승인 상태는 안내 상자로
    const submit = (e) => {
      e.preventDefault();
      const fe = {};
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = email.trim() ? "이메일 형식이 맞지 않아요. 예: name@korea.kr" : "이메일을 입력해 주세요.";
      if (!password) fe.password = "비밀번호를 입력해 주세요.";
      setFieldErr(fe);
      if (!fe.email && !fe.password) signIn({ email: email.trim(), password });
    };
    const statusMsg = error && /신청|승인|반려|인증/.test(error);
    return (
      <form className="card signin login-card" onSubmit={submit} noValidate>
        <h2 className="card-title">관리자 로그인</h2>
        <p className="hint">등록된 담당자·관리자 계정으로 로그인해 주세요. 담당자는 자기 지자체 제도만 검토·승인할 수 있어요.</p>
        <label className="field"><span>이메일</span>
          <input type="email" autoComplete="username" value={email} aria-invalid={!!fieldErr.email} onChange={(e) => { setEmail(e.target.value); setFieldErr((f) => ({ ...f, email: "" })); }} />
          {fieldErr.email && <small className="field-err" role="alert">{fieldErr.email}</small>}</label>
        <label className="field"><span>비밀번호</span>
          <span className="pw-wrap">
            <input type={showPw ? "text" : "password"} autoComplete="current-password" value={password} aria-invalid={!!fieldErr.password} onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: "" })); }} />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"} aria-pressed={showPw}>{showPw ? "숨기기" : "보기"}</button>
          </span>
          {fieldErr.password && <small className="field-err" role="alert">{fieldErr.password}</small>}</label>
        {error && (statusMsg ? <p className="notice" role="status">{error}</p> : <p className="login-err" role="alert">{error}</p>)}
        <button type="submit" className="btn primary">로그인</button>
        <div className="join-line">
          <span className="hint">지자체 담당자만 가입 신청할 수 있어요.</span>
          <button type="button" className="btn sm" onClick={() => setJoining(true)}>담당자 가입 신청</button>
        </div>
      </form>
    );
  }
  return (
    <div className="card signin">
      <h2 className="card-title">데모 계정으로 들어가기</h2>
      <p className="hint">지금은 데모 모드예요. 계정을 고르면 그 지자체 제도만 검토·승인할 수 있어요.
        결정은 이 브라우저에만 저장되고, 권한 검사도 화면에서만 해요. 실제 운영에서는 Supabase 로그인과 DB 권한(RLS)으로 바뀌어요.</p>
      <div className="demo-users">
        {DEMO_USERS.map((u) => (
          <button key={u.id} type="button" className="btn" onClick={() => signIn({ demoId: u.id })}>
            <b>{u.name}</b><small>{u.role === "admin" ? "전체 지역" : u.region}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
