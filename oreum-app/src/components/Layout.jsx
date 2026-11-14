
import { NavLink, Outlet } from "react-router-dom";

const menus = [
  { to: "/", label: "소득·복지 시뮬레이터", end: true },
  { to: "/analysis", label: "복지 데이터 분석" },
  { to: "/ai", label: "AI 성능 평가" },
  { to: "/review", label: "AI 결과 검수" },
];

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
      <NavLink className="brand" to="/">
        <img
          src="/oreum-logo.png"
          alt="오름"
          className="brand-logo"
        />
      </NavLink>

        <div className="sidebar-caption">복지 서비스</div>

        <nav className="side-nav" aria-label="주요 메뉴">
          {menus.map((menu) => (
            <NavLink
              key={menu.to}
              to={menu.to}
              end={menu.end}
              className={({ isActive }) =>
                `side-nav-link${isActive ? " active" : ""}`
              }
            >
              <span>{menu.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-message">
            <span className="message-title">나에게 맞는 복지 찾기</span>
            <p>작은 변화부터 시작하는<br />나만의 복지 설계</p>
          </div>
          <span className="sidebar-version">OREUM · 2026</span>
        </div>
      </aside>

      <div className="main-shell">

        <main className="main-content">
          <Outlet />
        </main>

        <footer className="site-footer">
          <div className="footer-bottom">
            오름 · 데이터: 복지로(보건복지부), 한국사회보장정보원 ·
            2026년 기준 · 참고용이며 실제 수급 판정은 행정복지센터에서 결정됩니다.
          </div>
        </footer>
      </div>
    </div>
  );
}
