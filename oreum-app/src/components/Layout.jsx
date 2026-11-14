import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "./ui.jsx";

// [주소, 메뉴 이름, 휴대폰 하단 탭 이름, 아이콘, end]
const MENUS = [
  ["/", "소득·복지 시뮬레이터", "시뮬레이터", "home", true],
  ["/analysis", "복지 데이터 분석", "데이터 분석", "chart"],
  ["/ai", "AI 성능 평가", "AI 성능", "cpu"],
  ["/review", "AI 결과 검수", "AI 검수", "check"],
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
          <img src="/oreum-logo.png" alt="오름" className="brand-logo" />
        </NavLink>

        <div className="sidebar-caption">복지 서비스</div>

        <nav className="nav" aria-label="주요 메뉴">
          {MENUS.map(([to, label, short, icon, end]) => (
            <NavLink key={to} to={to === "/" ? lastSim() : to} end={end}>
              <Icon name={icon} />
              <span className="nav-full">{label}</span>
              <span className="nav-short">{short}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-message">
            <span className="message-title">나에게 맞는 복지 찾기</span>
            <p>작은 변화부터 시작하는<br />나만의 복지 설계</p>
          </div>
          <span className="sidebar-version">OREUM · 2026 · 참고용</span>
        </div>
      </aside>
      <div className="main">
        <header className="mobile-top">
          <NavLink className="brand" to="/" aria-label="오름 홈"><img src="/oreum-logo.png" alt="오름" className="brand-logo" /></NavLink>
          <span>복지 절벽 시뮬레이터</span>
        </header>
        <Outlet />
        <footer className="foot">오름 · 데이터: 복지로(보건복지부), 한국사회보장정보원 · 2026년 기준 · 참고용이며 실제 수급 판정은 행정복지센터에서 결정됩니다.</footer>
      </div>
    </div>
  );
}
