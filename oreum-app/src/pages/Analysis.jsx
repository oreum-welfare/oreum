import { useMemo, useState } from "react";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { createEngine } from "../lib/engine.js";
import { man, pct, won } from "../lib/format.js";
import { useJson } from "../lib/useJson.js";
import { taperSimulation } from "../lib/policy.js";
import { PageHead } from "../components/ui.jsx";

const STEP = 10000;
const EXTRA = 100000;
const TYPE_COLORS = ["#3b5bdb", "#748ffc", "#15aabf", "#fa5252", "#fd7e14", "#2b8a3e"];
const SNAKE = { spouse_65: "spouse65", dual_earner: "dualEarner", birth_order: "birthOrder", single_parent: "singleParent", third_child_7to18: "thirdChild7to18", residence_months: "residenceMonths", severe_disabled: "severeDisabled" };
const BASE = { age: 40, spouse: false, spouse65: false, dualEarner: false, infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1, disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60 };

function toHh(snake, region) {
  const hh = { ...BASE, region };
  for (const [k, v] of Object.entries(snake)) hh[SNAKE[k] ?? k] = v;
  return hh;
}

function runAll(data, engine) {
  const regions = Object.keys(data.regions);
  const cases = [];
  for (const t of data.analysis_households) {
    for (const region of regions) {
      const hh = toHh(t.hh, region);
      const m = engine.medianIncome(engine.derive(hh).size);
      const sim = engine.simulate(hh, Math.round(m / STEP) * STEP, STEP, true);
      const cliffs = engine.findCliffs(sim).map((c) => ({ ...c, pct: (c.income / m) * 100 }));
      const endings = [];
      for (let i = 1; i < sim.incomes.length; i++) {
        for (const name of sim.elig[i - 1]) if (!sim.elig[i].has(name)) endings.push({ name, pct: (sim.incomes[i] / m) * 100 });
      }
      const k = EXTRA / STEP;
      const retained = sim.incomes.slice(0, -k).map((_, i) => sim.disposable[i + k] - sim.disposable[i]);
      cases.push({ type: t, region, size: engine.derive(hh).size, m, sim, cliffs, endings, retained,
        maxCliff: cliffs.reduce((a, c) => (!a || c.drop > a.drop ? c : a), null),
        worst: Math.min(...retained), lossZones: retained.filter((r) => r < 0).length });
    }
  }
  return { regions, cases };
}

