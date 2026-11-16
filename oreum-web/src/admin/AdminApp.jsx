import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./chartSetup.js";
import "./admin.css";
import AiResults from "./pages/AiResults.jsx";
import Analysis from "./pages/Analysis.jsx";
import Review from "./pages/Review.jsx";

const TABS = [
  ["analysis", "데이터 분석"],
  ["ai", "AI 성능"],
  ["review", "AI 검수"],
];

// 관리자(운영자) 화면: 정책 분석·AI 추출 성능·사람 검수
export default function AdminApp() {
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-bar">
          <Link to="/admin" className="admin-id" aria-label="오름 관리자 첫 화면">
            <span className="wordmark">오름</span><span>관리자</span>
          </Link>
          <nav className="admin-tabs" aria-label="관리자 메뉴">
            {TABS.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`}>{label}</NavLink>)}
          </nav>
          <Link to="/" className="admin-exit">사용자 화면 →</Link>
        </div>
      </header>
      <div className="admin-body">
        <p className="admin-note">운영자용 화면이에요. 데모라 로그인 없이 열려 있어요.</p>
        <Routes>
          <Route index element={<Navigate to="analysis" replace />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="ai" element={<AiResults />} />
          <Route path="review" element={<Review />} />
          <Route path="*" element={<Navigate to="analysis" replace />} />
        </Routes>
      </div>
    </div>
  );
}
