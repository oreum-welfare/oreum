import { useEffect, useRef, useState } from "react";
import { manwon } from "./data.js";

// 소득별 '월급 + 혜택' 선 그래프 (SVG). 꺾이는 곳(절벽)만 강조하고 나머지는 회색으로.
// 그림 폭을 실제 화면 폭에 맞춰서 휴대폰에서도 글자가 작아지지 않게 한다.
// 처음에는 '내 구간'(지금 소득 ~ 다음 절벽 ~ 회복)을 확대해 보여 주고, 버튼으로 0원부터 전체를 볼 수 있다.
const PAD = { l: 4, r: 4 }; // 위쪽 여백은 이름표 줄 수에 따라 정한다

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

// 그래프 위 이름표: 숫자 대신 바로 읽히는 말로 (지금 월급 · 감소 시작 · 회복)
const PIN = { now: "#191f28", cliff: "#e5503c", recover: "#3d9a5d" };
const PIN_H = 22, ROW = 28;
// 이름표 폭 (한글 12px 기준 대략)
const pinWidth = (t) => [...t].reduce((w, ch) => w + (ch === " " ? 4 : 12), 0) + 18;

// 확대할 구간: 볼 지점들(지금·절벽·회복·비교)을 모두 넣고 양옆에 여유. 전체의 80% 넘게 차지하면 확대하지 않는다
// stopBefore: 다음 절벽 소득. 오른쪽 끝을 그 앞에서 끊어 그래프에는 ①②③ 절벽만 보이게 한다 (다음 절벽은 글로 안내)
export function zoomRange(points, maxX, stopBefore = Infinity) {
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
  if (Number.isFinite(stopBefore) && x1 >= stopBefore) {
    // 다음 절벽 바로 앞까지만 (볼 지점보다는 오른쪽, 절벽과의 사이의 3/4 지점)
    x1 = Math.max(hi + (stopBefore - hi) * 0.75, hi);
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
  // 바로 다음 절벽: 확대 그림에서는 빼고, 가까우면 아래에 한 줄로 알린다 (숨기지 않음)
  const after = focus ? Math.max(focus.recover ?? focus.income, focus.income) : null;
  const next = focus ? cliffs.find((c) => c.income > after) : null;
  const nextDrop = next && next.index > 0 ? ys[next.index - 1] - ys[next.index] : 0;
  const zoom = focus ? zoomRange([inc, focus.income, focus.recover, cmp !== inc ? cmp : null], maxX, next?.income) : null;
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

  // 이름표 위치: 왼쪽부터 놓고, 앞 이름표와 겹치면 한 줄 아래로
  const pins = [
    { key: "now", text: "현재 월급", i: nowI, color: PIN.now },
    cliffI != null && { key: "cliff", text: "감소 시작", i: cliffI, color: PIN.cliff },
    recI != null && { key: "recover", text: "회복", i: recI, color: PIN.recover },
  ].filter((p) => p && inView(p.i)).map((p) => {
    const w = pinWidth(p.text), cx = x(xs[p.i]);
    return { ...p, w, cx, left: Math.min(W - w, Math.max(0, cx - w / 2)) };
  }).sort((a, b) => a.cx - b.cx);
  const rowEnd = [];
  for (const p of pins) {
    let r = rowEnd.findIndex((end) => p.left >= end + 6);
    if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
    rowEnd[r] = p.left + p.w;
    p.py = r * ROW;
  }
  const T = Math.max(1, rowEnd.length) * ROW + 26; // 이름표 아래, 세로축 이름 자리까지 띄우고 그래프 시작
  const H = T + PLOT_H + 24;
  const BASE = T + PLOT_H; // 가로축 위치
  const y = (v) => T + (1 - (v - (minY - pad)) / (maxY + pad - (minY - pad))) * PLOT_H;
  const path = xs.slice(i0, i1 + 1).map((v, k) => `${k ? "L" : "M"}${x(v).toFixed(1)},${y(ys[i0 + k]).toFixed(1)}`).join("");

  const label = `월 ${manwon(inc)} 원일 때 월급과 혜택을 합친 돈은 ${manwon(ys[nowI])} 원` +
    (focus ? `. 월 ${manwon(focus.income)} 원부터 생활비가 ${drop > 0 ? `${manwon(drop)} 원 ` : ""}줄고` + (focus.recover != null ? `, 월 ${manwon(focus.recover)} 원에서 줄기 전 수준을 되찾아요` : "") : "");
  return (
    <figure className="chart" ref={ref} style={{ margin: "28px 0 0" }}>
      <div className="chart-head">
        <h2 className="chart-title">소득에 따른 생활비 변화</h2>
        {zoom && <button type="button" className="link-btn" onClick={() => setFull((f) => !f)} aria-pressed={full}>{full ? "내 구간 크게 보기" : "전체 보기 →"}</button>}
      </div>
      <p className="chart-sub">생활비 = 월급 + 받는 혜택</p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        {/* 생활비가 줄어든 구간 */}
        {cliffI != null && recI != null && inView(cliffI) && <rect x={x(xs[cliffI]) - 1} y={T} width={Math.max(2, x(xs[Math.min(recI, i1)]) - x(xs[cliffI]))} height={BASE - T} fill="#fdf3f1" />}
        {/* 다른 절벽 (옅게) */}
        {cliffs.filter((c) => c.index !== cliffI && inView(c.index)).map((c) => <line key={c.index} x1={x(xs[c.index])} x2={x(xs[c.index])} y1={T} y2={BASE} stroke="#e5503c" strokeOpacity="0.25" strokeDasharray="2 3" />)}
        {/* 축: 세로 = 생활비, 가로 = 월급 */}
        <line x1={PAD.l} x2={PAD.l} y1={T - 6} y2={BASE} stroke="#d1d6db" />
        <line x1={PAD.l} x2={W - PAD.r} y1={BASE} y2={BASE} stroke="#d1d6db" />
        <text x={PAD.l + 6} y={T - 10} fontSize="11" fontWeight="600" fill="#6b7684">↑ 생활비 (월급+혜택)</text>
        <text x={PAD.l + 6} y={y(maxY) - 4} fontSize="10" fill="#b0b8c1">{manwon(maxY)} 원</text>
        <text x={PAD.l + 6} y={y(minY) + 12} fontSize="10" fill="#b0b8c1">{manwon(minY)} 원</text>
        <path d={path} fill="none" stroke="#191f28" strokeWidth="2.4" strokeLinejoin="round" />
        {/* 줄어드는 금액 */}
        {drop > 0 && inView(cliffI) && (
          <text x={Math.min(W - PAD.r - 2, x(xs[cliffI]) + 8)} y={y(ys[cliffI]) + 18} fontSize="12" fontWeight="700" fill={PIN.cliff}
            textAnchor={x(xs[cliffI]) > W - 90 ? "end" : "start"}>−{manwon(drop)} 원</text>
        )}
        {/* 비교 소득 (옅게: 핵심은 현재와 감소 시작) */}
        {cmpI !== nowI && inView(cmpI) && <circle cx={x(xs[cmpI])} cy={y(ys[cmpI])} r="4.5" fill="#fff" stroke="#8b95a1" strokeWidth="1.6" />}
        {/* 이름표: 세로선 + 그래프 위 점 + 위쪽 이름표 */}
        {pins.map((p) => (
          <g key={p.key}>
            <line x1={p.cx} x2={p.cx} y1={p.py + PIN_H} y2={BASE} stroke={p.color} strokeWidth="1.4" strokeDasharray={p.key === "now" ? "" : "4 3"} strokeOpacity={p.key === "now" ? 0.45 : 0.9} />
            <circle cx={p.cx} cy={y(ys[p.i])} r="5" fill={p.color} stroke="#fff" strokeWidth="1.5" />
          </g>
        ))}
        {pins.map((p) => (
          <g key={`pin-${p.key}`}>
            <rect x={p.left} y={p.py} width={p.w} height={PIN_H} rx={PIN_H / 2} fill={p.color} />
            <text x={p.left + p.w / 2} y={p.py + 15} fontSize="12" fontWeight="700" fill="#fff" textAnchor="middle">{p.text}</text>
          </g>
        ))}
        {/* 가로축 */}
        <text x={PAD.l} y={BASE + 16} fontSize="11" fill="#8b95a1">{x0 > 0 ? `${manwon(x0)} 원` : "0원"}</text>
        <text x={W - PAD.r} y={BASE + 16} fontSize="11" fill="#8b95a1" textAnchor="end">{manwon(x1)} 원</text>
        <text x={W / 2} y={BASE + 16} fontSize="11" fontWeight="600" fill="#6b7684" textAnchor="middle">월급 →</text>
      </svg>

    </figure>
  );
}

// 주요 변화 지점: 그래프의 이름표(현재 월급·감소 시작·회복)를 짧은 정보 행으로. 결과 화면 오른쪽 요약 아래에 둔다
export function ChangePoints({ sim, inc, cmp, cliffs, focus, curLoss }) {
  const xs = sim.incomes, ys = sim.disposable;
  const maxX = xs[xs.length - 1] || 1;
  const at = (v) => Math.min(xs.length - 1, Math.max(0, Math.round((v / maxX) * (xs.length - 1))));
  const nowI = at(inc), cmpI = at(cmp);
  const cliffI = focus ? at(focus.income) : null;
  const drop = cliffI != null && cliffI > 0 ? ys[cliffI - 1] - ys[cliffI] : 0;
  const after = focus ? Math.max(focus.recover ?? focus.income, focus.income) : null;
  const next = focus ? cliffs.find((c) => c.income > after) : null;
  const nextDrop = next && next.index > 0 ? ys[next.index - 1] - ys[next.index] : 0;
  const nearNext = next && nextDrop > 0 && next.income - after <= maxX * 0.25;
  const rows = [
    { key: "now", at: inc, el: <li key="now"><i style={{ background: PIN.now }} /><b>현재 월급</b><span>월 {manwon(inc)} 원 · 생활비 {manwon(ys[nowI])} 원{curLoss ? <> · <em className="bad">줄기 전보다 {manwon(curLoss.shortfall)} 원 적어요</em></> : null}</span></li> },
    focus && { key: "cliff", at: focus.income, el: <li key="cliff"><i style={{ background: PIN.cliff }} /><b>감소 시작</b><span>월 {manwon(focus.income)} 원 · 생활비 <em className="bad">{drop > 0 ? `${manwon(drop)} 원 ` : ""}감소</em></span></li> },
    focus?.recover != null && { key: "rec", at: focus.recover, el: <li key="rec"><i style={{ background: PIN.recover }} /><b>회복</b><span>월 {manwon(focus.recover)} 원 · 줄기 전만큼 돌아와요</span></li> },
  ].filter(Boolean).sort((a, b) => a.at - b.at);
  return (
    <section className="chart-points" aria-label="주요 변화 지점">
      <p className="cp-title">주요 변화 지점</p>
      <ul>{rows.map((r) => r.el)}</ul>
      {!focus && <p className="cp-calm">앞으로 생활비가 줄어드는 구간은 없어요. 소득이 늘수록 생활비도 늘어나요.</p>}
      {focus && focus.recover == null && <p className="cp-calm">계산 범위 안에서는 줄기 전만큼 돌아오지 않아요.</p>}
      {(cmpI !== nowI || nearNext) && <>
        <p className="cp-title sub">추가 비교</p>
        <ul className="cp-extra">
          {cmpI !== nowI && <li><i className="hollow" />비교 소득 월 {manwon(cmp)} 원 · 생활비 {manwon(ys[cmpI])} 원</li>}
          {nearNext && <li><i className="dash" />그다음 월 {manwon(next.income)} 원에서 한 번 더 {manwon(nextDrop)} 원 줄어요</li>}
        </ul>
      </>}
    </section>
  );
}
