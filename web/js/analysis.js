// 오름 - 데이터 분석 페이지
// 가구 유형(rules.json의 analysis_households) × 지역을 모두 시뮬레이션해 절벽을 비교한다.
// 같은 분석을 파이썬 analysis/cliff_analysis.py로도 실행할 수 있다.
import { createEngine } from "./engine.js";

const STEP = 10000;
const EXTRA = 100000; // "10만 원 더 벌면"
const TYPE_COLORS = ["#4c6ef5", "#7950f2", "#15aabf", "#e03131", "#f08c00", "#2b8a3e"];
const SNAKE_TO_CAMEL = {
  spouse_65: "spouse65", dual_earner: "dualEarner", birth_order: "birthOrder", single_parent: "singleParent",
  third_child_7to18: "thirdChild7to18", residence_months: "residenceMonths", severe_disabled: "severeDisabled",
};
const BASE_HH = {
  age: 40, spouse: false, spouse65: false, dualEarner: false, infants: 0, elem: 0, middle: 0, high: 0,
  newborn: false, birthOrder: 1, disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60,
};

const $ = (s) => document.querySelector(s);
const won = (x) => `${Math.round(x).toLocaleString("ko-KR")}원`;
const man = (x) => {
  const v = Math.round(x / 1000) / 10;
  return `${Number.isInteger(v) ? v.toLocaleString("ko-KR") : v.toFixed(1)}만`;
};
const pct = (x) => `${Math.round(x)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toHousehold(snake, region) {
  const hh = { ...BASE_HH, region };
  for (const [k, v] of Object.entries(snake)) hh[SNAKE_TO_CAMEL[k] ?? k] = v;
  return hh;
}

// ---------------------------------------------------------------- 계산
function runAll(data, engine) {
  const regions = Object.keys(data.regions);
  const cases = [];
  for (const t of data.analysis_households) {
    for (const region of regions) {
      const hh = toHousehold(t.hh, region);
      const size = engine.derive(hh).size;
      const m = engine.medianIncome(size);
      const maxIncome = Math.round(m / STEP) * STEP;
      const sim = engine.simulate(hh, maxIncome, STEP, true);
      const cliffs = engine.findCliffs(sim).map((c) => ({ ...c, pct: (c.income / m) * 100 }));
      const endings = [];
      for (let i = 1; i < sim.incomes.length; i++) {
        for (const name of sim.elig[i - 1]) {
          if (!sim.elig[i].has(name)) endings.push({ name, income: sim.incomes[i], pct: (sim.incomes[i] / m) * 100 });
        }
      }
      const k = EXTRA / STEP;
      const retained = sim.incomes.slice(0, -k).map((_, i) => sim.disposable[i + k] - sim.disposable[i]);
      const maxCliff = cliffs.reduce((a, c) => (!a || c.drop > a.drop ? c : a), null);
      cases.push({
        type: t, region, hh, size, m, sim, cliffs, endings, retained, maxCliff,
        totalDrop: cliffs.reduce((s, c) => s + c.drop, 0),
        lossZones: retained.filter((r) => r < 0).length,
        worst: Math.min(...retained),
      });
    }
  }
  return { regions, cases };
}

// ---------------------------------------------------------------- 핵심 발견
function densestWindow(endings, width = 10) {
  let best = { from: 0, count: 0 };
  for (let from = 0; from <= 100 - width; from += 1) {
    const count = endings.filter((e) => e.pct > from && e.pct <= from + width).length;
    if (count > best.count) best = { from, count };
  }
  return best;
}

function renderFindings({ regions, cases }) {
  const items = [];
  const top = cases.filter((c) => c.maxCliff).sort((a, b) => b.maxCliff.drop - a.maxCliff.drop)[0];
  if (top) {
    items.push(`<b>가장 큰 절벽은 ${esc(top.type.label)}(${esc(top.region)})</b>입니다. 월 소득이 ${won(top.maxCliff.income)}(중위소득 ${pct(top.maxCliff.pct)})이 되는 순간
      <span class="big">${won(top.maxCliff.drop)}</span>을 잃습니다. 사라지는 혜택: ${esc(top.maxCliff.lost.join(", ") || "금액 감소")}.`);
  }

  const allEnd = cases.flatMap((c) => c.endings);
  const win = densestWindow(allEnd);
  if (allEnd.length) {
    items.push(`혜택이 끊기는 지점 ${allEnd.length}개 중 <b>${Math.round((win.count / allEnd.length) * 100)}%(${win.count}개)가 근로소득 기준 중위소득 ${win.from}~${win.from + 10}% 구간</b>에 몰려 있습니다.
      (근로소득공제 때문에 소득인정액 기준으로는 그보다 낮은 구간입니다.)`);
  }

  const withLoss = cases.filter((c) => c.lossZones > 0);
  items.push(`12가지 경우 중 <b>${withLoss.length}가지</b>에서 '10만 원을 더 벌어도 오히려 손해'인 소득 구간이 있습니다.`);

  const byRegion = regions.map((r) => {
    const cs = cases.filter((c) => c.region === r && c.maxCliff);
    const avg = cs.length ? cs.reduce((s, c) => s + c.maxCliff.drop, 0) / cs.length : 0;
    const cnt = cases.filter((c) => c.region === r).reduce((s, c) => s + c.cliffs.length, 0);
    return { r, avg, cnt };
  });
  items.push(`지역별 비교: ${byRegion.map((x) => `<b>${esc(x.r)}</b> 절벽 ${x.cnt}개, 가장 큰 절벽 평균 ${won(x.avg)}`).join(" · ")}.
    같은 가구라도 주거급여 기준임대료와 지자체 혜택 때문에 절벽의 깊이가 달라집니다.`);

  $("#findings").innerHTML = items.map((t) => `<li>${t}</li>`).join("");
}

// ---------------------------------------------------------------- 분석 ① 요약표
function renderSummary({ cases }) {
  const maxDrop = Math.max(...cases.map((c) => c.maxCliff?.drop ?? 0));
  let prevType = null;
  const rows = cases.map((c) => {
    const first = c.cliffs[0];
    const mc = c.maxCliff;
    const start = c.type.key !== prevType;
    prevType = c.type.key;
    return `<tr class="${start ? "group-start" : ""}">
      <td>${start ? `<b>${esc(c.type.label)}</b> <span class="hint">(${c.size}인)</span>` : ""}</td>
      <td>${esc(c.region)}</td>
      <td class="num">${c.cliffs.length}</td>
      <td class="num">${first ? `${man(first.income)}원 <span class="hint">(${pct(first.pct)})</span>` : "-"}</td>
      <td class="num ${mc && mc.drop === maxDrop ? "best" : ""}">${mc ? `−${won(mc.drop)}` : "-"}</td>
      <td class="num">${mc ? `${man(mc.income)}원 <span class="hint">(${pct(mc.pct)})</span>` : "-"}</td>
      <td>${mc ? esc(mc.lost.join(", ") || "금액 감소") : "-"}</td>
      <td class="num" style="${c.worst < 0 ? "color:var(--cliff)" : ""}">${c.worst < 0 ? `−${won(-c.worst)}` : `+${won(c.worst)}`}</td>
    </tr>`;
  }).join("");
  $("#summary-table").innerHTML = `<table>
    <thead><tr><th>가구 유형</th><th>지역</th><th style="text-align:right">절벽 수</th><th style="text-align:right">첫 절벽</th>
    <th style="text-align:right">가장 큰 손해</th><th style="text-align:right">그 위치</th><th>그때 사라지는 혜택</th><th style="text-align:right">10만 원 더 벌 때 최악</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------- 공통 차트 옵션
