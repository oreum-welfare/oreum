// 오름 글자 로고 (A안: 름의 가로획이 세 칸 오르는 계단)
// 글자는 currentColor(부모 글자색), 계단만 브랜드 초록. 높이만 정하면 폭은 비율대로.
export default function Logo({ height = 24, title = "오름" }) {
  return (
    <svg viewBox="-6 -6 228 118" height={height} width={(height * 228) / 118} fill="none"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="11" role="img" aria-label={title} style={{ display: "block" }}>
      <g stroke="currentColor">
        <circle cx="50" cy="36" r="27" />
        <path d="M50 63V80M8 88H92" />
        <path d="M128 4H204V19H128V34H204" />
        <rect x="132" y="74" width="68" height="26" />
      </g>
      <path d="M120 62H150V56H180V50H212" stroke="#4ba468" />
    </svg>
  );
}
