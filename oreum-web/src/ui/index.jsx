import { useEffect, useState } from "react";

// 아래에서 올라오는 시트 (PC에서는 가운데 창). Esc·바깥 누르면 닫힘
export function Sheet({ title, sub, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-dim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-head"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        <div className="sheet-body">{children}</div>
        <div className="sheet-foot">{footer ?? <button type="button" className="btn primary" style={{ width: "100%" }} onClick={onClose}>확인</button>}</div>
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, suffix = "", label }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label} 줄이기`}>−</button>
      <b aria-live="polite">{value}{suffix}</b>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label} 늘리기`}>+</button>
    </span>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <span className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </span>
  );
}

// 큰 선택지 (하나 고르기 또는 켜고 끄기)
export function Option({ on, onClick, children, sub }) {
  return (
    <button type="button" className={`option ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span>{children}{sub && <small>{sub}</small>}</span>
      <span className="mark" aria-hidden="true">{on ? "✓" : ""}</span>
    </button>
  );
}

// 만 원 단위 숫자 칸 (소수 입력 중에도 글자가 지워지지 않게, 값은 원 단위로 전달)
export function ManwonInput({ value, onChange, ...rest }) {
  const toText = (v) => (v ? String(Math.round((v / 10000) * 100) / 100) : "");
  const [text, setText] = useState(toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(toText(value)); }, [value, focused]);
  return (
    <input type="text" inputMode="decimal" placeholder="0" value={text} {...rest}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setText(toText(value)); }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
        setText(t);
        onChange(Math.max(0, Math.round((Number(t) || 0) * 10000)));
      }} />
  );
}
