import { useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { createEngine, KIND_LABEL } from "../lib/engine.js";
import { vlinePlugin } from "../lib/chartSetup.js";
import { man, won } from "../lib/format.js";
import { useJson } from "../lib/useJson.js";

const STEP = 10000;
export const COLORS = {
  saeng: "#4c6ef5", medical: "#15aabf", jugeo: "#fab005", edu: "#12b886", energy: "#fd7e14",
  telecom: "#be4bdb", eitc: "#82c91e", ctc: "#20c997", basic_pension: "#7950f2",
  gs_birth: "#e64980", gs_clinic: "#74c0fc", bk_nhis: "#ffa8a8", gs_multichild: "#f783ac", sp_child: "#38d9a9", munhwa: "#ffa94d", dis_pension: "#9775fa",
};
export const NAMES = {
  saeng: "생계급여", medical: "의료급여", jugeo: "주거급여", edu: "교육급여", energy: "에너지바우처",
  telecom: "이동통신요금 감면", eitc: "근로장려금", ctc: "자녀장려금", basic_pension: "기초연금",
  gs_birth: "출산장려금", gs_clinic: "65세 이상 진료비 감면", bk_nhis: "건강보험료지원", gs_multichild: "다자녀가정 지원", sp_child: "한부모 아동양육비", munhwa: "문화누리카드", dis_pension: "장애인연금",
};
const ORDER = Object.keys(COLORS);

const DEFAULT_HH = {
  region: "경상북도 경산시", age: 40, spouse: false, spouse65: false, dualEarner: false,
  infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1,
  disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60,
};
const PRESETS = [
  { key: "single-parent", emoji: "👩‍👧‍👦", title: "한부모 + 자녀 2명", sub: "경산 · 초·중학생", income: 3000000,
    hh: { region: "경상북도 경산시", age: 38, singleParent: true, elem: 1, middle: 1 } },
  { key: "youth", emoji: "🧑", title: "1인 청년", sub: "경산 · 29세", income: 1000000, hh: { region: "경상북도 경산시", age: 29 } },
  { key: "senior", emoji: "👵", title: "어르신 단독", sub: "대구 북구 · 70세", income: 600000, hh: { region: "대구광역시 북구", age: 70 } },
  { key: "family", emoji: "👨‍👩‍👧‍👦", title: "4인 가구", sub: "경산 · 영유아+초등", income: 2500000,
    hh: { region: "경상북도 경산시", age: 36, spouse: true, infants: 1, elem: 1 } },
];

export function chartOptions(incomes, linesRef, { stacked = false } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0 } },
    scales: {
      x: { stacked, grid: { display: false },
        ticks: { autoSkip: false, maxRotation: 0, color: "#868e96", callback: (_v, i) => (incomes[i] % 500000 === 0 ? man(incomes[i]) : null) } },
      y: { stacked, beginAtZero: true, grid: { color: "#f1f3f5" }, ticks: { color: "#868e96", callback: (v) => man(v) } },
    },
    plugins: {
      vlines: { ref: linesRef },
      legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
      tooltip: {
        filter: (item) => item.raw > 0,
        callbacks: {
          title: (items) => `월 근로소득 ${won(incomes[items[0].dataIndex])}`,
          label: (item) => ` ${item.dataset.label}: ${won(item.raw)}`,
        },
      },
    },
  };
}