function Findings({ all }) {
  const { regions, cases } = all;
  const top = cases.filter((c) => c.maxCliff).sort((a, b) => b.maxCliff.drop - a.maxCliff.drop)[0];
  const ends = cases.flatMap((c) => c.endings);
  let win = { from: 0, count: 0 };
  for (let from = 0; from <= 90; from++) {
    const count = ends.filter((e) => e.pct > from && e.pct <= from + 10).length;
    if (count > win.count) win = { from, count };
  }
  const byRegion = regions.map((r) => {
    const cs = cases.filter((c) => c.region === r && c.maxCliff);
    return { r, cnt: cases.filter((c) => c.region === r).reduce((s, c) => s + c.cliffs.length, 0),
      avg: cs.length ? cs.reduce((s, c) => s + c.maxCliff.drop, 0) / cs.length : 0 };
  });
  const policy = cases.reduce((acc, c) => {
    const r = taperSimulation(c.sim, c.m, 10);
    return { after: acc.after + r.cliffs.length, max: Math.max(acc.max, ...r.cliffs.map((x) => x.drop)) };
  }, { after: 0, max: 0 });
  const totalCliffs = cases.reduce((s, c) => s + c.cliffs.length, 0);
  const share = ends.length ? Math.round((win.count / ends.length) * 100) : 0;
  return (
    <>
    <div className="stats">
      {top && <div className="stat accent"><div className="label">가장 큰 절벽</div><div className="value">{man(top.maxCliff.drop)}<small>원</small></div><div className="stat-sub">{top.type.label} · 월 {man(top.maxCliff.income)}원</div></div>}
      <div className="stat"><div className="label">혜택이 몰려 끊기는 구간</div><div className="value">{win.from}~{win.from + 10}<small>%</small></div><div className="stat-sub">끊기는 지점의 {share}% (기준중위소득 대비)</div></div>
      <div className="stat"><div className="label">더 벌어도 손해인 경우</div><div className="value">{cases.filter((c) => c.lossZones > 0).length}<small>/ {cases.length}</small></div><div className="stat-sub">10만 원 더 벌면 손해인 구간이 있는 경우</div></div>
      <div className="stat"><div className="label">제도 개선 시 절벽</div><div className="value">{totalCliffs}→{policy.after}<small>개</small></div><div className="stat-sub">혜택을 중위 10%p에 걸쳐 서서히 줄이면</div></div>
    </div>
    <section className="card"><h2 className="card-title">핵심 발견</h2>
    <ol className="findings">
      {top && <li><b>가장 큰 절벽은 {top.type.label}({top.region})</b>입니다. 월 소득이 {won(top.maxCliff.income)}(중위소득 {pct(top.maxCliff.pct)})이 되는 순간 <span className="big">{won(top.maxCliff.drop)}</span>을 잃습니다. 사라지는 혜택: {top.maxCliff.lost.join(", ") || "금액 감소"}.</li>}
      {ends.length > 0 && <li>혜택이 끊기는 지점 {ends.length}개 중 <b>{Math.round((win.count / ends.length) * 100)}%({win.count}개)가 근로소득 기준 중위소득 {win.from}~{win.from + 10}% 구간</b>에 몰려 있습니다. (근로소득공제 때문에 소득인정액 기준으로는 그보다 낮은 구간입니다.)</li>}
      <li>12가지 경우 중 <b>{cases.filter((c) => c.lossZones > 0).length}가지</b>에서 '10만 원을 더 벌어도 오히려 손해'인 소득 구간이 있습니다.</li>
      <li><b>제도 개선 효과:</b> 수급 자격에 묶인 혜택을 기준선에서 한 번에 끊지 않고 중위소득 10%p 구간에서 서서히 줄이면, 절벽이 {cases.reduce((s, c) => s + c.cliffs.length, 0)}개에서 <b>{policy.after}개</b>로, 가장 큰 손해가 {won(top?.maxCliff.drop ?? 0)}에서 <b>{won(policy.max)}</b>으로 줄어듭니다 (⑤).</li>
      <li>지역별 비교: {byRegion.map((x, i) => <span key={x.r}>{i > 0 && " · "}<b>{x.r}</b> 절벽 {x.cnt}개, 가장 큰 절벽 평균 {won(x.avg)}</span>)}.</li>
    </ol>
    </section>
    </>
  );
}

const WIDTHS = [5, 10, 15];

