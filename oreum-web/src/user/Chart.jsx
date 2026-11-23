import { useEffect, useRef, useState } from "react";
import { manwon } from "./data.js";

// 소득별 '월급 + 혜택' 선 그래프 (SVG). 꺾이는 곳(절벽)만 강조하고 나머지는 회색으로.
// 그림 폭을 실제 화면 폭에 맞춰서 휴대폰에서도 글자가 작아지지 않게 한다.
// 처음에는 '내 구간'(지금 소득 ~ 다음 절벽 ~ 회복)을 확대해 보여 주고, 버튼으로 0원부터 전체를 볼 수 있다.
const PAD = { l: 4, r: 4, b: 22 }; // 위쪽 여백은 번호 원 줄 수에 따라 정한다

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

// 확대할 구간: 볼 지점들(지금·절벽·회복·비교)을 모두 넣고 양옆에 여유. 전체의 80% 넘게 차지하면 확대하지 않는다
export function zoomRange(points, maxX) {
  const ps = points.filter((v) => Number.isFinite(v));
  if (!ps.length || maxX <= 0) return null;
  const lo = Math.min(...ps), hi = Math.max(...ps);
  const span = hi - lo;
  const margin = Math.max(span * 0.4, maxX * 0.04);
  let x0 = Math.max(0, lo - margin), x1 = Math.min(maxX, hi + margin);
  const minWidth = maxX * 0.12; // 너무 좁으면 계단처럼 보여서 최소 폭
  if (x1 - x0 < minWidth) {
    const mid = (x0 + x1) / 2;
    x0 = Math.max(0, mid - minWidth / 2);
    x1 = Math.min(maxX, x0 + minWidth);
    x0 = Math.max(0, x1 - minWidth);
  }
  return x1 - x0 >= maxX * 0.8 ? null : [x0, x1];
}

