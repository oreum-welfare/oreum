import { useEffect, useRef, useState } from "react";
import { manwon } from "./data.js";

// 소득별 '월급 + 혜택' 선 그래프 (SVG). 꺾이는 곳(절벽)만 강조하고 나머지는 회색으로.
// 그림 폭을 실제 화면 폭에 맞춰서 휴대폰에서도 글자가 작아지지 않게 한다.
const H = 200, PAD = { l: 4, r: 4, t: 26, b: 22 };

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

export default function Chart({ sim, inc, cmp, cliff, cliffs }) {
  const [ref, W] = useWidth(480);
  const xs = sim.incomes, ys = sim.disposable;
  const maxX = xs[xs.length - 1] || 1;
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 1;
  const x = (v) => PAD.l + (v / maxX) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - (minY - pad)) / (maxY + pad - (minY - pad))) * (H - PAD.t - PAD.b);
  const at = (v) => Math.min(xs.length - 1, Math.max(0, Math.round((v / maxX) * (xs.length - 1))));
  const path = xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(ys[i]).toFixed(1)}`).join("");
  const nowI = at(inc), cmpI = at(cmp);
  const cliffI = cliff ? at(cliff.income) : null;
  const recI = cliff?.recover != null ? at(cliff.recover) : null;
  const label = `월 ${manwon(inc)} 원일 때 월급과 혜택을 합친 돈은 ${manwon(ys[nowI])} 원` + (cliff ? `. 월 ${manwon(cliff.income)} 원에서 ${manwon(cliff.drop)} 원 줄어드는 절벽` : "");
  return (
    <figure className="chart" ref={ref} style={{ margin: "28px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        {/* 생활비가 줄어든 구간 */}
        {cliffI != null && recI != null && <rect x={x(xs[cliffI]) - 1} y={PAD.t} width={Math.max(2, x(xs[recI]) - x(xs[cliffI]))} height={H - PAD.t - PAD.b} fill="#fdf3f1" />}
        {/* 다른 절벽 (옅게) */}
        {cliffs.filter((c) => c.index !== cliffI).map((c) => <line key={c.index} x1={x(xs[c.index])} x2={x(xs[c.index])} y1={PAD.t} y2={H - PAD.b} stroke="#e5503c" strokeOpacity="0.25" strokeDasharray="2 3" />)}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#e5e8eb" />
        <path d={path} fill="none" stroke="#191f28" strokeWidth="2.2" strokeLinejoin="round" />
        {/* 다음 절벽 */}
        {cliffI != null && <g>
          <line x1={x(xs[cliffI])} x2={x(xs[cliffI])} y1={PAD.t - 6} y2={H - PAD.b} stroke="#e5503c" strokeDasharray="4 3" />
          <text x={x(xs[cliffI]) > W - 110 ? x(xs[cliffI]) - 5 : x(xs[cliffI]) + 5} textAnchor={x(xs[cliffI]) > W - 110 ? "end" : "start"}
            y={PAD.t - 10} fontSize="12" fill="#e5503c" fontWeight="700">{manwon(cliff.income)}부터 감소</text>
        </g>}
        {/* 회복 */}
        {recI != null && <circle cx={x(xs[recI])} cy={y(ys[recI])} r="4" fill="#68ba83" />}
        {/* 비교 소득 */}
        {cmpI !== nowI && <circle cx={x(xs[cmpI])} cy={y(ys[cmpI])} r="5" fill="#fff" stroke="#191f28" strokeWidth="2" />}
        {/* 지금 */}
        <line x1={x(xs[nowI])} x2={x(xs[nowI])} y1={PAD.t} y2={H - PAD.b} stroke="#191f28" strokeOpacity="0.35" />
        <circle cx={x(xs[nowI])} cy={y(ys[nowI])} r="5" fill="#191f28" />
        <text x={Math.min(W - 30, x(xs[nowI]) + 7)} y={y(ys[nowI]) + 16} fontSize="12" fill="#191f28" fontWeight="700">지금</text>
        {/* 축 */}
        <text x={PAD.l} y={H - 4} fontSize="11" fill="#8b95a1">0원</text>
        <text x={W - PAD.r} y={H - 4} fontSize="11" fill="#8b95a1" textAnchor="end">{manwon(maxX)} 원</text>
      </svg>
      <figcaption className="chart-caption"><span>월급 + 혜택 (한 달 생활비)</span><span>월급 →</span></figcaption>
    </figure>
  );
}
