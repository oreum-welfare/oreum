import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "./ui.jsx";

const NAV = [
  ["/", "시뮬레이터", "home", true],
  ["/analysis", "데이터 분석", "chart"],
  ["/ai", "AI 성능", "cpu"],
  ["/review", "AI 검수", "check"],
];

// 시뮬레이터 결과를 보다가 다른 메뉴에 갔다 와도 결과가 남도록, 마지막 입력 주소를 기억한다
function lastSim() {
  try { const q = sessionStorage.getItem("oreum-sim"); return q ? `/?${q}` : "/"; } catch { return "/"; }
}

export default function Layout() {
  useLocation(); // 화면이 바뀔 때마다 메뉴 주소를 다시 계산
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="메뉴">
        <NavLink className="brand" to="/" aria-label="오름 홈">
          <img src="/logo-icon.svg" alt="" width="36" height="36" />
          <span className="brand-text"><b>오름</b><small>복지 절벽 시뮬레이터</small></span>
        </NavLink>
        <nav className="nav">
          {NAV.map(([to, label, icon, end]) => (
            <NavLink key={to} to={to === "/" ? lastSim() : to} end={end}><Icon name={icon} /><span>{label}</span></NavLink>
          ))}
        </nav>
        <p className="sidebar-note">2026년 기준 · 참고용<br />실제 수급은 행정복지센터에서 결정</p>
      </aside>
      <div className="main">
        <header className="mobile-top">
          <NavLink className="brand" to="/"><img src="/logo-icon.svg" alt="" width="30" height="30" /><span className="brand-text"><b>오름</b></span></NavLink>
          <span>복지 절벽 시뮬레이터</span>
        </header>
        <Outlet />
        <footer className="foot">오름 · 데이터: 복지로(보건복지부), 한국사회보장정보원 · 2026년 기준 · 참고용이며 실제 수급 판정은 행정복지센터에서 결정됩니다.</footer>
      </div>
    </div>
  );
}
