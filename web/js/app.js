// 오름 - 화면 로직
import { createEngine, KIND_LABEL } from "./engine.js";

const STEP = 10000;
const COLORS = {
  saeng: "#4c6ef5", medical: "#15aabf", jugeo: "#fab005", edu: "#12b886", energy: "#fd7e14",
  telecom: "#be4bdb", eitc: "#82c91e", ctc: "#20c997", basic_pension: "#7950f2",
  gs_birth: "#e64980", gs_clinic: "#74c0fc", bk_nhis: "#ffa8a8", gs_multichild: "#f783ac", sp_child: "#38d9a9", munhwa: "#ffa94d", dis_pension: "#9775fa",
};
const NAMES = {
  saeng: "생계급여", medical: "의료급여", jugeo: "주거급여", edu: "교육급여", energy: "에너지바우처",
  telecom: "이동통신요금 감면", eitc: "근로장려금", ctc: "자녀장려금", basic_pension: "기초연금",
  gs_birth: "출산장려금", gs_clinic: "65세 이상 진료비 감면", bk_nhis: "건강보험료지원", gs_multichild: "다자녀가정 지원", sp_child: "한부모 아동양육비", munhwa: "문화누리카드", dis_pension: "장애인연금",
};
const ORDER = Object.keys(COLORS);

const PRESETS = [
  { key: "single-parent", emoji: "👩‍👧‍👦", title: "한부모 + 자녀 2명", sub: "경산 · 초·중학생", income: 3000000,
    hh: { region: "경상북도 경산시", age: 38, singleParent: true, elem: 1, middle: 1 } },
  { key: "youth", emoji: "🧑", title: "1인 청년", sub: "경산 · 29세", income: 1000000,
    hh: { region: "경상북도 경산시", age: 29 } },
  { key: "senior", emoji: "👵", title: "어르신 단독", sub: "대구 북구 · 70세", income: 600000,
    hh: { region: "대구광역시 북구", age: 70 } },
  { key: "family", emoji: "👨‍👩‍👧‍👦", title: "4인 가구", sub: "경산 · 영유아+초등", income: 2500000,
    hh: { region: "경상북도 경산시", age: 36, spouse: true, infants: 1, elem: 1 } },
];

const DEFAULT_HH = {
  region: "경상북도 경산시", age: 40, spouse: false, spouse65: false, dualEarner: false,
  infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1,
  disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60,
};

const $ = (s) => document.querySelector(s);
const won = (x) => `${Math.round(x).toLocaleString("ko-KR")}원`;
const man = (x) => {
  const v = Math.round(x / 1000) / 10;
  return `${Number.isInteger(v) ? v.toLocaleString("ko-KR") : v.toFixed(1)}만`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let data, engine, cliffChart, regionChart;
const form = $("#hh-form");
const slider = $("#income");
const simCache = new Map();

function readForm() {
  const f = new FormData(form);
  const num = (k) => Number(f.get(k) || 0);
  const hh = {
    region: f.get("region"),
    age: num("age") || 40,
    spouse: f.has("spouse"),
    spouse65: f.has("spouse") && f.has("spouse65"),
    dualEarner: f.has("spouse") && f.has("dualEarner"),
    infants: num("infants"), elem: num("elem"), middle: num("middle"), high: num("high"),
    newborn: f.has("newborn"),
    birthOrder: num("birthOrder") || 1,
    disabled: f.has("disabled"),
    severeDisabled: f.has("severeDisabled"),
    singleParent: f.has("singleParent"),
    thirdChild7to18: f.has("thirdChild7to18"),
    residenceMonths: num("residenceMonths"),
  };
  return { hh, includeInkind: f.has("includeInkind") };
}

function writeForm(hh) {
  for (const [k, v] of Object.entries({ ...DEFAULT_HH, ...hh })) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = v;
  }
}

function syncFormState() {
  const spouse = form.elements.spouse.checked;
  for (const name of ["spouse65", "dualEarner"]) {
    const el = form.elements[name];
    el.disabled = !spouse;
    el.closest("label").classList.toggle("disabled", !spouse);
  }
  const newborn = form.elements.newborn.checked;
  $("#birth-order-wrap").style.display = newborn ? "" : "none";
  if (newborn && Number(form.elements.infants.value) === 0) form.elements.infants.value = 1;
}

