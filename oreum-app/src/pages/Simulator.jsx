import { Fragment, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { createEngine, KIND_LABEL } from "../lib/engine.js";
import { vlinePlugin } from "../lib/chartSetup.js";
import { man, won } from "../lib/format.js";
import { useJson } from "../lib/useJson.js";
import { analyzeNextCliff, recommendPrograms } from "../lib/guide.js";

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

export function chartOptions(incomes, linesRef, { stacked = false, legend = true } = {}) {
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
      legend: { display: legend, position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
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
        <span className="field-note">현재 대구 북구·경상북도 경산시만 지원합니다. 다른 지역은 공공데이터포털 API와 AI 변환으로 넓혀 갈 예정입니다.</span>
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

function IncomeControl({ inc, maxIncome, setIncome }) {
  const clamp = (v) => Math.min(maxIncome, Math.max(0, Math.round(v / STEP) * STEP));
  return (
    <div className="card income-card">
      <div className="income-head">
        <label htmlFor="income" className="card-title">월 근로소득 (가구 합계)</label>
        <output className="income-value">{won(inc)}</output>
      </div>
      <input type="range" id="income" min="0" max={maxIncome} step={STEP} value={inc} onChange={(e) => setIncome(Number(e.target.value))} />
      <div className="income-scale"><span>0원</span><span>{man(maxIncome)}원 (중위소득 100%)</span></div>
      <div className="income-input">
        <button type="button" className="btn" aria-label="1만 원 줄이기" onClick={() => setIncome(clamp(inc - STEP))} disabled={inc <= 0}>−1만</button>
        <label className="income-field">
          <input type="number" inputMode="numeric" min="0" max={maxIncome / 10000} step="1" value={Math.round(inc / 10000)}
            aria-label="월 근로소득 (만 원)" onChange={(e) => setIncome(clamp((Number(e.target.value) || 0) * 10000))} />
          <span>만 원</span>
        </label>
        <button type="button" className="btn" aria-label="1만 원 늘리기" onClick={() => setIncome(clamp(inc + STEP))} disabled={inc >= maxIncome}>+1만</button>
      </div>
    </div>
  );
}

function ChartLegend({ ids, current }) {
  return (
    <div className="chart-legend" aria-label="그래프 범례">
      <span className="lg"><i style={{ background: "rgba(173,181,189,0.6)" }} />근로소득</span>
      <span className="lg"><i className="line" />근로소득 + 혜택</span>
      {ids.map((id) => (
        <span key={id} className={`lg ${current.has(id) ? "" : "off"}`}><i style={{ background: COLORS[id] }} />{NAMES[id]}</span>
      ))}
      <span className="lg-note">진한 항목 = 지금 소득에서 받는 혜택</span>
    </div>
  );
}

function horizonText(h) {
  const where = h.beforeNextCliff ? `다음 절벽 직전인 월 ${won(h.income)}` : `기준중위소득 100%인 월 ${won(h.income)}`;
  return h.gain > 0
    ? <>{where}까지 오르면 지금보다 한 달에 <b className="good">{won(h.gain)}</b> 더 쓸 수 있습니다.</>
    : <>{where}까지 올라도 지금보다 쓸 수 있는 돈이 늘지 않습니다 (<b>{won(h.gain)}</b>). 절벽이 겹쳐 있는 구간입니다.</>;
}

function NextCliff({ income, cliffs, info, onGuide }) {
  const next = cliffs.find((c) => c.income > income);
  if (!next) {
    return (
      <div className="alert ok"><div className="icon">✅</div><div>
        <h3>이 소득 이후로는 절벽이 없습니다</h3><p>소득이 늘면 쓸 수 있는 돈도 함께 늘어납니다.</p>
      </div></div>
    );
  }
  return (
    <div className="alert cliff">
  <div className="icon">
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v18" />
      <path d="M5 8h14" />
      <path d="M5 16h14" />
      <path d="m8 5-3 3 3 3" />
      <path d="m16 13 3 3-3 3" />
    </svg>
  </div>
  <div>
      <h3>월 소득이 {won(next.income)}이 되면 {won(next.drop)} 손해</h3>
      <p>지금보다 <b>{man(next.income - income)}원</b> 더 벌면, 아래 혜택이 끊겨 근로소득과 혜택을 더한 금액이 오히려 줄어듭니다.</p>
      <div>{(next.lost.length ? next.lost : ["혜택 금액 감소"]).map((n) => <span key={n} className="chip">{n}</span>)}</div>
      {info && (
        <div className="recover">
          <p>{info.recover != null
            ? <>월 {won(info.cliff.income)}부터 {won(info.recover)}까지 <b>{man(info.lossSpan)}원 구간은 준비가 필요한 구간</b>입니다. 일을 더 해도 절벽 직전보다 쓸 수 있는 돈이 적습니다.</>
            : <>기준중위소득 100%까지 벌어도 절벽 직전 수준을 되찾지 못합니다.</>}</p>
          {info.recover != null && <p>{horizonText(info.horizon)}</p>}
          <button type="button" className="link-btn" onClick={onGuide}>준비 구간을 넘는 방법 보기 →</button>
        </div>
      )}
    </div></div>
  );
}

function statusClass(status) {
  if (status.startsWith("추정")) return "est";
  if (status.includes("추정")) return "part";
  return "ok";
}

function Evidence({ id, data }) {
  const src = data.benefit_sources?.[id];
  if (!src) return <p className="hint">근거 정보가 없습니다.</p>;
  const rule = data.rule_table.find((r) => r.service === src.rule);
  return (
    <div className="evidence">
      {rule && <p><b>선정기준</b> {rule.condition} · <b>금액</b> {rule.amount}</p>}
      {src.verification.map((k) => {
        const v = data.verification[k];
        return (
          <div key={k} className="ev-item">
            <span className={`status ${statusClass(v.status)}`}>{v.status}</span>
            <span className="ev-value">{v.value}</span>
            <div className="ev-basis">{v.basis}</div>
          </div>
        );
      })}
      {!src.verification.length && <p className="hint">지자체 공고 원문의 기준을 그대로 반영했습니다 ({rule?.status}).</p>}
    </div>
  );
}

const EV_LABEL = { ok: "확인", part: "일부 추정", est: "추정" };

function BenefitTable({ benefits, data }) {
  const [open, setOpen] = useState(null);
  if (!benefits.length) return <p className="empty">이 소득에서 받을 수 있는 혜택이 없습니다.</p>;
  const level = (id) => {
    const keys = data.benefit_sources?.[id]?.verification || [];
    const st = keys.map((k) => statusClass(data.verification[k].status));
    return st.includes("est") ? "est" : st.includes("part") ? "part" : "ok";
  };
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>혜택</th><th>종류</th><th style={{ textAlign: "right" }}>월 환산액</th><th>근거</th></tr></thead>
      <tbody>{benefits.map((b) => (
        <Fragment key={b.id}>
          <tr>
            <td><b>{b.name}</b> <span className={`tag ${b.level === "중앙" ? "central" : "local"}`}>{b.level}</span></td>
            <td>{KIND_LABEL[b.kind]}</td>
            <td className="num">{b.kind === "access" ? "자격" : won(b.monthly)}</td>
            <td className="note">
              {b.note}
              <button type="button" className={`ev-btn ${level(b.id)}`} aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                {EV_LABEL[level(b.id)]} · 출처 {open === b.id ? "닫기" : "보기"}
              </button>
            </td>
          </tr>
          {open === b.id && <tr className="ev-row"><td colSpan={4}><Evidence id={b.id} data={data} /></td></tr>}
        </Fragment>
      ))}</tbody>
    </table></div>
  );
}

function PathGuide({ info, programs, inc }) {
  return (
    <div className="guide">
      <p>오름의 목적은 소득을 줄이는 것이 아니라, <b>절벽을 손해 없이 넘어가는 경로</b>를 함께 설계하는 것입니다.</p>
      {info ? (
        <>
          <div className="guide-steps">
            <div className="g-step"><div className="g-label">다음 절벽까지</div><div className="g-value">{man(info.gap)}<small>원 더</small></div><div className="g-sub">월 {won(info.cliff.income)}에서</div></div>
            <div className="g-step bad"><div className="g-label">넘는 순간 손해</div><div className="g-value">−{man(info.cliff.drop)}<small>원/월</small></div><div className="g-sub">{info.lost.join(", ") || "혜택 감소"}</div></div>
            <div className="g-step good"><div className="g-label">준비 구간이 끝나는 소득</div><div className="g-value">{info.recover != null ? <>{man(info.recover)}<small>원</small></> : "없음"}</div><div className="g-sub">{info.recover != null ? `절벽보다 ${man(info.lossSpan)}원 더` : "중위소득 100% 안에서"}</div></div>
          </div>
          {info.recover != null && <p className="horizon">📈 {horizonText(info.horizon)}</p>}
          <div className="guide-sets">
            {info.kept.length > 0 && <div><b>절벽을 넘어도 계속 받는 혜택</b><div>{info.kept.map((n) => <span key={n} className="chip keep">{n}</span>)}</div></div>}
            {info.gained.length > 0 && <div><b>절벽을 넘으면 새로 생기는 혜택</b><div>{info.gained.map((n) => <span key={n} className="chip gain">{n}</span>)}</div></div>}
          </div>
          <p className="hint">절벽에서 준비 구간이 끝나는 소득({info.recover != null ? won(info.recover) : "-"})까지가 <b>준비가 필요한 구간</b>입니다. 이 구간을 한 번에 넘을 수 있는 일자리인지 확인하고, 아래 제도로 그 사이를 메우는 계획을 세우세요.</p>
        </>
      ) : (
        <div className="alert ok"><div className="icon">✅</div><div><h3>월 {won(inc)} 이후로는 절벽이 없습니다</h3><p>소득이 늘수록 쓸 수 있는 돈도 늘어납니다.</p></div></div>
      )}
      <h3 className="guide-title">이 가구에 맞는 자립 지원 제도</h3>
      {programs.length ? (
        <div className="programs">
          {programs.map((p) => (
            <div key={p.key} className="program">
              <h4>{p.title}</h4>
              <p className="why">{p.why}</p>
              <p>{p.what}</p>
              <div className="where">📍 {p.where}</div>
            </div>
          ))}
        </div>
      ) : <p className="empty">지금 소득에서 해당되는 자립 지원 제도가 없습니다.</p>}
      <p className="hint">세부 조건과 금액은 해마다 바뀝니다. 신청 전에 복지로와 행정복지센터·자활센터에서 확인하세요.</p>
    </div>
  );
}

function Intro({ example }) {
  return (
    <section className="hero"><div className="wrap hero-grid">
      <div>
        <h1>월급이 오르면, <em>생활비도</em> 오를까요?</h1>
        <p>소득이 기준선을 넘는 순간 여러 복지 혜택이 한꺼번에 끊겨 오히려 손해를 보는 구간이 있습니다.
          이것을 <b>복지 절벽</b>이라고 합니다. <b>오름</b>은 절벽이 어디에 있는지 보여 주고, 손해 없이 넘어가는 길을 찾도록 돕습니다.</p>
        <ol className="how">
          <li><b>1</b>예시 가구를 고르거나 가구 정보를 넣고</li>
          <li><b>2</b>월 소득을 움직여 보면</li>
          <li><b>3</b>절벽 위치와 넘는 방법이 보입니다</li>
        </ol>
      </div>
      {example && (
        <div className="hero-example" aria-label="복지 절벽 예시">
          <div className="ex-title">예) 경산시 한부모 + 초·중학생 자녀 2명</div>
          <div className="ex-row">
            <div><div className="ex-label">월 {man(example.from)}원 벌 때</div><div className="ex-value">{man(example.before)}원</div></div>
            <div className="ex-arrow" aria-hidden="true">→</div>
            <div><div className="ex-label">월 {man(example.to)}원 벌 때</div><div className="ex-value down">{man(example.after)}원</div></div>
          </div>
          <div className="ex-caption">근로소득 + 혜택 (한 달에 쓸 수 있는 돈)</div>
          <div className="ex-note">1만 원 더 벌었더니 쓸 수 있는 돈이 한 달에 <b>{won(example.drop)}</b> 줄어듭니다. ({example.lost.join(", ")} 종료)</div>
        </div>
      )}
    </div></section>
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
    const info = analyzeNextCliff(sim, cliffs, inc);
    const programs = recommendPrograms(hh, benefits, data.params, inc);
    return { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions, info, programs };
  }, [engine, data, hh, income, includeInkind]);

  const example = useMemo(() => {
    if (!engine) return null;
    const exHh = { ...DEFAULT_HH, ...PRESETS[0].hh };
    const mx = Math.round(engine.medianIncome(engine.derive(exHh).size) / STEP) * STEP;
    const sim = engine.simulate(exHh, mx, STEP, true);
    const top = engine.findCliffs(sim).sort((a, b) => b.drop - a.drop)[0];
    if (!top) return null;
    return { from: sim.incomes[top.index - 1], to: top.income, before: sim.disposable[top.index - 1], after: sim.disposable[top.index], drop: top.drop, lost: top.lost };
  }, [engine]);

  if (error) return <main className="wrap"><div className="alert cliff"><h3>데이터를 불러오지 못했습니다</h3><p>{String(error.message)}</p></div></main>;
  if (!calc) return <main className="wrap"><p className="empty">불러오는 중…</p></main>;

  const { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions, info, programs } = calc;
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
      <Intro example={example} />

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
          <IncomeControl inc={inc} maxIncome={maxIncome} setIncome={setIncome} />

          <div className="stats">
            <div className="stat"><div className="label">월 근로소득</div><div className="value">{man(inc)}<small>원</small></div></div>
            <div className="stat accent"><div className="label">받는 혜택 (월)</div><div className="value">{man(total)}<small>원</small></div></div>
            <div className="stat"><div className="label">근로소득 + 혜택</div><div className="value">{man(inc + total)}<small>원</small></div></div>
            <div className="stat"><div className="label">기준중위소득 대비 ({d.size}인)</div><div className="value">{Math.round((inc / m) * 100)}<small>%</small></div></div>
          </div>

          <NextCliff income={inc} cliffs={cliffs} info={info} onGuide={() => { setTab("path"); document.getElementById("detail-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">소득별 근로소득 + 혜택</h2>
              <div className="legend-note"><span className="swatch cliff" />절벽 <span className="swatch now" />현재 소득</div>
            </div>
            <div className="chart-box">
              <Line data={cliffData} options={chartOptions(sim.incomes, cliffLines, { stacked: true, legend: false })} plugins={[vlinePlugin]} />
            </div>
            <ChartLegend ids={ids} current={new Set(benefits.filter((b) => b.monthly > 0).map((b) => b.id))} />
            <p className="hint">그래프가 아래로 꺾이는 빨간 점선이 <b>복지 절벽</b>입니다. 소득이 늘었는데 쓸 수 있는 돈이 줄어드는 지점이에요.</p>
          </div>

          <div className="card">
            <div className="tabs" role="tablist" id="detail-tabs">
              {[["benefits", "받는 혜택"], ["path", "자립 경로"], ["cliffs", "절벽 목록"], ["region", "지역 비교"]].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === "benefits" && <BenefitTable benefits={benefits} data={data} />}
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
            {tab === "path" && <PathGuide info={info} programs={programs} inc={inc} />}
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
