import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { backendMode, supabaseClient } from "../lib/programs.js";

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
    const { data, error: e } = await sb.from("profiles").select("name, role, region, sido").eq("id", authUser.id).single();
    if (e || !data) { setError("권한 정보가 없는 계정이에요. 시스템 관리자에게 권한을 요청하세요."); setUser(null); return; }
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
  const signOut = async () => {
    if (mode === "supabase") await (await supabaseClient()).auth.signOut();
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 저장 불가 */ }
    setUser(null);
  };

  return <Ctx.Provider value={{ mode, user, ready, error, signIn, signOut }}>{children}</Ctx.Provider>;
}

// 로그인 화면 (지자체 제도 검토에 들어갈 때)
export function SignIn() {
  const { mode, signIn, error } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  if (mode === "supabase") {
    return (
      <form className="card signin" onSubmit={(e) => { e.preventDefault(); signIn({ email, password }); }}>
        <h2 className="card-title">담당자 로그인</h2>
        <p className="hint">지자체 담당자 계정으로 로그인하면 자기 지자체 제도만 검토·승인할 수 있어요.</p>
        <label className="field"><span>이메일</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>비밀번호</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="warn">{error}</p>}
        <button type="submit" className="btn primary">로그인</button>
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