function getSim(hh, maxIncome, includeInkind) {
  const key = JSON.stringify([hh, maxIncome, includeInkind]);
  if (!simCache.has(key)) {
    if (simCache.size > 40) simCache.clear();
    simCache.set(key, engine.simulate(hh, maxIncome, STEP, includeInkind));
  }
  return simCache.get(key);
}

// ---------------------------------------------------------------- 렌더링
function render() {
  const { hh, includeInkind } = readForm();
  const d = engine.derive(hh);
  const m = engine.medianIncome(d.size);
  const maxIncome = Math.round(m / STEP) * STEP;

  if (Number(slider.max) !== maxIncome) {
    slider.max = maxIncome;
    $("#income-max").textContent = `${man(maxIncome)}원 (중위소득 100%)`;
  }
  const income = Math.min(Number(slider.value), maxIncome);
  $("#income-out").textContent = won(income);

  const sim = getSim(hh, maxIncome, includeInkind);
  const cliffs = engine.findCliffs(sim);
  const benefits = engine.evaluate(hh, income);
  const total = benefits.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0);

  renderStats(income, total, m, d.size);
  renderNextCliff(income, cliffs);
  renderChart(sim, cliffs, income);
  renderBenefits(benefits);
  renderCliffList(cliffs, m);
  renderRegion(hh, maxIncome, includeInkind, income);
}

function renderStats(income, total, m, size) {
  const pct = Math.round((income / m) * 100);
  $("#stats").innerHTML = `
    <div class="stat"><div class="label">월 근로소득</div><div class="value">${man(income)}<small>원</small></div></div>
    <div class="stat accent"><div class="label">받는 혜택 (월)</div><div class="value">${man(total)}<small>원</small></div></div>
    <div class="stat"><div class="label">근로소득 + 혜택</div><div class="value">${man(income + total)}<small>원</small></div></div>
    <div class="stat"><div class="label">기준중위소득 대비 (${size}인)</div><div class="value">${pct}<small>%</small></div></div>`;
}

function renderNextCliff(income, cliffs) {
  const next = cliffs.find((c) => c.income > income);
  if (!next) {
    $("#next-cliff").innerHTML = `
      <div class="alert ok"><div class="icon">✅</div><div>
        <h3>이 소득 이후로는 절벽이 없습니다</h3>
        <p>소득이 늘면 쓸 수 있는 돈도 함께 늘어납니다.</p></div></div>`;
    return;
  }
  const chips = next.lost.length
    ? next.lost.map((n) => `<span class="chip">${esc(n)}</span>`).join("")
    : `<span class="chip">혜택 금액 감소</span>`;
  $("#next-cliff").innerHTML = `
    <div class="alert cliff"><div class="icon">🧗</div><div>
      <h3>월 소득이 ${won(next.income)}이 되면 ${won(next.drop)} 손해</h3>
      <p>지금보다 <b>${man(next.income - income)}원</b> 더 벌면, 아래 혜택이 끊겨 근로소득과 혜택을 더한 금액이 오히려 줄어듭니다.</p>
      <div>${chips}</div></div></div>`;
}

// 절벽·현재 소득 세로선 플러그인 (선 위치는 chart.$vlines에 둔다)
const vlinePlugin = {
  id: "vlines",
  afterDatasetsDraw(chart) {
    const opts = chart.$vlines || {};
    const { ctx, chartArea, scales } = chart;
    const draw = (idx, color, dash, width) => {
      const x = scales.x.getPixelForValue(idx);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.restore();
    };
    (opts.cliffs || []).forEach((i) => draw(i, "#e03131", [5, 4], 1.5));
    if (opts.current != null) draw(opts.current, "#3b5bdb", [], 2);
  },
};

