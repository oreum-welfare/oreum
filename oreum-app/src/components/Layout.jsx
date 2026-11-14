import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <>
      <header className="site-header">
        <div className="wrap header-inner">
          <NavLink className="brand" to="/">
            <img src="/logo-icon.svg" alt="" width="40" height="40" />
            <span className="brand-name">오름</span>
          </NavLink>
          <span className="brand-tag">AI 기반 복지 절벽 탐지·자립경로 시뮬레이터</span>
          <nav className="nav">
            <NavLink to="/" end>시뮬레이터</NavLink>
            <NavLink to="/analysis">데이터 분석</NavLink>
            <NavLink to="/review">AI 검수</NavLink>
          </nav>
        </div>
      </header>
      <Outlet />
      <footer className="site-footer">
        <div className="wrap footer-bottom">
          오름 · 데이터: 복지로(보건복지부), 한국사회보장정보원 · 2026년 기준 · 참고용이며 실제 수급 판정은 행정복지센터에서 결정됩니다.
        </div>
      </footer>
    </>
  );
}