const axisTicks = { color: "#868e96" };
const legend = { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, font: { family: "Pretendard" } } };

// ---------------------------------------------------------------- 분석 ② 곡선
let curveChart;
function renderCurves({ cases }, region) {
  const cs = cases.filter((c) => c.region === region);
  const datasets = cs.map((c, i) => ({
    label: c.type.label,
    data: c.sim.incomes.map((inc, j) => ({ x: (inc / c.m) * 100, y: (c.sim.disposable[j] / c.m) * 100 })),
    borderColor: TYPE_COLORS[i % TYPE_COLORS.length], backgroundColor: TYPE_COLORS[i % TYPE_COLORS.length],
    showLine: true, pointRadius: 0, borderWidth: 2,
  }));
  if (curveChart) { curveChart.data.datasets = datasets; curveChart.update("none"); return; }
  curveChart = new Chart($("#curve-chart"), {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: { min: 0, max: 100, title: { display: true, text: "월 근로소득 (기준중위소득 대비 %)" }, ticks: { ...axisTicks, callback: (v) => `${v}%` } },
        y: { min: 0, title: { display: true, text: "근로소득 + 혜택 (중위소득 대비 %)" }, ticks: { ...axisTicks, callback: (v) => `${v}%` } },
      },
      plugins: {
        legend,
        tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: 근로소득 ${it.parsed.x.toFixed(0)}% → 합계 ${it.parsed.y.toFixed(0)}%` } },
      },
    },
  });
}

// ---------------------------------------------------------------- 분석 ③ 분포
function renderDistribution({ cases }) {
  const buckets = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, to: i * 5 + 5, count: 0, names: {} }));
  for (const e of cases.flatMap((c) => c.endings)) {
    const b = buckets[Math.min(19, Math.max(0, Math.ceil(e.pct / 5) - 1))];
    b.count++;
    b.names[e.name] = (b.names[e.name] || 0) + 1;
  }
  const max = Math.max(...buckets.map((b) => b.count));
  new Chart($("#dist-chart"), {
    type: "bar",
    data: {
      labels: buckets.map((b) => `${b.from}~${b.to}%`),
      datasets: [{ label: "혜택이 끊기는 횟수", data: buckets.map((b) => b.count),
        backgroundColor: buckets.map((b) => (b.count === max ? "#e03131" : b.count >= max * 0.5 ? "#ff8787" : "#bac8ff")), borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { title: { display: true, text: "월 근로소득 (기준중위소득 대비)" }, ticks: { ...axisTicks, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, title: { display: true, text: "횟수" }, ticks: { ...axisTicks, precision: 0 } },
      },
      plugins: { legend: { display: false } },
    },
  });
  const rows = buckets.filter((b) => b.count).map((b) => `<tr><td>${b.from}~${b.to}%</td><td class="num">${b.count}</td>
    <td>${Object.entries(b.names).sort((a, c) => c[1] - a[1]).map(([n, k]) => `${esc(n)} ${k}`).join(", ")}</td></tr>`).join("");
  $("#dist-table").innerHTML = `<table><thead><tr><th>구간</th><th style="text-align:right">횟수</th><th>끊기는 혜택 (횟수)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------- 분석 ④ 10만 원 더 벌면
let emtrChart;
function renderEmtr(all, typeKey, region) {
  const c = all.cases.find((x) => x.type.key === typeKey && x.region === region);
  const labels = c.sim.incomes.slice(0, c.retained.length);
  const datasets = [
    { label: "10만 원 더 벌 때 늘어나는 금액", data: c.retained, borderWidth: 2, pointRadius: 0, fill: false,
      segment: { borderColor: (ctx) => (ctx.p1.parsed.y < 0 || ctx.p0.parsed.y < 0 ? "#e03131" : "#3b5bdb") }, borderColor: "#3b5bdb" },
    { label: "기준선: 10만 원 그대로 남음", data: labels.map(() => EXTRA), borderColor: "#adb5bd", borderDash: [5, 4], borderWidth: 1, pointRadius: 0 },
    { label: "0원", data: labels.map(() => 0), borderColor: "#ffc9c9", borderWidth: 1, pointRadius: 0 },
  ];
  if (!emtrChart) {
    emtrChart = new Chart($("#emtr-chart"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { ...axisTicks, autoSkip: false, maxRotation: 0, callback(_v, i) { const l = this.chart.data.labels[i]; return l % 500000 === 0 ? man(l) : null; } } },
          y: { ticks: { ...axisTicks, callback: (v) => man(v) } },
        },
        plugins: {
          legend,
          tooltip: {
            filter: (it) => it.datasetIndex === 0,
            callbacks: {
              title: (its) => `월 근로소득 ${won(emtrChart.data.labels[its[0].dataIndex])} → +10만 원`,
              label: (it) => ` 늘어나는 금액: ${won(it.raw)}`,
            },
          },
        },
      },
    });
  } else {
    emtrChart.data.labels = labels;
    emtrChart.data.datasets = datasets;
    emtrChart.update("none");
  }
  const avg = c.retained.reduce((s, r) => s + r, 0) / c.retained.length;
  const worstIdx = c.retained.indexOf(Math.min(...c.retained));
  const worst = c.retained[worstIdx];
  $("#emtr-summary").innerHTML = `평균적으로 10만 원을 더 벌면 <b>${won(avg)}</b>이 늘어납니다. `
    + (worst < 0
      ? `가장 나쁜 구간은 월 <b>${won(labels[worstIdx])}</b>에서 10만 원을 더 벌 때로, 오히려 <b style="color:var(--cliff)">${won(-worst)}</b>이 줄어듭니다.`
      : `이 가구에는 10만 원을 더 벌어도 손해인 구간이 없습니다. 가장 적게 남는 구간은 월 ${won(labels[worstIdx])}에서 ${won(worst)}입니다.`);
}

