import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./chartSetup.js";
import "./admin.css";
import Logo from "../ui/Logo.jsx";
import Accounts from "./pages/Accounts.jsx";
import AiResults from "./pages/AiResults.jsx";
import Analysis from "./pages/Analysis.jsx";
import CentralValues from "./pages/CentralValues.jsx";
import LocalPrograms from "./pages/LocalPrograms.jsx";
import Review from "./pages/Review.jsx";
import Settings from "./pages/Settings.jsx";
import { SessionProvider, useSession } from "./session.jsx";

const TABS = [
  ["analysis", "데이터 분석"],
  ["ai", "AI 성능"],
  ["review", "AI 검수"],
  ["local", "지자체 제도 검토"],
  ["central", "중앙 기준값"],
  ["accounts", "계정 관리"],
  ["settings", "운영 설정"],
];

// 관리자(운영자) 화면: 정책 분석·AI 추출 성능·사람 검수
export default function AdminApp() {
  return <SessionProvider><AdminShell /></SessionProvider>;
}

function AdminShell() {
  const { user, mode } = useSession();
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-bar">
          <Link to="/admin" className="admin-id" aria-label="오름 관리자 첫 화면">
            <span className="wordmark"><Logo height={24} /></span><span>관리자</span>
          </Link>
          <nav className="admin-tabs" aria-label="관리자 메뉴">
            {TABS.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`}>{label}</NavLink>)}
          </nav>
          <Link to="/" className="admin-exit">사용자 화면 →</Link>
        </div>
      </header>
      <div className="admin-body">
        <p className="admin-note">분석·AI 성능은 공개 자료라 누구나 볼 수 있어요. 지자체 제도 검토·승인은 담당자, 중앙 기준값은 시스템 관리자 로그인이 필요해요{mode === "demo" ? " (지금은 데모 계정)" : ""}.{user ? ` 로그인: ${user.name}` : ""}</p>
        <Routes>
          <Route index element={<Navigate to="analysis" replace />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="ai" element={<AiResults />} />
          <Route path="review" element={<Review />} />
          <Route path="local" element={<LocalPrograms />} />
          <Route path="central" element={<CentralValues />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="analysis" replace />} />
        </Routes>
      </div>
    </div>
  );
}