function baseOptions(incomes) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0 } },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          autoSkip: false, maxRotation: 0, color: "#868e96",
          callback: (_v, i) => (incomes[i] % 500000 === 0 ? man(incomes[i]) : null),
        },
      },
      y: {
        beginAtZero: true, grid: { color: "#f1f3f5" },
        ticks: { color: "#868e96", callback: (v) => man(v) },
      },
    },
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, font: { family: "Pretendard" } } },
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

function renderChart(sim, cliffs, income) {
  const ids = ORDER.filter((id) => sim.series[id]);
  const datasets = [
    { label: "근로소득", data: sim.incomes, stack: "s", fill: true, backgroundColor: "rgba(173,181,189,0.35)", borderWidth: 0, order: 3 },
    ...ids.map((id) => ({
      label: NAMES[id], data: sim.series[id], stack: "s", fill: true,
      backgroundColor: COLORS[id] + "cc", borderColor: COLORS[id], borderWidth: 0, order: 2,
    })),
    { label: "근로소득 + 혜택", data: sim.disposable, stack: "total", fill: false, borderColor: "#1f2430", borderWidth: 2.5, order: 1 },
  ];
  const current = Math.round(income / STEP);
  const cliffIdx = cliffs.map((c) => c.index);

  if (!cliffChart) {
    const opts = baseOptions(sim.incomes);
    opts.scales.x.stacked = true;
    opts.scales.y.stacked = true;
    cliffChart = new Chart($("#cliff-chart"), { type: "line", data: { labels: sim.incomes, datasets }, options: opts, plugins: [vlinePlugin] });
    cliffChart.$vlines = { cliffs: cliffIdx, current };
    cliffChart.draw();
    return;
  }
  const opts = cliffChart.options;
  if (cliffChart.data.labels !== sim.incomes) {
    cliffChart.data.labels = sim.incomes;
    cliffChart.data.datasets = datasets;
    const fresh = baseOptions(sim.incomes);
    opts.scales.x.ticks.callback = fresh.scales.x.ticks.callback;
    opts.plugins.tooltip.callbacks = fresh.plugins.tooltip.callbacks;
  }
  cliffChart.$vlines = { cliffs: cliffIdx, current };
  cliffChart.update("none");
}

function kindTag(b) {
  return `<span class="tag ${b.level === "중앙" ? "central" : "local"}">${b.level}</span>`;
}

