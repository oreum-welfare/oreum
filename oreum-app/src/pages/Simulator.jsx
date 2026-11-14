import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { decodeState, encodeState } from "../lib/urlState.js";
import StartScreen from "../components/StartScreen.jsx";
import { Line } from "react-chartjs-2";
import { createEngine, KIND_LABEL } from "../lib/engine.js";
import { markerPlugin, vlinePlugin } from "../lib/chartSetup.js";
import { man, won } from "../lib/format.js";
import { useJson } from "../lib/useJson.js";
import { analyzeNextCliff, recommendPrograms } from "../lib/guide.js";
import { Drawer, Icon, MoreButton, Segmented, Stepper } from "../components/ui.jsx";

const STEP = 10000;
// 혜택 색: 현금(남색 계열) · 감면·현물(청록 계열) · 지자체(주황 계열)
export const COLORS = {
  saeng: "#24402F", jugeo: "#315B46", edu: "#527B62", basic_pension: "#315B46", dis_pension: "#41694B", sp_child: "#6E9278",
  eitc: "#8CAA94", ctc: "#AFC4B4",
  medical: "#3F6E6E", energy: "#5A8A87", telecom: "#7FA6A1", munhwa: "#A7C4BF",
  gs_birth: "#A8742F", gs_clinic: "#C48A3C", gs_multichild: "#D9A861", bk_nhis: "#E8C58E",
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
  housingAsset: 0, financialAsset: 0, debt: 0,
};
const PRESETS = [
  { key: "single-parent", title: "한부모 + 자녀 2명", sub: "경산 · 초·중학생", income: 3000000,
    hh: { region: "경상북도 경산시", age: 38, singleParent: true, elem: 1, middle: 1 } },
  { key: "youth", title: "1인 청년", sub: "경산 · 29세", income: 1000000, hh: { region: "경상북도 경산시", age: 29 } },
  { key: "senior", title: "어르신 단독", sub: "대구 북구 · 70세", income: 600000, hh: { region: "대구광역시 북구", age: 70 } },
  { key: "family", title: "4인 가구", sub: "경산 · 영유아+초등", income: 2500000,
    hh: { region: "경상북도 경산시", age: 36, spouse: true, infants: 1, elem: 1 } },
];
const REGION_SHORT = { "대구광역시 북구": "대구 북구", "경상북도 경산시": "경산시" };
const short = (r) => REGION_SHORT[r] || r;
// 받침에 따라 '이/가'를 고른다
const iga = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? "이" : "가"; };

export function chartOptions(incomes, linesRef, { stacked = false, legend = true, pluginId = "vlines" } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0 } },
    layout: { padding: { top: 14 } },
    scales: {
      x: { stacked, grid: { display: false }, border: { display: false },
        ticks: { autoSkip: false, maxRotation: 0, callback: (_v, i) => (incomes[i] % 1000000 === 0 ? man(incomes[i]) : null) } },
      y: { stacked, beginAtZero: true, grid: { color: "#EFECE4" }, border: { display: false }, ticks: { callback: (v) => man(v), maxTicksLimit: 5 } },
    },
    plugins: {
      [pluginId]: { ref: linesRef },
      legend: { display: legend, position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } },
      tooltip: {
        backgroundColor: "#29332D", padding: 10, cornerRadius: 10,
        filter: (item) => item.raw > 0,
        callbacks: {
          title: (items) => `월 근로소득 ${won(incomes[items[0].dataIndex])}`,
          label: (item) => ` ${item.dataset.label}: ${won(item.raw)}`,
        },
      },
    },
  };
}