function PolicySection({ all, data }) {
  const [width, setWidth] = useState(10);
  const [pType, setPType] = useState("single_parent");
  const [pRegion, setPRegion] = useState("경상북도 경산시");
  const rows = useMemo(() => all.cases.map((c) => ({ c, r: taperSimulation(c.sim, c.m, width) })), [all, width]);
  const before = rows.reduce((s, x) => s + x.c.cliffs.length, 0);
  const after = rows.reduce((s, x) => s + x.r.cliffs.length, 0);
  const maxBefore = Math.max(...rows.map((x) => x.c.maxCliff?.drop ?? 0));
  const maxAfter = Math.max(0, ...rows.flatMap((x) => x.r.cliffs.map((c) => c.drop)));
  const sel = rows.find((x) => x.c.type.key === pType && x.c.region === pRegion);
  const labels = sel.c.sim.incomes;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">⑤ 제도 개선 시뮬레이션: 혜택을 한 번에 끊지 않고 서서히 줄이면</h2>
        <div className="controls">
          <label className="field-inline small">점감 폭 <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {WIDTHS.map((w) => <option key={w} value={w}>중위소득 {w}%p</option>)}</select></label>
        </div>
      </div>
      <p className="hint">가상 시나리오: 혜택이 끊기는 기준선 위로 소득인정액 기준 중위소득 {width}%p 구간을 두고, 그 안에서 혜택을 0원까지 직선으로 줄입니다. 실제 제도가 아니라 제도 개선 효과를 보여 주기 위한 계산입니다.</p>
      <div className="stats compact">
        <div className="stat"><div className="label">절벽 수 (12가지 경우 합계)</div><div className="value">{before} → <span style={{ color: after < before ? "var(--ok)" : "var(--cliff)" }}>{after}</span><small>개</small></div></div>
        <div className="stat"><div className="label">가장 큰 손해</div><div className="value">{man(maxBefore)} → <span style={{ color: "var(--ok)" }}>{man(maxAfter)}</span><small>원</small></div></div>
        <div className="stat"><div className="label">점감 구간 폭 (근로소득)</div><div className="value">{man(sel.r.widthEarned)}<small>원</small></div><div className="stat-sub">{sel.c.type.label} 기준</div></div>
        <div className="stat"><div className="label">점감 구간 추가 지원 (평균)</div><div className="value">{man(sel.r.extraAvg)}<small>원/월</small></div><div className="stat-sub">그 구간에 있는 가구만</div></div>
      </div>
      <div className="card-head" style={{ marginTop: 16 }}>
        <h3 className="card-title" style={{ margin: 0 }}>현행 vs 점감</h3>
        <div className="controls">
          <label className="field-inline small">가구 <select value={pType} onChange={(e) => setPType(e.target.value)}>{data.analysis_households.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label className="field-inline small">지역 <select value={pRegion} onChange={(e) => setPRegion(e.target.value)}>{all.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
        </div>
      </div>
      <div className="chart-box short"><Line data={{ labels, datasets: [
        { label: "현행: 근로소득 + 혜택", data: sel.c.sim.disposable, borderColor: "#e03131", borderWidth: 2, pointRadius: 0 },
        { label: `점감 ${width}%p: 근로소득 + 혜택`, data: sel.r.disposable, borderColor: "#2b8a3e", borderWidth: 2, pointRadius: 0 },
      ] }} options={{ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
        scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (_v, i) => (labels[i] % 500000 === 0 ? man(labels[i]) : null) } }, y: { ticks: { callback: (v) => man(v) } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: (its) => `월 근로소득 ${won(labels[its[0].dataIndex])}`, label: (it) => ` ${it.dataset.label}: ${won(it.raw)}` } } } }} /></div>
      <div className="table-wrap"><table>
        <thead><tr><th>가구 유형</th><th>지역</th><th style={{ textAlign: "right" }}>절벽 수</th><th style={{ textAlign: "right" }}>가장 큰 손해</th><th style={{ textAlign: "right" }}>점감 구간 추가 지원 (평균)</th></tr></thead>
        <tbody>{rows.map(({ c, r }, i) => {
          const start = i === 0 || rows[i - 1].c.type.key !== c.type.key;
          const ma = Math.max(0, ...r.cliffs.map((x) => x.drop));
          return (
            <tr key={c.type.key + c.region} className={start ? "group-start" : ""}>
              <td>{start && <b>{c.type.label}</b>}</td><td>{c.region}</td>
              <td className="num">{c.cliffs.length} → {r.cliffs.length}</td>
              <td className="num">{c.maxCliff ? won(c.maxCliff.drop) : "-"} → {r.cliffs.length ? won(ma) : "없음"}</td>
              <td className="num">{won(r.extraAvg)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="stat-inline"><b>정책 제안:</b> 수급 자격에 묶인 정액·감면 혜택(교육급여, 에너지바우처, 통신비, 문화누리카드, 의료급여, 아동양육비 등)을 기준선에서 한 번에 끊지 않고 일정 구간에서 서서히 줄이면,
        큰 절벽은 대부분 사라지고 몇천 원 수준의 작은 감소만 남습니다. 남는 감소는 여러 혜택이 같은 구간에서 함께 줄어들기 때문이며, 점감 폭이 너무 좁으면({WIDTHS[0]}%p) 오히려 작은 절벽이 늘어납니다.</p>
    </section>
  );
}

function Summary({ cases }) {
  const maxDrop = Math.max(...cases.map((c) => c.maxCliff?.drop ?? 0));
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>가구 유형</th><th>지역</th><th style={{ textAlign: "right" }}>절벽 수</th><th style={{ textAlign: "right" }}>첫 절벽</th>
        <th style={{ textAlign: "right" }}>가장 큰 손해</th><th style={{ textAlign: "right" }}>그 위치</th><th>그때 사라지는 혜택</th><th style={{ textAlign: "right" }}>10만 원 더 벌 때 최악</th></tr></thead>
      <tbody>{cases.map((c, i) => {
        const start = i === 0 || cases[i - 1].type.key !== c.type.key;
        const first = c.cliffs[0], mc = c.maxCliff;
        return (
          <tr key={c.type.key + c.region} className={start ? "group-start" : ""}>
            <td>{start && <><b>{c.type.label}</b> <span className="hint">({c.size}인)</span></>}</td>
            <td>{c.region}</td>
            <td className="num">{c.cliffs.length}</td>
            <td className="num">{first ? <>{man(first.income)}원 <span className="hint">({pct(first.pct)})</span></> : "-"}</td>
            <td className={`num ${mc && mc.drop === maxDrop ? "best" : ""}`}>{mc ? `−${won(mc.drop)}` : "-"}</td>
            <td className="num">{mc ? <>{man(mc.income)}원 <span className="hint">({pct(mc.pct)})</span></> : "-"}</td>
            <td>{mc ? mc.lost.join(", ") || "금액 감소" : "-"}</td>
            <td className="num" style={c.worst < 0 ? { color: "var(--cliff)" } : undefined}>{c.worst < 0 ? `−${won(-c.worst)}` : `+${won(c.worst)}`}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

export default function Analysis() {
  const { data, error } = useJson("/data/rules.json");
  const all = useMemo(() => (data ? runAll(data, createEngine(data)) : null), [data]);
  const [curveRegion, setCurveRegion] = useState("경상북도 경산시");
  const [emtrType, setEmtrType] = useState("single_parent");
  const [emtrRegion, setEmtrRegion] = useState("경상북도 경산시");

  if (error) return <main className="page"><p className="empty">데이터를 불러오지 못했습니다: {String(error.message)}</p></main>;
  if (!all) return <main className="page"><p className="empty">분석 중…</p></main>;

  const curveCases = all.cases.filter((c) => c.region === curveRegion);
  const curveData = { datasets: curveCases.map((c, i) => ({
    label: c.type.label, showLine: true, pointRadius: 0, borderWidth: 2,
    borderColor: TYPE_COLORS[i], backgroundColor: TYPE_COLORS[i],
    data: c.sim.incomes.map((inc, j) => ({ x: (inc / c.m) * 100, y: (c.sim.disposable[j] / c.m) * 100 })),
  })) };

  const buckets = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, to: i * 5 + 5, count: 0, names: {} }));
  for (const e of all.cases.flatMap((c) => c.endings)) {
    const b = buckets[Math.min(19, Math.max(0, Math.ceil(e.pct / 5) - 1))];
    b.count++; b.names[e.name] = (b.names[e.name] || 0) + 1;
  }
  const maxB = Math.max(...buckets.map((b) => b.count));

  const ec = all.cases.find((c) => c.type.key === emtrType && c.region === emtrRegion);
  const eLabels = ec.sim.incomes.slice(0, ec.retained.length);
  const avg = ec.retained.reduce((s, r) => s + r, 0) / ec.retained.length;
  const worstIdx = ec.retained.indexOf(ec.worst);

  return (
    <>
      <main className="page">
        <PageHead title={<>복지 절벽은 <em>누구에게, 어디서</em> 나타날까?</>}
          desc="대표 가구 6개 × 지역 2곳, 12가지 경우를 소득 0원부터 기준중위소득 100%까지 1만 원 단위로 계산했어요." />
        <Findings all={all} />
        {data.provisional?.length > 0 && <div className="notice">일부 금액({data.provisional.length}개 항목)이 추정값이에요. 금액이 바뀌면 아래 결과도 함께 바뀌어요.</div>}
        <section className="card">
          <h2 className="card-title">① 가구 유형 × 지역별 절벽 요약</h2>
          <p className="hint">절벽 = 소득이 1만 원 늘었는데 '근로소득 + 혜택' 합계가 줄어드는 지점.</p>
          <Summary cases={all.cases} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">② 가구 유형별 '근로소득 + 혜택' 곡선</h2>
            <label className="field-inline small">지역 <select value={curveRegion} onChange={(e) => setCurveRegion(e.target.value)}>{all.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          <p className="hint">가로·세로 모두 <b>기준중위소득 대비 %</b>로 바꿔 겹쳐 그렸습니다. 선이 아래로 꺾이는 곳이 절벽입니다.</p>
          <div className="chart-box"><Scatter data={curveData} options={{
            responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", intersect: false },
            scales: { x: { min: 0, max: 100, title: { display: true, text: "월 근로소득 (기준중위소득 대비 %)" }, ticks: { callback: (v) => `${v}%` } },
              y: { min: 0, title: { display: true, text: "근로소득 + 혜택 (중위소득 대비 %)" }, ticks: { callback: (v) => `${v}%` } } },
            plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: 근로소득 ${it.parsed.x.toFixed(0)}% → 합계 ${it.parsed.y.toFixed(0)}%` } } },
          }} /></div>
        </section>
        <section className="card">
          <h2 className="card-title">③ 혜택이 끊기는 소득 구간 분포</h2>
          <p className="hint">12가지 경우에서 각 혜택의 자격이 사라지는 지점을 모아 기준중위소득 대비 5% 구간별로 세었습니다.</p>
          <div className="chart-box short"><Bar data={{ labels: buckets.map((b) => `${b.from}~${b.to}%`), datasets: [{ label: "혜택이 끊기는 횟수", data: buckets.map((b) => b.count), borderRadius: 4,
            backgroundColor: buckets.map((b) => (b.count === maxB ? "#fa5252" : b.count >= maxB * 0.5 ? "#ffa8a8" : "#c5cef5")), borderRadius: 6 }] }}
            options={{ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
              scales: { x: { title: { display: true, text: "월 근로소득 (기준중위소득 대비)" }, ticks: { maxRotation: 0 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }} /></div>
          <div className="table-wrap"><table><thead><tr><th>구간</th><th style={{ textAlign: "right" }}>횟수</th><th>끊기는 혜택 (횟수)</th></tr></thead>
            <tbody>{buckets.filter((b) => b.count).map((b) => (
              <tr key={b.from}><td>{b.from}~{b.to}%</td><td className="num">{b.count}</td>
                <td>{Object.entries(b.names).sort((a, c) => c[1] - a[1]).map(([n, k]) => `${n} ${k}`).join(", ")}</td></tr>
            ))}</tbody></table></div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">④ 10만 원 더 벌면 실제로 얼마가 남나</h2>
            <div className="controls">
              <label className="field-inline small">가구 <select value={emtrType} onChange={(e) => setEmtrType(e.target.value)}>{data.analysis_households.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label className="field-inline small">지역 <select value={emtrRegion} onChange={(e) => setEmtrRegion(e.target.value)}>{all.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
            </div>
          </div>
          <p className="hint">10만 원보다 적으면 일부를 잃는 것이고, <b style={{ color: "var(--cliff)" }}>0원 아래면 오히려 손해</b>입니다.</p>
          <div className="chart-box short"><Line data={{ labels: eLabels, datasets: [
            { label: "10만 원 더 벌 때 늘어나는 금액", data: ec.retained, borderWidth: 2, pointRadius: 0, borderColor: "#3b5bdb",
              segment: { borderColor: (ctx) => (ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0 ? "#e03131" : "#3b5bdb") } },
            { label: "기준선: 10만 원 그대로", data: eLabels.map(() => EXTRA), borderColor: "#adb5bd", borderDash: [5, 4], borderWidth: 1, pointRadius: 0 },
            { label: "0원", data: eLabels.map(() => 0), borderColor: "#ffc9c9", borderWidth: 1, pointRadius: 0 },
          ] }} options={{ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
            scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (_v, i) => (eLabels[i] % 500000 === 0 ? man(eLabels[i]) : null) } }, y: { ticks: { callback: (v) => man(v) } } },
            plugins: { legend: { position: "bottom" }, tooltip: { filter: (it) => it.datasetIndex === 0, callbacks: { title: (its) => `월 근로소득 ${won(eLabels[its[0].dataIndex])} → +10만 원`, label: (it) => ` 늘어나는 금액: ${won(it.raw)}` } } } }} /></div>
          <p className="stat-inline">평균적으로 10만 원을 더 벌면 <b>{won(avg)}</b>이 늘어납니다. {ec.worst < 0
            ? <>가장 나쁜 구간은 월 <b>{won(eLabels[worstIdx])}</b>에서 10만 원을 더 벌 때로, 오히려 <b style={{ color: "var(--cliff)" }}>{won(-ec.worst)}</b>이 줄어듭니다.</>
            : <>이 가구에는 손해 구간이 없습니다.</>}</p>
        </section>
        <PolicySection all={all} data={data} />
        <section className="card">
          <h2 className="card-title">분석 방법과 한계</h2>
          <div className="method-grid">
            <div><h3>방법</h3><ol>
              <li>복지로 선정기준 원문을 판정 규칙으로 변환 (<code>rules.json</code>)</li>
              <li>가구 유형 6개 × 지역 2곳 = 12가지 경우 설정</li>
              <li>소득 0원 ~ 기준중위소득 100%, 1만 원 단위로 받는 혜택 계산</li>
              <li>'근로소득 + 혜택'이 1,000원 이상 줄어드는 지점을 절벽으로 기록</li>
              <li>같은 계산을 파이썬(<code>analysis/cliff_analysis.py</code>)으로도 실행해 결과 일치 확인</li>
            </ol></div>
            <div><h3>한계</h3><ul>{[...data.assumptions, "가구 유형 6개는 대표 사례이며 모든 가구를 대표하지 않습니다.", "지역은 대구 북구와 경산시 2곳만 분석했습니다."].map((a) => <li key={a}>{a}</li>)}</ul></div>
          </div>
        </section>
      </main>
    </>
  );
}