// ---------------------------------------------------------------- 시작
async function init() {
  const data = await fetch("data/rules.json").then((r) => r.json());
  const engine = createEngine(data);
  const all = runAll(data, engine);

  if (data.provisional?.length) {
    $("#provisional-note").textContent = `⚠️ 일부 금액(${data.provisional.length}개 항목)이 아직 임시값입니다. 금액이 확정되면 아래 결과도 함께 바뀝니다.`;
  }
  const regionOpts = all.regions.map((r) => `<option>${esc(r)}</option>`).join("");
  $("#curve-region").innerHTML = regionOpts;
  $("#emtr-region").innerHTML = regionOpts;
  $("#curve-region").value = all.regions[all.regions.length - 1];
  $("#emtr-region").value = all.regions[all.regions.length - 1];
  $("#emtr-type").innerHTML = data.analysis_households.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("");
  $("#emtr-type").value = "single_parent";
  $("#limits").innerHTML = [
    ...data.assumptions,
    "가구 유형 6개는 대표 사례이며 모든 가구를 대표하지 않습니다.",
    "지역은 대구 북구와 경산시 2곳만 분석했습니다.",
  ].map((a) => `<li>${esc(a)}</li>`).join("");

  renderFindings(all);
  renderSummary(all);
  renderCurves(all, $("#curve-region").value);
  renderDistribution(all);
  renderEmtr(all, $("#emtr-type").value, $("#emtr-region").value);

  $("#curve-region").addEventListener("change", (e) => renderCurves(all, e.target.value));
  const onEmtr = () => renderEmtr(all, $("#emtr-type").value, $("#emtr-region").value);
  $("#emtr-type").addEventListener("change", onEmtr);
  $("#emtr-region").addEventListener("change", onEmtr);
  window.__oreumAnalysis = all; // 디버깅·검증용
}

init().catch((err) => {
  console.error(err);
  $("#findings").innerHTML = `<li>데이터를 불러오지 못했습니다: ${esc(err.message)}</li>`;
});