/* ---------------- 입력: 우리 가구 ---------------- */
function HouseholdPanel({ hh, set, regions, preset, applyPreset, includeInkind, setIncludeInkind }) {
  const [more, setMore] = useState(hh.housingAsset + hh.financialAsset + hh.debt > 0 || hh.residenceMonths !== 60);
  const chips = [
    ["singleParent", "한부모"], ["disabled", "장애인 가구원"], ["severeDisabled", "본인 심한 장애"],
    ["newborn", "올해 출산"], ["thirdChild7to18", "셋째 이상 자녀(7~18세)"],
  ];
  const money = (k) => ({ value: Math.round(hh[k] / 10000), onChange: (e) => set(k, Math.max(0, Number(e.target.value) || 0) * 10000) });
  const assetSet = hh.housingAsset + hh.financialAsset + hh.debt > 0;
  return (
    <section className="panel" aria-label="우리 가구 정보">
      <div className="panel-head">
        <span className="hint">바꾸면 결과가 바로 바뀌어요</span>
        <label className="preset-select">
          <span className="sr-only">예시 가구</span>
          <select value={preset || ""} onChange={(e) => { const p = PRESETS.find((x) => x.key === e.target.value); if (p) applyPreset(p); }}>
            <option value="" disabled>예시 가구로 채우기</option>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.title} · {p.sub}</option>)}
          </select>
        </label>
      </div>

      <div className="step"><span className="step-no">1</span>사는 곳</div>
      <Segmented label="사는 곳" options={regions.map((r) => [r, short(r)])} value={hh.region} onChange={(v) => set("region", v)} />
      <p className="field-note">지금은 대구 북구·경산시만 계산해요. 다른 지역은 공공데이터 API와 AI로 넓혀 갈 예정이에요.</p>

      <div className="step"><span className="step-no">2</span>가족</div>
      <div className="row"><span>본인 나이</span><Stepper label="본인 나이" value={hh.age} min={19} max={100} suffix="세" onChange={(v) => set("age", v)} /></div>
      <div className="row"><span>배우자</span><Segmented label="배우자" options={[[false, "없음"], [true, "있음"]]} value={hh.spouse} onChange={(v) => set("spouse", v)} /></div>
      {hh.spouse && (
        <div className="chips sub-chips">
          <button type="button" className={`chip ${hh.spouse65 ? "on" : ""}`} aria-pressed={hh.spouse65} onClick={() => set("spouse65", !hh.spouse65)}>배우자 65세 이상</button>
          <button type="button" className={`chip ${hh.dualEarner ? "on" : ""}`} aria-pressed={hh.dualEarner} onClick={() => set("dualEarner", !hh.dualEarner)}>맞벌이 (배우자 연 300만 원+)</button>
        </div>
      )}
      <div className="kids">
        {[["infants", "영유아"], ["elem", "초등"], ["middle", "중학생"], ["high", "고등"]].map(([k, label]) => (
          <div className="row" key={k}><span>{label}</span><Stepper label={label} value={hh[k]} max={5} onChange={(v) => set(k, v)} /></div>
        ))}
      </div>

      <div className="step"><span className="step-no">3</span>해당하는 것</div>
      <div className="chips">
        {chips.map(([k, label]) => (
          <button key={k} type="button" className={`chip ${hh[k] ? "on" : ""}`} aria-pressed={hh[k]} onClick={() => set(k, !hh[k])}>{label}</button>
        ))}
      </div>
      {hh.newborn && (
        <div className="row"><span>출생 순위</span>
          <Segmented label="출생 순위" options={[[1, "첫째"], [2, "둘째"], [3, "셋째"], [4, "넷째+"]]} value={hh.birthOrder} onChange={(v) => set("birthOrder", v)} />
        </div>
      )}

      <button type="button" className="step step-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
        <span className="step-no muted">4</span>재산 · 거주 기간 <span className="optional">선택{assetSet ? " · 입력됨" : ""}</span>
        <Icon name="down" size={16} className={more ? "flip" : ""} />
      </button>
      {more && (
        <div className="more-fields">
          {[["housingAsset", "주택·전세보증금"], ["financialAsset", "예금·적금 등"], ["debt", "대출 등 부채"]].map(([k, label]) => (
            <label className="money" key={k}><span>{label}</span><span className="money-input"><input type="number" inputMode="numeric" min="0" step="100" {...money(k)} />만 원</span></label>
          ))}
          <div className="row"><span>지금 사는 곳 거주 기간</span><Stepper label="거주 기간" value={hh.residenceMonths} max={600} suffix="개월" onChange={(v) => set("residenceMonths", v)} /></div>
          <p className="field-note">재산은 소득으로 환산돼 계산에 들어가요. 비워 두면 0원이고, 토지·자동차는 반영하지 않아요.</p>
          <label className="switch"><input type="checkbox" checked={includeInkind} onChange={(e) => setIncludeInkind(e.target.checked)} /><span>의료급여·통신비 같은 감면·현물도 금액으로 환산</span></label>
        </div>
      )}
      <p className="privacy"><Icon name="lock" size={14} />입력값은 서버로 보내지 않고 이 기기 안에서만 계산해요</p>
    </section>
  );
}