function HouseholdForm({ hh, setHh, includeInkind, setIncludeInkind, regions, onEdit }) {
  const set = (k, v) => { onEdit(); setHh((h) => {
    const n = { ...h, [k]: v };
    if (k === "spouse" && !v) { n.spouse65 = false; n.dualEarner = false; }
    if (k === "newborn" && v && n.infants === 0) n.infants = 1;
    return n;
  }); };
  const num = (k) => (e) => set(k, Math.max(0, Number(e.target.value) || 0));
  const chk = (k) => (e) => set(k, e.target.checked);
  return (
    <div className="card">
      <h2 className="card-title">우리 가구 정보</h2>
      <label className="field"><span>거주 지역</span>
        <select value={hh.region} onChange={(e) => set("region", e.target.value)}>
          {regions.map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <label className="field"><span>본인 나이</span>
        <input type="number" min="19" max="100" value={hh.age} onChange={(e) => set("age", Number(e.target.value) || 40)} />
      </label>
      <div className="checks">
        <label><input type="checkbox" checked={hh.spouse} onChange={chk("spouse")} /> 배우자 있음</label>
        <label className={`sub ${hh.spouse ? "" : "disabled"}`}><input type="checkbox" disabled={!hh.spouse} checked={hh.spouse65} onChange={chk("spouse65")} /> 배우자도 65세 이상</label>
        <label className={`sub ${hh.spouse ? "" : "disabled"}`}><input type="checkbox" disabled={!hh.spouse} checked={hh.dualEarner} onChange={chk("dualEarner")} /> 맞벌이 (배우자 연 300만 원 이상)</label>
      </div>
      <fieldset className="kids">
        <legend>자녀 수</legend>
        {[["infants", "영유아 (0~6세)"], ["elem", "초등학생"], ["middle", "중학생"], ["high", "고등학생"]].map(([k, label]) => (
          <label key={k}><span>{label}</span><input type="number" min="0" max="5" value={hh[k]} onChange={num(k)} /></label>
        ))}
      </fieldset>
      <div className="checks">
        <label><input type="checkbox" checked={hh.newborn} onChange={chk("newborn")} /> 올해 태어난 아이 있음</label>
        {hh.newborn && (
          <label className="sub field-inline">출생 순위
            <select value={hh.birthOrder} onChange={(e) => set("birthOrder", Number(e.target.value))}>
              <option value="1">첫째</option><option value="2">둘째</option><option value="3">셋째</option><option value="4">넷째 이상</option>
            </select>
          </label>
        )}
        <label><input type="checkbox" checked={hh.disabled} onChange={chk("disabled")} /> 장애인 가구원 있음</label>
        <label className="sub"><input type="checkbox" checked={hh.severeDisabled} onChange={chk("severeDisabled")} /> 본인이 심한 장애 (장애인연금, 18~64세)</label>
        <label><input type="checkbox" checked={hh.singleParent} onChange={chk("singleParent")} /> 한부모 가구</label>
        <label><input type="checkbox" checked={hh.thirdChild7to18} onChange={chk("thirdChild7to18")} /> 셋째 이상 자녀 (7~18세) 있음</label>
      </div>
      <label className="field"><span>현 거주지 거주 기간 (개월)</span>
        <input type="number" min="0" max="600" value={hh.residenceMonths} onChange={num("residenceMonths")} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={includeInkind} onChange={(e) => setIncludeInkind(e.target.checked)} />
        <span>감면·현물 혜택도 금액으로 환산</span>
      </label>
      <p className="hint">의료급여, 에너지바우처, 통신비 감면 등을 월 금액으로 바꿔 합계에 넣습니다.</p>
    </div>
  );
}

function NextCliff({ income, cliffs }) {
  const next = cliffs.find((c) => c.income > income);
  if (!next) {
    return (
      <div className="alert ok"><div className="icon">✅</div><div>
        <h3>이 소득 이후로는 절벽이 없습니다</h3><p>소득이 늘면 쓸 수 있는 돈도 함께 늘어납니다.</p>
      </div></div>
    );
  }
  return (
    <div className="alert cliff"><div className="icon">🧗</div><div>
      <h3>월 소득이 {won(next.income)}이 되면 {won(next.drop)} 손해</h3>
      <p>지금보다 <b>{man(next.income - income)}원</b> 더 벌면, 아래 혜택이 끊겨 근로소득과 혜택을 더한 금액이 오히려 줄어듭니다.</p>
      <div>{(next.lost.length ? next.lost : ["혜택 금액 감소"]).map((n) => <span key={n} className="chip">{n}</span>)}</div>
    </div></div>
  );
}

function BenefitTable({ benefits }) {
  if (!benefits.length) return <p className="empty">이 소득에서 받을 수 있는 혜택이 없습니다.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>혜택</th><th>종류</th><th style={{ textAlign: "right" }}>월 환산액</th><th>근거</th></tr></thead>
      <tbody>{benefits.map((b) => (
        <tr key={b.id}>
          <td><b>{b.name}</b> <span className={`tag ${b.level === "중앙" ? "central" : "local"}`}>{b.level}</span></td>
          <td>{KIND_LABEL[b.kind]}</td>
          <td className="num">{b.kind === "access" ? "자격" : won(b.monthly)}</td>
          <td className="note">{b.note}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function CliffTable({ cliffs, m }) {
  if (!cliffs.length) return <p className="empty">이 가구에서는 절벽이 발견되지 않았습니다.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th style={{ textAlign: "right" }}>월 소득</th><th style={{ textAlign: "right" }}>중위소득 대비</th><th style={{ textAlign: "right" }}>손해</th><th>사라지는 혜택</th></tr></thead>
      <tbody>{cliffs.map((c) => (
        <tr key={c.income}>
          <td className="num">{won(c.income)}</td>
          <td className="num">{Math.round((c.income / m) * 100)}%</td>
          <td className="num" style={{ color: "var(--cliff)" }}>−{won(c.drop)}</td>
          <td>{c.lost.join(", ") || "-"}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function Simulator() {
  const { data, error } = useJson("/data/rules.json");
  const engine = useMemo(() => (data ? createEngine(data) : null), [data]);
  const [hh, setHh] = useState({ ...DEFAULT_HH, ...PRESETS[0].hh });
  const [income, setIncome] = useState(PRESETS[0].income);
  const [includeInkind, setIncludeInkind] = useState(true);
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [tab, setTab] = useState("benefits");
  const cliffLines = useRef({});
  const regionLines = useRef({});

  const calc = useMemo(() => {
    if (!engine) return null;
    const d = engine.derive(hh);
    const m = engine.medianIncome(d.size);
    const maxIncome = Math.round(m / STEP) * STEP;
    const inc = Math.min(income, maxIncome);
    const sim = engine.simulate(hh, maxIncome, STEP, includeInkind);
    const cliffs = engine.findCliffs(sim);
    const benefits = engine.evaluate(hh, inc);
    const total = benefits.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0);
    const regions = Object.keys(data.regions).map((r) => {
      const h2 = { ...hh, region: r };
      const bs = engine.evaluate(h2, inc);
      return { region: r, sim: engine.simulate(h2, maxIncome, STEP, includeInkind), benefits: bs,
        total: bs.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0) };
    });
    return { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions };
  }, [engine, data, hh, income, includeInkind]);

  if (error) return <main className="wrap"><div className="alert cliff"><h3>데이터를 불러오지 못했습니다</h3><p>{String(error.message)}</p></div></main>;
  if (!calc) return <main className="wrap"><p className="empty">불러오는 중…</p></main>;

  const { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions } = calc;
  cliffLines.current = { cliffs: cliffs.map((c) => c.index), current: Math.round(inc / STEP) };
  regionLines.current = { current: Math.round(inc / STEP) };

  const ids = ORDER.filter((id) => sim.series[id]);
  const cliffData = {
    labels: sim.incomes,
    datasets: [
      { label: "근로소득", data: sim.incomes, stack: "s", fill: true, backgroundColor: "rgba(173,181,189,0.35)", borderWidth: 0, order: 3 },
      ...ids.map((id) => ({ label: NAMES[id], data: sim.series[id], stack: "s", fill: true, backgroundColor: COLORS[id] + "cc", borderColor: COLORS[id], borderWidth: 0, order: 2 })),
      { label: "근로소득 + 혜택", data: sim.disposable, stack: "total", fill: false, borderColor: "#1f2430", borderWidth: 2.5, order: 1 },
    ],
  };
  const palette = ["#3b5bdb", "#f08c00"];
  const regionData = {
    labels: sim.incomes,
    datasets: regions.map((r, i) => ({ label: r.region, data: r.sim.disposable, borderColor: palette[i], backgroundColor: palette[i], borderWidth: 2.5, fill: false })),
  };

  const applyPreset = (p) => { setHh({ ...DEFAULT_HH, ...p.hh }); setIncome(p.income); setPreset(p.key); };

  return (
    <>
      <section className="hero"><div className="wrap">
        <h1>월급이 오르면, <em>생활비도</em> 오를까요?</h1>
        <p>소득이 기준선을 넘는 순간 여러 복지 혜택이 한꺼번에 끊겨 오히려 손해를 보는 구간이 있습니다.
          <b> 오름</b>은 그 <b>복지 절벽</b>이 어디에 있는지 보여주고, 손해 없이 넘어가는 길을 찾도록 돕습니다.</p>
      </div></section>

      <main className="wrap layout">
        <aside className="panel" aria-label="가구 정보">
          <div className="card">
            <h2 className="card-title">예시 가구로 시작하기</h2>
            <div className="presets">
              {PRESETS.map((p) => (
                <button type="button" key={p.key} className={preset === p.key ? "active" : ""} onClick={() => applyPreset(p)}>
                  <span className="emoji">{p.emoji}</span>{p.title}<span className="p-sub">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <HouseholdForm hh={hh} setHh={setHh} includeInkind={includeInkind} setIncludeInkind={setIncludeInkind}
            regions={Object.keys(data.regions)} onEdit={() => setPreset(null)} />
        </aside>

        <section className="content">
          <div className="card income-card">
            <div className="income-head">
              <label htmlFor="income" className="card-title">월 근로소득 (가구 합계)</label>
              <output className="income-value">{won(inc)}</output>
            </div>
            <input type="range" id="income" min="0" max={maxIncome} step={STEP} value={inc} onChange={(e) => setIncome(Number(e.target.value))} />
            <div className="income-scale"><span>0원</span><span>{man(maxIncome)}원 (중위소득 100%)</span></div>
          </div>

          <div className="stats">
            <div className="stat"><div className="label">월 근로소득</div><div className="value">{man(inc)}<small>원</small></div></div>
            <div className="stat accent"><div className="label">받는 혜택 (월)</div><div className="value">{man(total)}<small>원</small></div></div>
            <div className="stat"><div className="label">근로소득 + 혜택</div><div className="value">{man(inc + total)}<small>원</small></div></div>
            <div className="stat"><div className="label">기준중위소득 대비 ({d.size}인)</div><div className="value">{Math.round((inc / m) * 100)}<small>%</small></div></div>
          </div>

          <NextCliff income={inc} cliffs={cliffs} />

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">소득별 근로소득 + 혜택</h2>
              <div className="legend-note"><span className="swatch cliff" />절벽 <span className="swatch now" />현재 소득</div>
            </div>
            <div className="chart-box">
              <Line data={cliffData} options={chartOptions(sim.incomes, cliffLines, { stacked: true })} plugins={[vlinePlugin]} />
            </div>
            <p className="hint">그래프가 아래로 꺾이는 빨간 점선이 <b>복지 절벽</b>입니다. 소득이 늘었는데 쓸 수 있는 돈이 줄어드는 지점이에요.</p>
          </div>

          <div className="card">
            <div className="tabs" role="tablist">
              {[["benefits", "받는 혜택"], ["cliffs", "절벽 목록"], ["region", "지역 비교"], ["path", "자립 경로"]].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === "benefits" && <BenefitTable benefits={benefits} />}
            {tab === "cliffs" && <CliffTable cliffs={cliffs} m={m} />}
            {tab === "region" && (
              <>
                <p className="hint">같은 가구가 다른 지역에 살면 주거급여 기준임대료와 지자체 자체 혜택이 달라집니다.</p>
                <div className="chart-box short"><Line data={regionData} options={chartOptions(sim.incomes, regionLines)} plugins={[vlinePlugin]} /></div>
                <div className="region-grid">
                  {regions.map((r) => (
                    <div className="region-col" key={r.region}>
                      <h4>{r.region}</h4>
                      <div className="hint">현재 소득 {won(inc)} 기준 혜택 합계</div>
                      <div className="total">{won(r.total)}</div>
                      <ul>{r.benefits.length ? r.benefits.map((b) => (
                        <li key={b.id}><span>{b.level === "중앙" ? "🏛️" : "📍"} {b.name}</span><b>{b.kind === "access" ? "자격" : won(b.monthly)}</b></li>
                      )) : <li>받을 수 있는 혜택 없음</li>}</ul>
                    </div>
                  ))}
                </div>
                {hh.thirdChild7to18 && hh.residenceMonths < 36 && (
                  <div className="warn">📍 경산시 다자녀가정 지원은 <b>3년 이상 계속 거주</b>해야 받을 수 있습니다. 지금 거주 기간 {hh.residenceMonths}개월 → <b>{36 - hh.residenceMonths}개월</b> 더 필요합니다.</div>
                )}
              </>
            )}
            {tab === "path" && (
              <>
                <p>오름의 목적은 소득을 줄이는 것이 아니라, <b>절벽을 손해 없이 넘어가는 경로</b>를 함께 설계하는 것입니다.</p>
                <ul className="path-list">
                  <li><b>자산형성 지원</b> — 희망저축계좌·청년내일저축계좌 등은 근로소득 일부를 적립하면 정부 지원금을 더해 줍니다.</li>
                  <li><b>근로소득공제</b> — 수급자의 근로소득 일부는 소득인정액에서 빠집니다 (청년 60만 원, 노인·장애인 20만 원 추가 공제).</li>
                  <li><b>자활사업</b> — 자활근로 참여 기간에는 별도 기준이 적용될 수 있습니다.</li>
                  <li><b>이행 급여·유예 제도</b> — 탈수급 후 일정 기간 일부 급여가 유지되는 제도가 있는지 확인하세요.</li>
                </ul>
                <p className="hint">세부 조건은 제도별로 다르므로 행정복지센터·자활센터와 상담하세요.</p>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">데이터 출처와 안내</h2>
            <ul className="path-list">
              <li>복지로 복지서비스 상세 (보건복지부) · 한국사회보장정보원 복지서비스 정보 · 2026년 기준</li>
              <li>금액 근거: 국토교통부 고시, 한국에너지공단 지침, 국세청, 지자체 조례·추진계획, 2024 건강보험통계</li>
            </ul>
            <details><summary>계산 가정 보기</summary><ul>{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details>
            <p className="hint">참고용이며 실제 수급 여부는 읍면동 행정복지센터의 조사로 결정됩니다.</p>
          </div>
        </section>
      </main>
    </>
  );
}
