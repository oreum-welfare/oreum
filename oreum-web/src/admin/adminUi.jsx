// 관리자 페이지 제목 영역
export function PageHead({ title, desc, children }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>
      {children && <div className="page-head-side">{children}</div>}
    </header>
  );
}

// 요약 숫자 줄 (예: 전체 계정 4 · 지자체 담당자 3 · 가입 신청 0)
export function StatRow({ items }) {
  return (
    <div className="stat-row">
      {items.map(({ label, value, tone, note }) => (
        <div key={label} className={`stat ${tone || ""}`}>
          <span className="stat-label">{label}</span>
          <b className="stat-value">{value}</b>
          {note && <span className="stat-note">{note}</span>}
        </div>
      ))}
    </div>
  );
}

// 위험한 동작(권한 회수·삭제) 확인 창. 브라우저 기본 confirm 대신 무엇이 일어나는지 적어 보여 준다
export function ConfirmModal({ title, target, body, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="modal-back" role="presentation" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="modal-title">{title}</h2>
        {target && <p className="modal-target">{target}</p>}
        {body && <p className="hint">{body}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} autoFocus>취소</button>
          <button type="button" className="btn danger-solid" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