/* ---------------- 소득 조절 ---------------- */
function IncomeControl({ base, cmp, maxIncome, setCompare, pctMedian, diff, onReset, onAdopt, zones, cliffs, info }) {
  const clamp = (v) => Math.min(maxIncome, Math.max(0, Math.round(v / STEP) * STEP));
  const comparing = cmp !== base;
  const pct = (v) => (maxIncome ? Math.min(100, Math.max(0, (v / maxIncome) * 100)) : 0);
  const basePct = pct(base);
  const cliffPct = info ? pct(info.cliff.income) : null;
  const recoverPct = info?.recover != null ? pct(info.recover) : null;
  const pinsClose = cliffPct != null && recoverPct != null && recoverPct - cliffPct < 4;
  // 빠른 이동: 내 소득 / +10만 / 다음 절벽 직전 / 손해 회복 지점
  const jumps = [
    { key: "base", label: "내 소득", value: base },
    { key: "plus", label: "+10만", value: clamp(base + 100000) },
    info && { key: "cliff", mk: "red", n: 2, label: "절벽 직전", value: clamp(info.cliff.income - STEP) },
    info?.recover != null && { key: "recover", mk: "green", n: 3, label: "회복 지점", value: clamp(info.recover) },
    !info && { key: "plus50", label: "+50만", value: clamp(base + 500000) },
  ].filter(Boolean);
  return (
    <div className="income">
      <div className="income-top">
        <label htmlFor="income">소득이 바뀌면? <small>슬라이더로 비교해 보세요</small></label>
        <div className="jumps" role="group" aria-label="비교 소득 빠르게 고르기">
          {jumps.map((j) => (
            <button type="button" key={j.key} className={`jump ${cmp === j.value ? "on" : ""}`} onClick={() => setCompare(j.value)}
              title={`월 ${man(j.value)} 원으로 비교`}>
              {j.n && <i className={`mk ${j.mk}`}>{j.n}</i>}{j.label}
            </button>
          ))}
        </div>
        <span className="income-field">
          <input type="number" inputMode="numeric" min="0" max={maxIncome / 10000} value={Math.round(cmp / 10000)}
            aria-label="비교할 월 근로소득 (만 원)" onChange={(e) => setCompare(clamp((Number(e.target.value) || 0) * 10000))} />만 원
        </span>
      </div>
      <div className="income-slider">
        <button type="button" onClick={() => setCompare(clamp(cmp - STEP))} disabled={cmp <= 0} aria-label="1만 원 줄이기">−1만</button>
        <div className="range-wrap">
          <div className="track-area" aria-hidden="true">
            <div className="track">
              <span className="track-fill" style={{ width: `${pct(cmp)}%` }} />
              {zones.map((z) => (
                <span key={z.from} className={`track-zone ${z.next ? "next" : ""}`} style={{ left: `${pct(z.from)}%`, width: `${Math.max(0.6, pct(z.to) - pct(z.from))}%` }} />
              ))}
            </div>
            {cliffs.map((c) => <span key={c.index} className="track-cliff" style={{ left: `${pct(c.income)}%` }} />)}
            {cliffPct != null && <span className="track-pin red" style={{ left: `${cliffPct}%` }}>2</span>}
            {recoverPct != null && <span className={`track-pin green ${pinsClose ? "raised" : ""}`} style={{ left: `${recoverPct}%` }}>3</span>}
            <span className="base-tick" style={{ left: `${basePct}%` }}><i />내 소득</span>
          </div>
          <input type="range" id="income" min="0" max={maxIncome} step={STEP} value={cmp} onChange={(e) => setCompare(Number(e.target.value))}
            aria-valuetext={`월 ${man(cmp)} 원`} />
        </div>
        <button type="button" onClick={() => setCompare(clamp(cmp + STEP))} disabled={cmp >= maxIncome} aria-label="1만 원 늘리기">+1만</button>
      </div>
      <div className="income-scale"><span>0원</span><span>기준중위소득의 {pctMedian}%{zones.length > 0 && <em className="zone-key"><i />손해 구간</em>}</span><span>{man(maxIncome)}원</span></div>
      {comparing ? (
        <div className={`compare ${diff.disposable < 0 ? "loss" : "gain"}`}>
          <div className="compare-head">
            <b>{man(base)} → {man(cmp)} 원</b>
            <span className="compare-delta">({cmp > base ? "+" : "−"}{man(Math.abs(cmp - base))} 원)</span>
          </div>
          <div className="compare-body">
            <span>한 달에 쓸 수 있는 돈 <b className={diff.disposable < 0 ? "bad" : "good"}>{diff.disposable >= 0 ? "+" : "−"}{man(Math.abs(diff.disposable))} 원</b></span>
            <span>혜택 <b>{diff.benefit >= 0 ? "+" : "−"}{man(Math.abs(diff.benefit))} 원</b>{diff.lost.length > 0 && <> ({diff.lost.slice(0, 2).join(", ")}{diff.lost.length > 2 ? ` 외 ${diff.lost.length - 2}` : ""} 끊김)</>}{diff.gained.length > 0 && <> ({diff.gained.slice(0, 2).join(", ")} 새로 받음)</>}</span>
            {cmp > base && diff.disposable < 0 && <span className="bad">더 벌었는데 쓸 수 있는 돈이 줄어드는 손해 구간이에요.</span>}
          </div>
          <div className="compare-actions">
            <button type="button" className="link" onClick={onReset}>내 소득으로 돌아가기</button>
            <button type="button" className="link" onClick={onAdopt}>이 소득을 내 소득으로</button>
          </div>
        </div>
      ) : (
        <p className="compare-hint">내 소득 <b>월 {man(base)} 원</b> 기준이에요. 슬라이더를 움직이면 소득이 바뀔 때 무엇이 달라지는지 비교해 드려요.</p>
      )}
    </div>
  );
}

/* ---------------- 자세히 보기 내용 ---------------- */
function statusClass(status) {
  if (status.startsWith("추정")) return "est";
  if (status.includes("추정")) return "part";
  return "ok";
}
const EV_LABEL = { ok: "확인", part: "일부 추정", est: "추정" };
// 재산 관련 근거(asset_*)는 재산을 입력했을 때만 반영한다
const sourceKeys = (data, id, hasAssets) => (data.benefit_sources?.[id]?.verification || []).filter((k) => hasAssets || !k.startsWith("asset_"));
const levelOf = (data, id, hasAssets) => {
  const st = sourceKeys(data, id, hasAssets).map((k) => statusClass(data.verification[k].status));
  return st.includes("est") ? "est" : st.includes("part") ? "part" : "ok";
};

function Evidence({ id, data, hasAssets }) {
  const src = data.benefit_sources?.[id];
  if (!src) return <p className="hint">근거 정보가 없어요.</p>;
  const rule = data.rule_table.find((r) => r.service === src.rule);
  return (
    <div className="evidence">
      {rule && <p><b>선정기준</b> {rule.condition}<br /><b>금액</b> {rule.amount}</p>}
      {sourceKeys(data, id, hasAssets).map((k) => {
        const v = data.verification[k];
        return (
          <div key={k} className="ev-item">
            <span className={`pill ${statusClass(v.status)}`}>{v.status}</span> <b>{v.value}</b>
            <div className="ev-basis">{v.basis}</div>
          </div>
        );
      })}
      {!src.verification.length && <p className="hint">지자체 공고 원문의 기준을 그대로 반영했어요 ({rule?.status}).</p>}
    </div>
  );
}

