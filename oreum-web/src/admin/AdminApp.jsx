import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./chartSetup.js";
import "./admin.css";
import Logo from "../ui/Logo.jsx";
import { ROLE_LABEL } from "../lib/permissions.js";
import Accounts from "./pages/Accounts.jsx";
import AiResults from "./pages/AiResults.jsx";
import Analysis from "./pages/Analysis.jsx";
import CentralValues from "./pages/CentralValues.jsx";
import LocalPrograms from "./pages/LocalPrograms.jsx";
import Review from "./pages/Review.jsx";
import Settings from "./pages/Settings.jsx";
import { SessionProvider, SignIn, useSession } from "./session.jsx";

// [경로, 이름, 화면, 볼 수 있는 역할]. 관리자 화면은 로그인한 사람만, 역할에 맞는 탭만 보인다
// (주소를 직접 쳐서 들어와도 역할에 없는 탭은 첫 화면으로 돌려보내고, 각 페이지·DB 권한이 다시 막는다)
const TABS = [
  ["analysis", "데이터 분석", <Analysis />, ["admin", "officer"]],
  ["ai", "AI 성능", <AiResults />, ["admin"]],
  ["review", "AI 검수", <Review />, ["admin"]],
  ["local", "지자체 제도 검토", <LocalPrograms />, ["admin", "officer"]],
  ["central", "중앙 기준값", <CentralValues />, ["admin"]],
  ["accounts", "계정 관리", <Accounts />, ["admin"]],
  ["settings", "운영 설정", <Settings />, ["admin"]],
];

// 관리자(운영자) 화면: 담당자는 자기 지역 제도 검토, 시스템 관리자는 운영 전체
export default function AdminApp() {
  return <SessionProvider><AdminShell /></SessionProvider>;
}

function AdminShell() {
  const { user, mode, ready, signOut } = useSession();
  const tabs = TABS.filter(([, , , roles]) => user && roles.includes(user.role));
  const home = user?.role === "admin" ? "analysis" : "local"; // 담당자는 제도 검토부터
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-bar">
          <Link to="/admin" className="admin-id" aria-label="오름 관리자 첫 화면">
            <span className="wordmark"><Logo height={24} /></span><span>관리자</span>
          </Link>
          {user && (
            <nav className="admin-tabs" aria-label="관리자 메뉴">
              {tabs.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`}>{label}</NavLink>)}
            </nav>
          )}
          {user
            ? <div className="admin-who"><span title={ROLE_LABEL[user.role]}>{user.name}</span><Link to="/">사용자 화면</Link><button type="button" className="link-btn" onClick={signOut}>로그아웃</button></div>
            : <Link to="/" className="admin-exit">사용자 화면 →</Link>}
        </div>
      </header>
      <div className="admin-body">
        {!ready ? <p className="hint">불러오는 중…</p> : !user ? (
          // 들어오자마자 로그인: 담당자·시스템 관리자만 쓰는 업무 화면
          // 왼쪽: 관리자 포털 소개 · 오른쪽: 로그인 카드
          <div className="admin-gate">
            <section className="gate-intro">
              <span className="gate-kicker">ADMIN PORTAL</span>
              <h1>더 정확한 복지를 위한 관리</h1>
              <p>AI가 분석한 복지 제도를 검토하고, 지역 주민에게 정확한 복지 정보를 제공하세요.{mode === "demo" ? " 지금은 데모 모드라 계정을 고르면 바로 들어가요." : ""}</p>
              <p className="gate-sub">관리자 주요 업무</p>
              <ul className="gate-tasks">
                <li><b>복지 제도 검토 및 승인</b><span>AI 초안을 원문과 비교해 승인·반려</span></li>
                <li><b>복지 데이터 관리</b><span>중앙 기준값·지자체 제도 버전 관리</span></li>
                <li><b>정확한 계산 기준 관리</b><span>새 고시의 시행일·값 확인</span></li>
              </ul>
            </section>
            <SignIn />
          </div>
        ) : (
          <Routes>
            <Route index element={<Navigate to={home} replace />} />
            {tabs.map(([path, , el]) => <Route key={path} path={path} element={el} />)}
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        )}
      </div>
    </div>
  );
}