export default function Chart({ sim, inc, cmp, cliffs, focus }) {
  const [ref, W] = useWidth(480);
  const [full, setFull] = useState(false);
  const PLOT_H = W >= 560 ? 260 : 168; // PC의 넓은 그래프는 더 높게
  const xs = sim.incomes, ys = sim.disposable;
  const maxX = xs[xs.length - 1] || 1;
  const at = (v) => Math.min(xs.length - 1, Math.max(0, Math.round((v / maxX) * (xs.length - 1))));
  // 절벽이 있을 때만 확대 (절벽이 없으면 전체 흐름을 보는 게 더 쓸모 있다)
  const zoom = focus ? zoomRange([inc, focus.income, focus.recover, cmp !== inc ? cmp : null], maxX) : null;
  const [x0, x1] = !full && zoom ? zoom : [0, maxX];
  const i0 = at(x0), i1 = at(x1);
  // 세로축은 보이는 구간에 맞춘다 (확대하면 떨어지는 폭이 또렷하게 보인다)
  const visY = ys.slice(i0, i1 + 1);
  const minY = Math.min(...visY), maxY = Math.max(...visY);
  const pad = (maxY - minY) * 0.12 || Math.max(1, maxY * 0.05);
  const x = (v) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const nowI = at(inc), cmpI = at(cmp);
  const cliffI = focus ? at(focus.income) : null;
  const recI = focus?.recover != null ? at(focus.recover) : null;
  const drop = cliffI != null && cliffI > 0 ? ys[cliffI - 1] - ys[cliffI] : 0;
  const inView = (i) => i >= i0 && i <= i1;

  // 번호 원 위치: 왼쪽부터 놓고, 앞 원과 22px보다 가까우면 한 줄 아래로
  const pins = [
    { n: 1, i: nowI, color: PIN.now },
    cliffI != null && { n: 2, i: cliffI, color: PIN.cliff },
    recI != null && { n: 3, i: recI, color: PIN.recover },
  ].filter((p) => p && inView(p.i)).map((p) => ({ ...p, px: Math.min(W - 11, Math.max(11, x(xs[p.i]))) })).sort((a, b) => a.px - b.px);
  let lastX = -Infinity, row = 0;
  for (const p of pins) { row = p.px - lastX < 22 ? row + 1 : 0; lastX = p.px; p.py = 11 + row * 23; }
  const T = 11 + Math.max(0, ...pins.map((p) => p.py - 11)) + 22; // 번호 원 아래로 그래프 시작
  const H = T + PLOT_H + PAD.b;
  const y = (v) => T + (1 - (v - (minY - pad)) / (maxY + pad - (minY - pad))) * PLOT_H;
  const path = xs.slice(i0, i1 + 1).map((v, k) => `${k ? "L" : "M"}${x(v).toFixed(1)},${y(ys[i0 + k]).toFixed(1)}`).join("");
  const zoomed = x0 > 0 || x1 < maxX;

  const label = `월 ${manwon(inc)} 원일 때 월급과 혜택을 합친 돈은 ${manwon(ys[nowI])} 원` +
    (focus ? `. 월 ${manwon(focus.income)} 원부터 생활비가 ${drop > 0 ? `${manwon(drop)} 원 ` : ""}줄고` + (focus.recover != null ? `, 월 ${manwon(focus.recover)} 원에서 줄기 전 수준을 되찾아요` : "") : "");
  return (
    <figure className="chart" ref={ref} style={{ margin: "28px 0 0" }}>
      {zoom && (
        <div className="chart-zoom">
          <span>{zoomed ? `월급 ${manwon(x0)}~${manwon(x1)} 원 구간을 크게 보여 드려요` : "월급 0원부터 전체"}</span>
          <button type="button" className="link-btn" onClick={() => setFull((f) => !f)} aria-pressed={full}>{full ? "내 구간 크게 보기" : "전체 보기"}</button>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        {/* 생활비가 줄어든 구간 */}
        {cliffI != null && recI != null && inView(cliffI) && <rect x={x(xs[cliffI]) - 1} y={T} width={Math.max(2, x(xs[Math.min(recI, i1)]) - x(xs[cliffI]))} height={H - T - PAD.b} fill="#fdf3f1" />}
        {/* 다른 절벽 (옅게) */}
        {cliffs.filter((c) => c.index !== cliffI && inView(c.index)).map((c) => <line key={c.index} x1={x(xs[c.index])} x2={x(xs[c.index])} y1={T} y2={H - PAD.b} stroke="#e5503c" strokeOpacity="0.25" strokeDasharray="2 3" />)}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#e5e8eb" />
        {/* 세로축 금액 (보이는 구간의 위·아래) — 확대해도 실제 금액을 알 수 있게 */}
        <text x={PAD.l} y={y(maxY) - 4} fontSize="10" fill="#b0b8c1">월 {manwon(maxY)} 원</text>
        <text x={PAD.l} y={y(minY) + 12} fontSize="10" fill="#b0b8c1">월 {manwon(minY)} 원</text>
        <path d={path} fill="none" stroke="#191f28" strokeWidth="2.2" strokeLinejoin="round" />
        {/* 줄어드는 금액 */}
        {drop > 0 && inView(cliffI) && (
          <text x={Math.min(W - PAD.r - 2, x(xs[cliffI]) + 8)} y={y(ys[cliffI]) + 18} fontSize="12" fontWeight="700" fill={PIN.cliff}
            textAnchor={x(xs[cliffI]) > W - 90 ? "end" : "start"}>−{manwon(drop)} 원</text>
        )}
        {/* 비교 소득 */}
        {cmpI !== nowI && inView(cmpI) && <circle cx={x(xs[cmpI])} cy={y(ys[cmpI])} r="5" fill="#fff" stroke="#191f28" strokeWidth="2" />}
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
        {/* 가로축 */}
        <text x={PAD.l} y={H - 4} fontSize="11" fill="#8b95a1">{x0 > 0 ? `${manwon(x0)} 원` : "0원"}</text>
        <text x={W - PAD.r} y={H - 4} fontSize="11" fill="#8b95a1" textAnchor="end">{manwon(x1)} 원</text>
      </svg>
      <ul className="chart-legend">
        <li><i style={{ background: PIN.now }}>1</i>지금 월 {manwon(inc)} 원</li>
        {focus && <li><i style={{ background: PIN.cliff }}>2</i>월 {manwon(focus.income)} 원부터 생활비가 {drop > 0 ? `${manwon(drop)} 원 ` : ""}줄어요</li>}
        {focus?.recover != null && <li><i style={{ background: PIN.recover }}>3</i>월 {manwon(focus.recover)} 원에서 줄기 전만큼 돌아와요</li>}
        {cmpI !== nowI && <li><i className="hollow" />비교 소득 월 {manwon(cmp)} 원</li>}
      </ul>
      <figcaption className="chart-caption"><span>세로: 월급 + 혜택 (한 달 생활비)</span><span>가로: 월급 →</span></figcaption>
    </figure>
  );
}