function BenefitList({ benefits, data, lostSet, hasAssets }) {
  const [open, setOpen] = useState(null);
  if (!benefits.length) return <p className="empty">이 소득에서 받을 수 있는 혜택이 없어요.</p>;
  return (
    <ul className="benefit-list">
      {benefits.map((b) => {
        const lv = levelOf(data, b.id, hasAssets);
        return (
          <li key={b.id}>
            <button type="button" className="benefit-row" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
              <i className="swatch" style={{ background: COLORS[b.id] || "#A1A69F" }} />
              <span className="b-name">{b.name}<small>{b.level} · {KIND_LABEL[b.kind]}</small></span>
              {lostSet?.has(b.name) && <span className="pill bad">곧 끊김</span>}
              <span className={`pill ${lv}`}>{EV_LABEL[lv]}</span>
              <span className="b-amt">{b.kind === "access" ? "자격" : won(b.monthly)}</span>
              <Icon name="down" size={16} className={open === b.id ? "flip" : ""} />
            </button>
            {open === b.id && <div className="benefit-detail"><p className="hint">{b.note}</p><Evidence id={b.id} data={data} hasAssets={hasAssets} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

function CliffTable({ cliffs, m }) {
  if (!cliffs.length) return <p className="empty">이 가구에서는 절벽이 발견되지 않았어요.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th className="r">월 소득</th><th className="r">중위 대비</th><th className="r">손해</th><th>끊기는 혜택</th></tr></thead>
      <tbody>{cliffs.map((c) => (
        <tr key={c.income}>
          <td className="num">{won(c.income)}</td>
          <td className="num">{Math.round((c.income / m) * 100)}%</td>
          <td className="num bad">−{won(c.drop)}</td>
          <td>{c.lost.join(", ") || "금액 감소"}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ChartLegend({ ids, current }) {
  return (
    <div className="chart-legend">
      <span className="lg"><i style={{ background: "#E2DDD2" }} />근로소득</span>
      {ids.map((id) => (
        <span key={id} className={`lg ${current.has(id) ? "" : "off"}`}><i style={{ background: COLORS[id] }} />{NAMES[id]}</span>
      ))}
      <span className="lg-note">진한 항목 = 지금 소득에서 받는 혜택</span>
    </div>
  );
}

function ProgramCards({ programs }) {
  if (!programs.length) return <p className="empty">지금 소득에서 해당되는 자립 지원 제도가 없어요.</p>;
  return (
    <div className="programs">
      {programs.map((p) => (
        <div key={p.key} className="program">
          <h4>{p.title}</h4>
          <p className="why">{p.why}</p>
          <p>{p.what}</p>
          <div className="where"><Icon name="map" size={13} />{p.where}</div>
        </div>
      ))}
    </div>
  );
}

function horizonText(h) {
  const where = h.beforeNextCliff ? `다음 절벽 직전인 월 ${won(h.income)}` : `기준중위소득 100%인 월 ${won(h.income)}`;
  return h.gain > 0
    ? <>{where}까지 오르면 지금보다 한 달에 <b className="good">{won(h.gain)}</b> 더 쓸 수 있어요.</>
    : <>{where}까지 올라도 지금보다 쓸 수 있는 돈이 늘지 않아요 ({won(h.gain)}). 절벽이 겹친 구간이에요.</>;
}

/* ---------------- 페이지 ---------------- */
export default function Simulator() {
  const { data, error } = useJson("/data/rules.json");
  const engine = useMemo(() => (data ? createEngine(data) : null), [data]);
  const [params, setParams] = useSearchParams();
  const started = params.has("r");
  const st = useMemo(() => decodeState(params, DEFAULT_HH), [params]);
  const { hh, income, compare, includeInkind, preset } = st;
  const save = (next, push = false) => setParams(encodeState({ ...st, ...next }, DEFAULT_HH), { replace: !push });
  const setIncome = (v) => save({ income: v, compare: null }); // 내 소득을 바꾸면 비교는 처음으로
  const setCompare = (v) => save({ compare: v });
  const setIncludeInkind = (v) => save({ includeInkind: v });
  const [drawer, setDrawer] = useState(null);
  useEffect(() => {
    try { if (started) sessionStorage.setItem("oreum-sim", params.toString()); else sessionStorage.removeItem("oreum-sim"); } catch { /* 저장 불가 환경 */ }
  }, [started, params]);
  const markers = useRef({});
  const lines = useRef({});
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const set = (k, v) => {
    const n = { ...hh, [k]: v };
    if (k === "spouse" && !v) { n.spouse65 = false; n.dualEarner = false; }
    if (k === "newborn" && v && n.infants === 0) n.infants = 1;
    save({ hh: n, preset: null });
  };
  const applyPreset = (p) => { setDrawer(null); save({ hh: { ...DEFAULT_HH, ...p.hh }, income: p.income, compare: null, includeInkind: true, preset: p.key }, true); window.scrollTo(0, 0); };
  const finishStart = (h, inc) => { save({ hh: h, income: inc, compare: null, includeInkind: true, preset: null }, true); window.scrollTo(0, 0); };
  const restart = () => { try { sessionStorage.removeItem("oreum-sim"); } catch { /* 저장 불가 */ } setDrawer(null); setParams(new URLSearchParams()); window.scrollTo(0, 0); };

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
    const cmp = Math.min(compare ?? inc, maxIncome);
    const cmpBenefits = cmp === inc ? benefits : engine.evaluate(hh, cmp);
    const cmpTotal = cmpBenefits.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0);
    const baseNames = new Set(benefits.map((b) => b.name)), cmpNames = new Set(cmpBenefits.map((b) => b.name));
    const diff = {
      disposable: cmp + cmpTotal - (inc + total), benefit: cmpTotal - total,
      lost: [...baseNames].filter((n) => !cmpNames.has(n)), gained: [...cmpNames].filter((n) => !baseNames.has(n)),
    };
    return { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions, info, programs, cmp, cmpTotal, diff };
  }, [engine, data, hh, income, compare, includeInkind]);

  const example = useMemo(() => {
    if (!engine) return null;
    const exHh = { ...DEFAULT_HH, ...PRESETS[0].hh };
    const mx = Math.round(engine.medianIncome(engine.derive(exHh).size) / STEP) * STEP;
    const sim = engine.simulate(exHh, mx, STEP, true);
    const top = engine.findCliffs(sim).sort((a, b) => b.drop - a.drop)[0];
    return top ? { from: sim.incomes[top.index - 1], to: top.income, drop: top.drop, lost: top.lost } : null;
  }, [engine]);

  if (error) return <main className="page"><div className="card alert bad"><h3>데이터를 불러오지 못했어요</h3><p>{String(error.message)}</p></div></main>;
  if (!calc) return <main className="page"><p className="empty">불러오는 중…</p></main>;
  if (!started) return <StartScreen regions={Object.keys(data.regions)} short={short} defaults={DEFAULT_HH} presets={PRESETS} example={example} onFinish={finishStart} onPreset={applyPreset} />;

  const { d, m, maxIncome, inc, sim, cliffs, benefits, total, regions, info, programs, cmp, cmpTotal, diff } = calc;
  const idx = (v) => Math.round(v / STEP);
  markers.current = {
    current: idx(inc),
    compare: idx(cmp),
    cliff: info ? info.cliff.index : null,
    recover: info?.recover != null ? idx(info.recover) : null,
    band: info?.recover != null ? [info.cliff.index - 0.5, idx(info.recover)] : null,
    others: cliffs.filter((c) => c.index !== info?.cliff.index).map((c) => c.index),
  };
  lines.current = { current: idx(inc), cliffs: cliffs.map((c) => c.index) };

  const ids = ORDER.filter((id) => sim.series[id]);
  const currentIds = new Set(benefits.filter((b) => b.monthly > 0).map((b) => b.id));
  const lostSet = new Set(info?.lost || []);
  const maxDrop = cliffs.reduce((a, c) => Math.max(a, c.drop), 0);
  // 손해 구간: 절벽부터 절벽 직전 수준을 되찾는 소득까지 (슬라이더 위에 표시)
  const zones = cliffs.map((c) => {
    const before = sim.disposable[c.index - 1];
    let j = c.index;
    while (j < sim.incomes.length && sim.disposable[j] < before) j++;
    return { from: c.income - STEP / 2, to: j < sim.incomes.length ? sim.incomes[j] - STEP / 2 : maxIncome, next: c.index === info?.cliff.index };
  });
  const pctMedian = Math.round((cmp / m) * 100);
  const hasAssets = hh.housingAsset + hh.financialAsset + hh.debt > 0;
  const levels = benefits.map((b) => levelOf(data, b.id, hasAssets));
  const levelText = [["ok", "확인"], ["part", "일부 추정"], ["est", "추정"]]
    .map(([k, t]) => [t, levels.filter((l) => l === k).length]).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(" · ");
  const other = regions.find((r) => r.region !== hh.region);
  const here = regions.find((r) => r.region === hh.region);
  const regionDiff = other ? other.total - here.total : 0;

  const mainData = {
    labels: sim.incomes,
    datasets: [{ label: "한 달에 쓸 수 있는 돈", data: sim.disposable, borderColor: "#315B46", borderWidth: 2.5, fill: true,
      backgroundColor: "rgba(49, 91, 70, 0.07)", stepped: false }],
  };
  const stackData = {
    labels: sim.incomes,
    datasets: [
      { label: "근로소득", data: sim.incomes, stack: "s", fill: true, backgroundColor: "rgba(222,226,230,0.7)", borderWidth: 0, order: 3 },
      ...ids.map((id) => ({ label: NAMES[id], data: sim.series[id], stack: "s", fill: true, backgroundColor: COLORS[id] + "d9", borderColor: COLORS[id], borderWidth: 0, order: 2 })),
      { label: "근로소득 + 혜택", data: sim.disposable, stack: "total", fill: false, borderColor: "#29332D", borderWidth: 2, order: 1 },
    ],
  };
  const regionData = {
    labels: sim.incomes,
    datasets: regions.map((r, i) => ({ label: short(r.region), data: r.sim.disposable, borderColor: ["#315B46", "#C48A3C"][i], backgroundColor: ["#315B46", "#C48A3C"][i], borderWidth: 2.5, fill: false })),
  };

  const summary = <>월 <em>{man(inc)} 원</em>을 벌면, 복지 혜택으로 매달 <em>{man(total)} 원</em>을 받아요.</>;
  const lostName = info ? (info.lost[0] || "일부 혜택") + (info.lost.length > 1 ? ` 등 ${info.lost.length}가지` : "") : "";
  const summarySub = info
    ? <>소득이 <b>월 {man(info.cliff.income)} 원</b>이 되면 {lostName}{iga(lostName)} 끊겨, 한 달에 쓸 수 있는 돈이 <b className="bad">{man(info.cliff.drop)} 원 줄어들어요</b>.
        {info.recover != null && <> 소득이 월 {man(info.recover)} 원을 넘으면 줄어든 만큼 다시 회복돼요.</>}</>
    : <>앞으로 소득이 늘면 쓸 수 있는 돈도 <b className="good">계속 늘어나요</b>.</>;

  const kidsN = hh.infants + hh.elem + hh.middle + hh.high;
  const profile = [
    `월 ${man(inc)}원`, short(hh.region), `${hh.age}세`, hh.spouse ? "배우자 있음" : null,
    kidsN ? `자녀 ${kidsN}명` : "자녀 없음",
    hh.singleParent ? "한부모" : null, hh.disabled ? "장애인 가구원" : null, hh.severeDisabled ? "본인 심한 장애" : null,
    hh.newborn ? "올해 출산" : null, hh.thirdChild7to18 ? "셋째 이상" : null,
    hasAssets ? "재산 입력됨" : null,
  ].filter(Boolean);
  const presetTitle = PRESETS.find((p) => p.key === preset)?.title;

  const DRAWERS = {
    edit: { title: "우리 가구 정보", sub: presetTitle ? `예시: ${presetTitle}` : "직접 입력한 정보", body: (
      <>
        <label className="money base-income"><span><b>내 소득</b> 한 달 근로소득 (가구 합계)</span>
          <span className="money-input"><input type="number" inputMode="numeric" min="0" max={maxIncome / 10000} value={Math.round(inc / 10000)}
            onChange={(e) => setIncome(Math.min(maxIncome, Math.max(0, Number(e.target.value) || 0) * 10000))} />만 원</span></label>
        <HouseholdPanel hh={hh} set={set} regions={Object.keys(data.regions)} preset={preset} applyPreset={applyPreset}
          includeInkind={includeInkind} setIncludeInkind={setIncludeInkind} />
      </>) },
    intro: { title: "복지 절벽이란?", sub: "오름이 보여 주는 것", body: (
      <div className="prose">
        <p>소득이 기준선을 넘는 순간 여러 복지 혜택이 한꺼번에 끊겨, <b>더 벌었는데 쓸 수 있는 돈이 줄어드는 구간</b>을 복지 절벽이라고 해요.</p>
        {example && <div className="example"><span>예) 경산시 한부모 + 초·중학생 자녀 2명</span><b>월 {man(example.from)}원 → {man(example.to)}원</b><span>1만 원 더 벌었더니 한 달에 <b className="bad">{won(example.drop)}</b> 줄어요 ({example.lost.join(", ")} 종료)</span></div>}
        <p><b>쓰는 방법</b></p>
        <ol><li>왼쪽에 우리 가구 정보를 넣거나 예시 가구를 골라요.</li><li>그래프 아래 소득을 움직여 봐요.</li><li>①지금 ②다음 절벽 ③손해 회복 카드를 보고, 넘는 방법을 확인해요.</li></ol>
        <p className="hint">오름의 목적은 소득을 줄이라는 게 아니라, 절벽을 손해 없이 넘는 길을 함께 찾는 거예요.</p>
      </div>) },
    graph: { title: "혜택별로 보기", sub: "소득에 따라 어떤 혜택이 얼마씩 쌓이고 끊기는지", body: (
      <>
        <div className="chart-box"><Line data={stackData} options={chartOptions(sim.incomes, lines, { stacked: true, legend: false })} plugins={[vlinePlugin]} /></div>
        <ChartLegend ids={ids} current={currentIds} />
        <h3 className="sub-title">절벽 목록 ({cliffs.length}곳)</h3>
        <CliffTable cliffs={cliffs} m={m} />
      </>) },
    benefits: { title: `지금 받는 혜택 ${benefits.length}가지`, sub: `월 근로소득 ${won(inc)} 기준 · 누르면 근거가 보여요`, body: (
      <>
        <div className="sum-row"><span>혜택 합계</span><b>{won(total)}</b></div>
        <div className="sum-row"><span>한 달에 쓸 수 있는 돈 (근로소득 + 혜택)</span><b>{won(inc + total)}</b></div>
        <BenefitList benefits={benefits} data={data} lostSet={lostSet} hasAssets={hasAssets} />
        <label className="switch"><input type="checkbox" checked={includeInkind} onChange={(e) => setIncludeInkind(e.target.checked)} /><span>감면·현물 혜택도 금액으로 환산해 합계에 넣기</span></label>
      </>) },
    cliff: { title: "다음 절벽", sub: info ? `월 ${won(info.cliff.income)}` : "없음", body: info ? (
      <div className="prose">
        <p>지금보다 <b>{won(info.gap)}</b> 더 벌어 월 {won(info.cliff.income)}이 되면, 아래 혜택이 끊겨 쓸 수 있는 돈이 <b className="bad">{won(info.cliff.drop)}</b> 줄어요.</p>
        <div className="chips">{info.lost.map((n) => <span key={n} className="chip bad">{n}</span>)}</div>
        <h3 className="sub-title">이 가구의 모든 절벽</h3>
        <CliffTable cliffs={cliffs} m={m} />
      </div>) : <p className="empty">이 소득 이후로는 절벽이 없어요.</p> },
    recover: { title: "손해 회복", sub: "절벽을 넘은 뒤", body: info ? (
      <div className="prose">
        {info.recover != null
          ? <p>월 {won(info.cliff.income)}부터 {won(info.recover)}까지 <b>{man(info.lossSpan)}원</b> 구간은 <b>손해 구간</b>이에요. 일을 더 해도 절벽 직전보다 쓸 수 있는 돈이 적어요.</p>
          : <p>기준중위소득 100%까지 벌어도 절벽 직전 수준을 되찾지 못해요.</p>}
        {info.recover != null && <div className="callout good">{horizonText(info.horizon)}</div>}
        {info.kept.length > 0 && <><h3 className="sub-title">절벽을 넘어도 계속 받는 혜택</h3><div className="chips">{info.kept.map((n) => <span key={n} className="chip good">{n}</span>)}</div></>}
        {info.gained.length > 0 && <><h3 className="sub-title">절벽을 넘으면 새로 생기는 혜택</h3><div className="chips">{info.gained.map((n) => <span key={n} className="chip on">{n}</span>)}</div></>}
        <p className="hint">손해 구간을 한 번에 넘을 수 있는 일자리인지 확인하고, 넘는 방법의 제도로 그 사이를 메우는 계획을 세워 보세요.</p>
      </div>) : <p className="empty">이 소득 이후로는 절벽이 없어요.</p> },
    path: { title: "절벽을 손해 없이 넘는 방법", sub: "이 가구에 해당하는 제도만 골랐어요", body: (
      <>
        <ProgramCards programs={programs} />
        <p className="hint">세부 조건과 금액은 해마다 바뀌어요. 신청 전에 복지로와 행정복지센터·자활센터에서 확인하세요.</p>
      </>) },
    region: { title: "지역 비교", sub: "같은 가구가 다른 지역에 살면", body: (
      <>
        <div className="chart-box short"><Line data={regionData} options={chartOptions(sim.incomes, lines)} plugins={[vlinePlugin]} /></div>
        <div className="region-grid">
          {regions.map((r) => (
            <div className="region-col" key={r.region}>
              <h4>{short(r.region)}</h4>
              <div className="total">{won(r.total)}</div>
              <ul>{r.benefits.length ? r.benefits.map((b) => (
                <li key={b.id}><span>{b.name}</span><b>{b.kind === "access" ? "자격" : won(b.monthly)}</b></li>
              )) : <li>받을 수 있는 혜택 없음</li>}</ul>
            </div>
          ))}
        </div>
        {hh.thirdChild7to18 && hh.residenceMonths < 36 && (
          <div className="callout warn">경산시 다자녀가정 지원은 3년 이상 계속 거주해야 받을 수 있어요. 지금 {hh.residenceMonths}개월 → {36 - hh.residenceMonths}개월 더 필요해요.</div>
        )}
        <p className="hint">주거급여 기준임대료(대구 북구 3급지, 경산시 4급지)와 지자체 자체 혜택이 달라서 차이가 나요.</p>
      </>) },
    sources: { title: "근거와 계산 가정", sub: "숫자는 어디서 왔고, 무엇을 가정했나", body: (
      <div className="prose">
        <h3 className="sub-title">데이터 출처</h3>
        <ul><li>복지로 복지서비스 (보건복지부) · 한국사회보장정보원 복지서비스 API · 2026년 기준</li><li>금액 근거: 보건복지부·국토교통부 고시, 한국에너지공단 지침, 국세청, 지자체 조례·추진계획, 2024 건강보험통계</li></ul>
        <h3 className="sub-title">숫자별 확인 상태</h3>
        <div className="table-wrap"><table><tbody>
          {Object.entries(data.verification).map(([k, v]) => (
            <tr key={k}><td><span className={`pill ${statusClass(v.status)}`}>{v.status}</span></td><td>{v.value}</td></tr>
          ))}
        </tbody></table></div>
        <h3 className="sub-title">계산 가정</h3>
        <ul>{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="hint">참고용이며 실제 수급 여부는 읍면동 행정복지센터의 조사로 결정돼요.</p>
      </div>) },
  };
  const D = drawer && DRAWERS[drawer];

  return (
    <main className="page sim">

      <div className="results">
        <div className="profile-bar">
          <div className="profile-chips">{profile.map((t) => <span key={t}>{t}</span>)}</div>
          <div className="profile-actions">
            <button type="button" className="btn primary" onClick={() => setDrawer("edit")}>정보 수정</button>
            <button type="button" className="btn" onClick={restart}>처음부터</button>
          </div>
        </div>
        <div className="summary">
          <h1>{summary}</h1>
          <p className="summary-sub">{summarySub}</p>
          <div className="summary-links">
            <button type="button" className="link" onClick={() => setDrawer("intro")}><Icon name="info" size={15} />복지 절벽이란?</button>
          </div>
        </div>

        <section className="card graph-card" aria-label="소득별 쓸 수 있는 돈">
          <div className="card-head">
            <div><h2>소득별 한 달에 쓸 수 있는 돈</h2><p className="hint">근로소득 + 혜택 · 아래로 꺾이는 곳이 절벽{cliffs.length ? ` (${cliffs.length}곳, 최대 ${man(maxDrop)}원 손해)` : ""}</p></div>
            <MoreButton tone="dark" label="혜택별 그래프" onClick={() => setDrawer("graph")} />
          </div>
          <IncomeControl base={inc} cmp={cmp} maxIncome={maxIncome} setCompare={setCompare} pctMedian={pctMedian} diff={diff}
            onReset={() => setCompare(inc)} onAdopt={() => setIncome(cmp)} zones={zones} cliffs={cliffs} info={info} />
          <div className="graph-body">
            <div className="graph-chart">
              <div className="chart-box main-chart"><Line data={mainData} options={chartOptions(sim.incomes, markers, { legend: false, pluginId: "markers" })} plugins={[markerPlugin]} /></div>
              <div className="marker-legend"><span><i className="mk dark">1</i>내 소득</span><span><i className="dia" />비교 소득</span><span><i className="mk red">2</i>다음 절벽</span><span><i className="mk green">3</i>손해 회복</span><span><i className="band" />손해 구간</span></div>
            </div>
            <div className="kpis">
              <section className="card kpi primary">
                <MoreButton tone="light" label="받는 혜택" onClick={() => setDrawer("benefits")} />
                <div className="kpi-label"><i className="mk dark">1</i>내 소득에서 받는 혜택</div>
                <div className="kpi-num">{man(total)}<small>원</small></div>
                <div className="kpi-foot"><span className="pill white">{benefits.length}가지</span><span>{cmp !== inc ? `비교 소득에서는 ${man(cmpTotal)}원` : `쓸 수 있는 돈 ${man(inc + total)}원`}</span></div>
              </section>
              <section className="card kpi">
                <MoreButton label="다음 절벽" onClick={() => setDrawer("cliff")} />
                <div className="kpi-label"><i className="mk red">2</i>다음 절벽</div>
                {info ? <>
                  <div className="kpi-num">{man(info.cliff.income)}<small>원</small></div>
                  <div className="kpi-foot"><span className="pill bad">↓ {man(info.cliff.drop)}원 손해</span><span>{info.lost[0] || "혜택 감소"}{info.lost.length > 1 ? ` 외 ${info.lost.length - 1}` : ""} 끊김</span></div>
                </> : <>
                  <div className="kpi-num good">없음</div>
                  <div className="kpi-foot"><span className="pill good">더 벌수록 이득</span></div>
                </>}
              </section>
              <section className="card kpi">
                <MoreButton label="손해 회복" onClick={() => setDrawer("recover")} />
                <div className="kpi-label"><i className="mk green">3</i>손해 회복</div>
                {info?.recover != null ? <>
                  <div className="kpi-num">{man(info.recover)}<small>원</small></div>
                  <div className="kpi-foot"><span className="pill good">↑ 이후 이득</span><span>손해 구간 {man(info.lossSpan)}원</span></div>
                </> : info ? <>
                  <div className="kpi-num">—</div>
                  <div className="kpi-foot"><span className="pill warn">중위 100% 안에서 회복 안 됨</span></div>
                </> : <>
                  <div className="kpi-num">—</div>
                  <div className="kpi-foot"><span>손해 구간이 없어요</span></div>
                </>}
              </section>
            </div>
          </div>
        </section>

        <div className="next">
          <section className="card path-card">
            <MoreButton label="넘는 방법" onClick={() => setDrawer("path")} />
            <h2><Icon name="route" />절벽을 손해 없이 넘는 방법</h2>
            {programs.length ? (
              <div className="mini-programs">
                {programs.slice(0, 2).map((p) => <button type="button" key={p.key} onClick={() => setDrawer("path")}><b>{p.title}</b><span>{p.why}</span></button>)}
              </div>
            ) : <p className="hint">지금 소득에서 해당되는 제도가 없어요.</p>}
            {programs.length > 2 && <button type="button" className="link" onClick={() => setDrawer("path")}>{programs.length - 2}가지 더 보기</button>}
          </section>
          <div className="side-cards">
            <section className="card mini">
              <MoreButton label="지역 비교" onClick={() => setDrawer("region")} />
              <div className="kpi-label"><Icon name="map" size={15} />{other ? `${short(other.region)}라면` : "지역 비교"}</div>
              <div className="mini-num">{regionDiff === 0 ? "같아요" : `${regionDiff > 0 ? "+" : "−"}${man(Math.abs(regionDiff))}원`}</div>
            </section>
            <section className="card mini">
              <MoreButton label="근거와 계산 가정" onClick={() => setDrawer("sources")} />
              <div className="kpi-label"><Icon name="doc" size={15} />근거와 계산 가정</div>
              <div className="mini-num small">{levelText || "받는 혜택 없음"}</div>
            </section>
          </div>
        </div>
      </div>

      {D && <Drawer title={D.title} sub={D.sub} onClose={closeDrawer}>{D.body}</Drawer>}
    </main>
  );
}
