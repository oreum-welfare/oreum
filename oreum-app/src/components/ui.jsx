import { useEffect } from "react";

// 선 아이콘 (24 그리드, stroke). 이모지 대신 쓴다.
const PATHS = {
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  chart: "M5 20V10M12 20V4M19 20v-7",
  cpu: "M8 8h8v8H8zM4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2",
  check: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  arrow: "M7 17L17 7M9 7h8v8",
  x: "M6 6l12 12M18 6L6 18",
  down: "M6 9l6 6 6-6",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  wallet: "M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3v3M16 13h.01",
  trendDown: "M4 7l6 6 4-4 6 6M20 10v5h-5",
  trendUp: "M4 17l6-6 4 4 6-6M20 14V9h-5",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// 카드 구석의 '자세히' 버튼
export function MoreButton({ onClick, label, tone = "" }) {
  return (
    <button type="button" className={`more-btn ${tone}`} onClick={onClick} aria-label={`${label} 자세히 보기`}>
      <Icon name="arrow" size={15} />
    </button>
  );
}

// 오른쪽에서 열리는 자세히 보기 패널 (휴대폰에서는 아래에서 올라옴)
export function Drawer({ title, sub, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="drawer-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><Icon name="x" /></button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

// 페이지 제목 영역
export function PageHead({ title, desc, children }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>
      {children && <div className="page-head-side">{children}</div>}
    </header>
  );
}

// − 숫자 + 조절기
export function Stepper({ value, onChange, min = 0, max = 99, suffix = "", label }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label} 줄이기`}>−</button>
      <b>{value}{suffix}</b>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label} 늘리기`}>+</button>
    </span>
  );
}

// 두세 칸 선택 버튼
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
