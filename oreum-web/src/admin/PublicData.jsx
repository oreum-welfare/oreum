import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import "./chartSetup.js";
import "./admin.css";
import Logo from "../ui/Logo.jsx";
import AiResults from "./pages/AiResults.jsx";
import Analysis from "./pages/Analysis.jsx";
import Review from "./pages/Review.jsx";

// 공개 데이터·분석 (/data): 심사위원·연구자·시민이 로그인 없이 근거를 확인하는 곳.
// 제도 승인·계정 같은 관리 기능은 /admin (로그인) 에만 있다.
const TABS = [
  ["analysis", "데이터 분석", <Analysis />],
  ["ai", "AI 성능", <AiResults />],
  ["review", "AI 검수", <Review />],
];

export default function PublicData() {
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-bar">
          <Link to="/data" className="admin-id" aria-label="오름 데이터·분석 첫 화면">
            <span className="wordmark"><Logo height={24} /></span><span>데이터·분석</span>
          </Link>
          <nav className="admin-tabs" aria-label="데이터·분석 메뉴">
            {TABS.map(([path, label]) => <NavLink key={path} to={`/data/${path}`}>{label}</NavLink>)}
          </nav>
          <Link to="/" className="admin-exit">계산하러 가기 →</Link>
        </div>
      </header>
      <div className="admin-body">
        <p className="admin-note">평가·검증용 공개 자료예요. 복지 절벽 분석과 AI 변환 성능을 누구나 볼 수 있어요. 개인 정보는 들어 있지 않아요.</p>
        <Routes>
          <Route index element={<Navigate to="analysis" replace />} />
          {TABS.map(([path, , el]) => <Route key={path} path={path} element={el} />)}
          <Route path="*" element={<Navigate to="analysis" replace />} />
        </Routes>
      </div>
    </div>
  );
}