function renderBenefits(benefits) {
  if (!benefits.length) {
    $("#benefits").innerHTML = `<p class="empty">이 소득에서 받을 수 있는 혜택이 없습니다.</p>`;
    return;
  }
  const rows = benefits.map((b) => `
    <tr><td><b>${esc(b.name)}</b> ${kindTag(b)}</td><td>${KIND_LABEL[b.kind]}</td>
    <td class="num">${b.kind === "access" ? "자격" : won(b.monthly)}</td><td class="note">${esc(b.note)}</td></tr>`).join("");
  $("#benefits").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>혜택</th><th>종류</th><th style="text-align:right">월 환산액</th><th>근거</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderCliffList(cliffs, m) {
  if (!cliffs.length) {
    $("#cliffs").innerHTML = `<p class="empty">이 가구에서는 절벽이 발견되지 않았습니다.</p>`;
    return;
  }
  const rows = cliffs.map((c) => `
    <tr><td class="num">${won(c.income)}</td><td class="num">${Math.round((c.income / m) * 100)}%</td>
    <td class="num" style="color:var(--cliff)">−${won(c.drop)}</td><td>${c.lost.map(esc).join(", ") || "-"}</td></tr>`).join("");
  $("#cliffs").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th style="text-align:right">월 소득</th><th style="text-align:right">중위소득 대비</th><th style="text-align:right">손해</th><th>사라지는 혜택</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderRegion(hh, maxIncome, includeInkind, income) {
  const regions = Object.keys(data.regions);
  const palette = ["#3b5bdb", "#f08c00"];
  const sims = regions.map((r) => getSim({ ...hh, region: r }, maxIncome, includeInkind));
  const datasets = sims.map((s, i) => ({ label: regions[i], data: s.disposable, borderColor: palette[i], backgroundColor: palette[i], borderWidth: 2.5, fill: false }));
  const current = Math.round(income / STEP);

  if (!regionChart) {
    const opts = baseOptions(sims[0].incomes);
    regionChart = new Chart($("#region-chart"), { type: "line", data: { labels: sims[0].incomes, datasets }, options: opts, plugins: [vlinePlugin] });
    regionChart.$vlines = { current };
    regionChart.draw();
  } else {
    if (regionChart.data.labels !== sims[0].incomes) {
      regionChart.data.labels = sims[0].incomes;
      const fresh = baseOptions(sims[0].incomes);
      regionChart.options.scales.x.ticks.callback = fresh.scales.x.ticks.callback;
      regionChart.options.plugins.tooltip.callbacks = fresh.plugins.tooltip.callbacks;
    }
    regionChart.data.datasets = datasets;
    regionChart.$vlines = { current };
    regionChart.update("none");
  }

  $("#region-grid").innerHTML = regions.map((r) => {
    const bs = engine.evaluate({ ...hh, region: r }, income);
    const total = bs.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0);
    const items = bs.map((b) => `<li><span>${b.level === "중앙" ? "🏛️" : "📍"} ${esc(b.name)}</span><b>${b.kind === "access" ? "자격" : won(b.monthly)}</b></li>`).join("");
    return `<div class="region-col"><h4>${esc(r)}</h4>
      <div class="hint">현재 소득 ${won(income)} 기준 혜택 합계</div><div class="total">${won(total)}</div>
      <ul>${items || "<li>받을 수 있는 혜택 없음</li>"}</ul></div>`;
  }).join("");

  $("#region-warn").innerHTML = hh.thirdChild7to18 && hh.residenceMonths < 36
    ? `<div class="warn">📍 경산시 다자녀가정 지원은 <b>3년 이상 계속 거주</b>해야 받을 수 있습니다. 지금 거주 기간 ${hh.residenceMonths}개월 → <b>${36 - hh.residenceMonths}개월</b> 더 필요합니다.</div>`
    : "";
}

function renderStatic() {
  $("#region").innerHTML = Object.keys(data.regions).map((r) => `<option>${esc(r)}</option>`).join("");
  $("#presets").innerHTML = PRESETS.map((p) => `
    <button type="button" data-preset="${p.key}"><span class="emoji">${p.emoji}</span>${esc(p.title)}<span class="p-sub">${esc(p.sub)}</span></button>`).join("");
  $("#assumptions").innerHTML = data.assumptions.map((a) => `<li>${esc(a)}</li>`).join("");
  $("#rule-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>서비스</th><th>주체</th><th>판정 조건</th><th>원문</th><th>금액</th></tr></thead><tbody>${
    data.rule_table.map((r) => `<tr><td>${esc(r.service)}</td><td>${esc(r.provider)}</td><td>${esc(r.condition)}</td><td>${esc(r.status)}</td><td>${esc(r.amount)}</td></tr>`).join("")
  }</tbody></table></div>`;
}

function applyPreset(key) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return;
  writeForm(p.hh);
  syncFormState();
  const { hh } = readForm();
  slider.max = Math.round(engine.medianIncome(engine.derive(hh).size) / STEP) * STEP;
  slider.value = p.income;
  document.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b.dataset.preset === key));
  render();
}

function bindEvents() {
  form.addEventListener("input", () => {
    syncFormState();
    document.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("active"));
    render();
  });
  slider.addEventListener("input", render);
  $("#presets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (btn) applyPreset(btn.dataset.preset);
  });
  document.querySelectorAll("[data-tab]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    if (btn.dataset.tab === "region" && regionChart) regionChart.resize();
  }));
}

async function init() {
  data = await fetch("data/rules.json").then((r) => r.json());
  engine = createEngine(data);
  renderStatic();
  bindEvents();
  applyPreset("single-parent");
}

init().catch((err) => {
  console.error(err);
  $("#next-cliff").innerHTML = `<div class="alert cliff"><div class="icon">⚠️</div><div><h3>데이터를 불러오지 못했습니다</h3><p>${esc(err.message)}</p></div></div>`;
});
