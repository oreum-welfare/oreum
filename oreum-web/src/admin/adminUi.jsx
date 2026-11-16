// 관리자 페이지 제목 영역
export function PageHead({ title, desc, children }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>
      {children && <div className="page-head-side">{children}</div>}
    </header>
  );
}
