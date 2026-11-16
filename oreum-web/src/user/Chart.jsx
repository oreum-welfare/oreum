import { useEffect, useRef, useState } from "react";
import { manwon } from "./data.js";

// 소득별 '월급 + 혜택' 선 그래프 (SVG). 꺾이는 곳(절벽)만 강조하고 나머지는 회색으로.
// 그림 폭을 실제 화면 폭에 맞춰서 휴대폰에서도 글자가 작아지지 않게 한다.
const PLOT_H = 168, PAD = { l: 4, r: 4, b: 22 }; // 위쪽 여백은 번호 원 줄 수에 따라 정한다

function useWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ① 지금 ② 생활비가 줄어드는 곳 ③ 줄기 전 수준을 되찾는 곳 — 번호 원을 그래프 위쪽에 두고, 가까우면 아래로 엇갈려 놓는다
const PIN = { now: "#191f28", cliff: "#e5503c", recover: "#3d9a5d" };

export default function Chart({ sim, inc, cmp, cliffs, focus }) {
  const [ref, W] = useWidth(480);
  const xs = sim.incomes, ys = sim.disposable;
  const maxX = xs[xs.length - 1] || 1;
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 1;
  const x = (v) => PAD.l + (v / maxX) * (W - PAD.l - PAD.r);
  const at = (v) => Math.min(xs.length - 1, Math.max(0, Math.round((v / maxX) * (xs.length - 1))));
  const nowI = at(inc), cmpI = at(cmp);
  const cliffI = focus ? at(focus.income) : null;
  const recI = focus?.recover != null ? at(focus.recover) : null;

  // 번호 원 위치: 왼쪽부터 놓고, 앞 원과 22px보다 가까우면 한 줄 아래로
  const pins = [
    { n: 1, i: nowI, color: PIN.now },
    cliffI != null && { n: 2, i: cliffI, color: PIN.cliff },
    recI != null && { n: 3, i: recI, color: PIN.recover },
  ].filter(Boolean).map((p) => ({ ...p, px: Math.min(W - 11, Math.max(11, x(xs[p.i]))) })).sort((a, b) => a.px - b.px);
  let lastX = -Infinity, row = 0;
  for (const p of pins) { row = p.px - lastX < 22 ? row + 1 : 0; lastX = p.px; p.py = 11 + row * 23; }
  const T = 11 + Math.max(0, ...pins.map((p) => p.py - 11)) + 22; // 번호 원 아래로 그래프 시작
  const H = T + PLOT_H + PAD.b;
  const y = (v) => T + (1 - (v - (minY - pad)) / (maxY + pad - (minY - pad))) * PLOT_H;
  const path = xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(ys[i]).toFixed(1)}`).join("");

  const label = `월 ${manwon(inc)} 원일 때 월급과 혜택을 합친 돈은 ${manwon(ys[nowI])} 원` +
    (focus ? `. 월 ${manwon(focus.income)} 원부터 생활비가 줄고` + (focus.recover != null ? `, 월 ${manwon(focus.recover)} 원에서 줄기 전 수준을 되찾아요` : "") : "");
  return (
    <figure className="chart" ref={ref} style={{ margin: "28px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        {/* 생활비가 줄어든 구간 */}
        {cliffI != null && recI != null && <rect x={x(xs[cliffI]) - 1} y={T} width={Math.max(2, x(xs[recI]) - x(xs[cliffI]))} height={H - T - PAD.b} fill="#fdf3f1" />}
        {/* 다른 절벽 (옅게) */}
        {cliffs.filter((c) => c.index !== cliffI).map((c) => <line key={c.index} x1={x(xs[c.index])} x2={x(xs[c.index])} y1={T} y2={H - PAD.b} stroke="#e5503c" strokeOpacity="0.25" strokeDasharray="2 3" />)}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#e5e8eb" />
        <path d={path} fill="none" stroke="#191f28" strokeWidth="2.2" strokeLinejoin="round" />
        {/* 비교 소득 */}
        {cmpI !== nowI && <circle cx={x(xs[cmpI])} cy={y(ys[cmpI])} r="5" fill="#fff" stroke="#191f28" strokeWidth="2" />}
        {/* 번호 원: 세로선 + 그래프 위 점 + 위쪽 번호 */}
        {pins.map((p) => (
          <g key={p.n}>
            <line x1={x(xs[p.i])} x2={x(xs[p.i])} y1={p.py} y2={H - PAD.b} stroke={p.color} strokeWidth="1.4" strokeDasharray={p.n === 1 ? "" : "4 3"} strokeOpacity={p.n === 1 ? 0.5 : 1} />
            <circle cx={x(xs[p.i])} cy={y(ys[p.i])} r="4.5" fill={p.color} />
          </g>
        ))}
        {pins.map((p) => (
          <g key={`pin${p.n}`}>
            <circle cx={p.px} cy={p.py} r="10" fill={p.color} stroke="#fff" strokeWidth="2" />
            <text x={p.px} y={p.py + 4} fontSize="12" fontWeight="700" fill="#fff" textAnchor="middle">{p.n}</text>
          </g>
        ))}
        {/* 축 */}
        <text x={PAD.l} y={H - 4} fontSize="11" fill="#8b95a1">0원</text>
        <text x={W - PAD.r} y={H - 4} fontSize="11" fill="#8b95a1" textAnchor="end">{manwon(maxX)} 원</text>
      </svg>
      <ul className="chart-legend">
        <li><i style={{ background: PIN.now }}>1</i>지금 월 {manwon(inc)} 원</li>
        {focus && <li><i style={{ background: PIN.cliff }}>2</i>월 {manwon(focus.income)} 원부터 생활비가 줄어요</li>}
        {focus?.recover != null && <li><i style={{ background: PIN.recover }}>3</i>월 {manwon(focus.recover)} 원에서 줄기 전만큼 돌아와요</li>}
        {cmpI !== nowI && <li><i className="hollow" />비교 소득 월 {manwon(cmp)} 원</li>}
      </ul>
      <figcaption className="chart-caption"><span>세로: 월급 + 혜택 (한 달 생활비)</span><span>가로: 월급 →</span></figcaption>
    </figure>
  );
}
