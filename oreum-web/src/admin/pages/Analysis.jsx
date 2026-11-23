import { useEffect, useMemo, useState } from "react";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { createEngine } from "../../lib/engine.js";
import { man, pct, won } from "../../lib/format.js";
import { useJson } from "../../lib/useJson.js";
import { taperSimulation } from "../../lib/policy.js";
import { PageHead } from "../adminUi.jsx";
import {
  analyzeCliffCause,
  summarizeCliffCauses,
  summarizeCoLosses,
  summarizeBenefitEndings,
} from "../../lib/analytics.js";


const STEP = 10000;
const RANGE = 2; // 분석 범위: 기준중위소득의 200% (기초연금처럼 중위 100% 위에서 끊기는 혜택까지)
const EXTRA = 100000;
const SNAKE = { spouse_65: "spouse65", dual_earner: "dualEarner", birth_order: "birthOrder", single_parent: "singleParent", third_child_7to18: "thirdChild7to18", residence_months: "residenceMonths", severe_disabled: "severeDisabled" };
const BASE = { age: 40, spouse: false, spouse65: false, dualEarner: false, infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1, disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60 };

function toHh(snake, region) {
  const hh = { ...BASE, region };
  for (const [k, v] of Object.entries(snake)) hh[SNAKE[k] ?? k] = v;
  return hh;
}

function runAll(data, engine) {
  const regions = data.analysis_regions || Object.keys(data.regions); // 분석 대상 지역 (제안서 분석)
  const cases = [];
  for (const t of data.analysis_households) {
    for (const region of regions) {
      const hh = toHh(t.hh, region);
      const m = engine.medianIncome(engine.derive(hh).size);
      const sim = engine.simulate(hh, Math.round((m * RANGE) / STEP) * STEP, STEP, true);
      const cliffs = engine.findCliffs(sim).map((c) => ({ ...c, pct: (c.income / m) * 100 }));
      const cliffCauses = cliffs.map((cliff) => {
        const beforeBenefits = engine.evaluate(hh, sim.incomes[cliff.index - 1]);
        const afterBenefits = engine.evaluate(hh, sim.incomes[cliff.index]);
      
        return {
          ...cliff,
          ...analyzeCliffCause(sim, cliff, [
            ...beforeBenefits,
            ...afterBenefits,
          ]),
        };
      });
      const endings = [];
      for (let i = 1; i < sim.incomes.length; i++) {
        for (const name of sim.elig[i - 1]) if (!sim.elig[i].has(name)) endings.push({ name, pct: (sim.incomes[i] / m) * 100 });
      }
      const k = EXTRA / STEP;
      const retained = sim.incomes.slice(0, -k).map((_, i) => sim.disposable[i + k] - sim.disposable[i]);
      cases.push({ type: t, region, size: engine.derive(hh).size, m, sim, cliffs, cliffCauses, endings, retained,
        maxCliff: cliffs.reduce((a, c) => (!a || c.drop > a.drop ? c : a), null),
        worst: Math.min(...retained), lossZones: retained.filter((r) => r < 0).length });
    }
  }
  return { regions, cases };
}

/**
 * 가구 조건 민감도 분석
 * 한 번에 하나의 조건만 변경하고 나머지는 유지한다.
 */
function buildSensitivity(data, engine) {
  const rows = [];

  for (const type of data.analysis_households) {
    for (const region of data.analysis_regions || Object.keys(data.regions)) {
      const base = toHh(type.hh, region);
      const baseSize = engine.derive(base).size;
      const baseMedian = engine.medianIncome(baseSize);

      // 가구 구성(나이·배우자·자녀 수)을 바꾸는 변경은 가구원 수가 달라져 지원이 늘어나는 게 당연하므로 제외하고,
      // 같은 가구에서 실제로 달라질 수 있는 조건만 하나씩 바꿔 본다.
      const variants = [
        {
          key: "disabled",
          label: "장애 여부",
          description: base.disabled ? "장애 조건 해제" : "장애 가구원 있음",
          patch: { disabled: !base.disabled },
        },
      ];

      if (base.spouse) {
        variants.push({
          key: "dualEarner",
          label: "맞벌이 여부",
          description: base.dualEarner ? "외벌이로" : "맞벌이로",
          patch: { dualEarner: !base.dualEarner },
        });
      }

      if (base.singleParent || (!base.spouse && engine.derive(base).children > 0)) {
        variants.push({
          key: "singleParent",
          label: "한부모 여부",
          description: base.singleParent ? "한부모 해제" : "한부모 가구",
          patch: { singleParent: !base.singleParent },
        });
      }

      if (type.key === "multichild") {
        variants.push(
          {
            key: "thirdChild7to18",
            label: "다자녀 조건",
            description: base.thirdChild7to18 ? "셋째 조건 해제" : "셋째 이상 자녀",
            patch: { thirdChild7to18: !base.thirdChild7to18 },
          },
          {
            key: "residenceMonths",
            label: "거주 기간",
            description: "60개월 ↔ 0개월",
            patch: { residenceMonths: base.residenceMonths >= 36 ? 0 : 60 },
          }
        );
      }

      for (const variant of variants) {
        const changed = { ...base, ...variant.patch };
        const changedSize = engine.derive(changed).size;
        const changedMedian = engine.medianIncome(changedSize);

        // 동일한 근로소득에서 지원액을 비교
        const referenceIncome = Math.round(
          (baseMedian * 0.3) / STEP
        ) * STEP;

        const getSupport = (hh) =>
          engine.evaluate(hh, referenceIncome)
            .filter((benefit) => engine.counted(benefit, true))
            .reduce((sum, benefit) => sum + benefit.monthly, 0);

        const baseSupport = getSupport(base);
        const changedSupport = getSupport(changed);

        // 동일한 소득 범위에서 절벽 발생 여부 비교
        const maxIncome = Math.ceil(
          (Math.max(baseMedian, changedMedian) * RANGE) / STEP
        ) * STEP;

        const baseSim = engine.simulate(base, maxIncome, STEP, true);
        const changedSim = engine.simulate(changed, maxIncome, STEP, true);

        const baseCliffs = engine.findCliffs(baseSim);
        const changedCliffs = engine.findCliffs(changedSim);

        const baseMax = Math.max(
          0,
          ...baseCliffs.map((cliff) => cliff.drop)
        );

        const changedMax = Math.max(
          0,
          ...changedCliffs.map((cliff) => cliff.drop)
        );

        rows.push({
          household: type.label,
          householdKey: type.key,
          region,
          factor: variant.label,
          description: variant.description,
          referenceIncome,
          baseSize,
          changedSize,
          baseSupport,
          changedSupport,
          supportDelta: changedSupport - baseSupport,
          baseCliffs: baseCliffs.length,
          changedCliffs: changedCliffs.length,
          cliffDelta: changedCliffs.length - baseCliffs.length,
          baseMax,
          changedMax,
          maxDelta: changedMax - baseMax,
        });
      }
    }
  }

  return rows.sort(
    (a, b) => Math.abs(b.supportDelta) - Math.abs(a.supportDelta)
  );
}

function Findings({ all }) {
  const { regions, cases } = all;
  const top = cases.filter((c) => c.maxCliff).sort((a, b) => b.maxCliff.drop - a.maxCliff.drop)[0];
  const ends = cases.flatMap((c) => c.endings);
  let win = { from: 0, count: 0 };
  for (let from = 0; from <= RANGE * 100 - 10; from++) {
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
    {/* 요약 카드: 누르면 아래 자세한 분석으로 이동 */}
    <div className="stats">
      {top && <a className="stat accent jump" href="#an-table"><div className="label">가장 큰 절벽</div><div className="value">{man(top.maxCliff.drop)}<small>원</small></div><div className="stat-sub">{top.type.label} · 월 {man(top.maxCliff.income)}원</div><span className="jump-go">① 가구별 표 →</span></a>}
      <a className="stat jump" href="#an-ends"><div className="label">혜택이 몰려 끊기는 구간</div><div className="value">{win.from}~{win.from + 10}<small>%</small></div><div className="stat-sub">끊기는 지점의 {share}% (기준중위소득 대비)</div><span className="jump-go">③ 끊기는 구간 →</span></a>
      <a className="stat jump" href="#an-emtr"><div className="label">더 벌어도 손해인 경우</div><div className="value">{cases.filter((c) => c.lossZones > 0).length}<small>/ {cases.length}</small></div><div className="stat-sub">10만 원 더 벌면 손해인 구간이 있는 경우</div><span className="jump-go">④ 10만 원 더 벌면 →</span></a>
      <a className="stat jump" href="#an-policy"><div className="label">제도 개선 시 절벽</div><div className="value">{totalCliffs}→{policy.after}<small>개</small></div><div className="stat-sub">혜택을 중위 10%p에 걸쳐 서서히 줄이면</div><span className="jump-go">⑤ 제도 개선 효과 →</span></a>
    </div>
    <section className="card"><h2 className="card-title">핵심 발견</h2>
    <ol className="findings">
      {top && <li><b>가장 큰 절벽은 {top.type.label}({top.region})</b>입니다. 월 소득이 {won(top.maxCliff.income)}(중위소득 {pct(top.maxCliff.pct)})이 되는 순간 <span className="big">{won(top.maxCliff.drop)}</span>을 잃습니다. 사라지는 혜택: {top.maxCliff.lost.join(", ") || "금액 감소"}.</li>}
      {ends.length > 0 && <li>혜택이 끊기는 지점 {ends.length}개 중 <b>{Math.round((win.count / ends.length) * 100)}%({win.count}개)가 근로소득 기준 중위소득 {win.from}~{win.from + 10}% 구간</b>에 몰려 있습니다. (근로소득공제 때문에 소득인정액 기준으로는 그보다 낮은 구간입니다.)</li>}
      <li>12가지 경우 중 <b>{cases.filter((c) => c.lossZones > 0).length}가지</b>에서 '10만 원을 더 벌어도 오히려 손해'인 소득 구간이 있습니다.</li>
      <li><b>제도 개선 효과:</b> 기준선에서 끊기는 혜택(수급 자격에 묶인 혜택·기초연금 등)을 기준선에서 한 번에 끊지 않고 중위소득 10%p 구간에서 서서히 줄이면, 절벽이 {cases.reduce((s, c) => s + c.cliffs.length, 0)}개에서 <b>{policy.after}개</b>로, 가장 큰 손해가 {won(top?.maxCliff.drop ?? 0)}에서 <b>{won(policy.max)}</b>으로 줄어듭니다 (⑤).</li>
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

  // 동일한 정책 개입을 12개 사례에 적용
  const rows = useMemo(
    () =>
      all.cases.map((c) => {
        const r = taperSimulation(c.sim, c.m, width);

        const beforeMax = Math.max(
          0,
          ...c.cliffs.map((x) => x.drop)
        );
        const afterMax = Math.max(
          0,
          ...r.cliffs.map((x) => x.drop)
        );

        return {
          c,
          r,
          beforeMax,
          afterMax,
          extraTotal: r.extraTotal,
          extraSteps: r.extraSteps,
        };
      }),
    [all, width]
  );

  // 전체 정책 효과
  const before = rows.reduce(
    (s, x) => s + x.c.cliffs.length, 0
  );
  const after = rows.reduce(
    (s, x) => s + x.r.cliffs.length, 0
  );

  const maxBefore = Math.max(
    0, ...rows.map((x) => x.beforeMax)
  );
  const maxAfter = Math.max(
    0, ...rows.map((x) => x.afterMax)
  );

  // 추가 지원 규모
  const totalExtra = rows.reduce(
    (s, x) => s + x.extraTotal, 0
  );
  const totalSteps = rows.reduce(
    (s, x) => s + x.extraSteps, 0
  );
  const avgExtra = totalSteps
    ? totalExtra / totalSteps
    : 0;
  const maxExtra = Math.max(
    0, ...rows.map((x) => x.r.extraMax)
  );

  const affectedCases = rows.filter(
    (x) => x.extraSteps > 0
  ).length;

  // 지역별 정책 효과
  const regionRows = all.regions.map((region) => {
    const selected = rows.filter(
      (x) => x.c.region === region
    );

    const extra = selected.reduce(
      (s, x) => s + x.extraTotal, 0
    );
    const steps = selected.reduce(
      (s, x) => s + x.extraSteps, 0
    );

    return {
      region,
      before: selected.reduce(
        (s, x) => s + x.c.cliffs.length, 0
      ),
      after: selected.reduce(
        (s, x) => s + x.r.cliffs.length, 0
      ),
      extra,
      steps,
      avg: steps ? extra / steps : 0,
    };
  });

  const sel =
    rows.find(
      (x) =>
        x.c.type.key === pType &&
        x.c.region === pRegion
    ) || rows[0];

  if (!sel) return null;

  const labels = sel.c.sim.incomes;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          ⑤ 정책 개입 효과 및 추가 지원 비용 분석
        </h2>

        <div className="controls">
          <label className="field-inline small">
            점감 폭
            <select
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            >
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  중위소득 {w}%p
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="hint">
        혜택을 기준선에서 한 번에 끊지 않고 일정 소득 구간에서
        점진적으로 감액하는 가상 정책을 적용합니다.
        현행 제도와 비교하여 복지 절벽 완화 효과와 추가 지원 규모를
        함께 분석합니다.
      </p>

      <div className="stats compact">
        <div className="stat">
          <div className="label">복지 절벽 발생 건수</div>
          <div className="value">
            {before} → {after}
            <small>건</small>
          </div>
          <div className="stat-sub">
            {before - after}건 변화
          </div>
        </div>

        <div className="stat">
          <div className="label">가장 큰 절벽 금액</div>
          <div className="value">
            {man(maxBefore)} → {man(maxAfter)}
            <small>원</small>
          </div>
          <div className="stat-sub">
            {man(maxBefore - maxAfter)}원 감소
          </div>
        </div>

        <div className="stat">
          <div className="label">추가 지원 발생 사례</div>
          <div className="value">
            {affectedCases}
            <small> / {rows.length}건</small>
          </div>
          <div className="stat-sub">
            추가 지원이 발생한 가구·지역 사례
          </div>
        </div>

        <div className="stat">
          <div className="label">추가 지원 평균</div>
          <div className="value">
            {man(avgExtra)}
            <small>원</small>
          </div>
          <div className="stat-sub">
            지원이 발생한 소득 단계 기준
          </div>
        </div>
      </div>

      <div className="stats compact" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="label">가상 추가 지원 규모 합계</div>
          <div className="value">
            {man(totalExtra)}
            <small>원</small>
          </div>
          <div className="stat-sub">
            전체 가상 소득 단계의 지원액 합
          </div>
        </div>

        <div className="stat">
          <div className="label">최대 추가 지원액</div>
          <div className="value">
            {man(maxExtra)}
            <small>원</small>
          </div>
          <div className="stat-sub">
            단일 소득 단계 기준
          </div>
        </div>

        <div className="stat">
          <div className="label">지원 발생 소득 단계</div>
          <div className="value">
            {man(totalSteps)}
            <small>단계</small>
          </div>
          <div className="stat-sub">
            1만 원 단위 가상 소득 구간
          </div>
        </div>

        <div className="stat">
          <div className="label">점감 구간 폭</div>
          <div className="value">
            {man(sel.r.widthEarned)}
            <small>원</small>
          </div>
          <div className="stat-sub">
            선택 가구 기준 근로소득 환산 폭
          </div>
        </div>
      </div>

      <div className="card-head" style={{ marginTop: 24 }}>
        <h3 className="card-title" style={{ margin: 0 }}>
          현행 제도와 정책 적용 후 비교
        </h3>

        <div className="controls">
          <label className="field-inline small">
            가구
            <select
              value={pType}
              onChange={(e) => setPType(e.target.value)}
            >
              {data.analysis_households.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field-inline small">
            지역
            <select
              value={pRegion}
              onChange={(e) => setPRegion(e.target.value)}
            >
              {all.regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="chart-box short">
        <Line
          data={{
            labels,
            datasets: [
              {
                label: "현행: 근로소득 + 혜택",
                data: sel.c.sim.disposable,
                borderColor: "#b0b8c1",
                borderWidth: 2,
                pointRadius: 0,
              },
              {
                label: `정책 적용: 점감 ${width}%p`,
                data: sel.r.disposable,
                borderColor: "#4e5968",
                borderWidth: 2,
                pointRadius: 0,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
              mode: "index",
              intersect: false,
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: {
                  autoSkip: false,
                  maxRotation: 0,
                  callback: (_v, i) =>
                    labels[i] % 500000 === 0
                      ? man(labels[i])
                      : null,
                },
              },
              y: {
                ticks: {
                  callback: (v) => man(v),
                },
              },
            },
            plugins: {
              legend: { position: "bottom" },
              tooltip: {
                callbacks: {
                  title: (its) =>
                    `월 근로소득 ${won(labels[its[0].dataIndex])}`,
                  label: (it) =>
                    ` ${it.dataset.label}: ${won(it.raw)}`,
                },
              },
            },
          }}
        />
      </div>

      <details className="more-table">
        <summary>가구별 · 지역별 상세 결과</summary>
      <h3 className="card-title" style={{ marginTop: 8 }}>가구별 정책 효과 및 추가 지원 규모</h3>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>가구 유형</th>
              <th>지역</th>
              <th>절벽 건수</th>
              <th>최대 절벽 감소</th>
              <th>추가 지원 평균</th>
              <th>최대 추가 지원</th>
              <th>지원 발생 단계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, r, beforeMax, afterMax }) => (
              <tr key={c.type.key + c.region}>
                <td>{c.type.label}</td>
                <td>{c.region}</td>
                <td className="num">
                  {c.cliffs.length} → {r.cliffs.length}
                </td>
                <td className="num">
                  {won(beforeMax - afterMax)}
                </td>
                <td className="num">
                  {won(r.extraAvg)}
                </td>
                <td className="num">
                  {won(r.extraMax)}
                </td>
                <td className="num">
                  {r.extraSteps}단계
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="card-title" style={{ marginTop: 24 }}>
        지역별 정책 효과와 추가 지원 규모
      </h3>

      <div className="chart-box short">
        <Bar
          data={{
            labels: regionRows.map((x) => x.region),
            datasets: [
              {
                label: "현행 절벽",
                data: regionRows.map((x) => x.before),
                backgroundColor: "#e5503c",
                borderRadius: 5,
              },
              {
                label: "정책 적용 후",
                data: regionRows.map((x) => x.after),
                backgroundColor: "#4e5968",
                borderRadius: 5,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
              legend: { position: "bottom" },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { precision: 0 },
              },
            },
          }}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>지역</th>
              <th>절벽 건수</th>
              <th>추가 지원 평균</th>
              <th>지원 발생 단계</th>
            </tr>
          </thead>
          <tbody>
            {regionRows.map((x) => (
              <tr key={x.region}>
                <td>{x.region}</td>
                <td className="num">
                  {x.before} → {x.after}
                </td>
                <td className="num">
                  {won(x.avg)}
                </td>
                <td className="num">{x.steps}단계</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>

      <p className="stat-inline">
        <b>정책 평가:</b> 선택한 점감 폭 {width}%p를 적용하면
        전체 {rows.length}개 사례의 복지 절벽은 {before}건에서
        {` ${after}건으로 `}변화하고, 최대 절벽 금액은
        {` ${won(maxBefore)}에서 ${won(maxAfter)}으로 `}변화합니다.
        가상 소득 단계에서 발생한 추가 지원액 합계는
        {` ${won(totalExtra)}입니다.`}
      </p>

      <p className="hint" style={{ marginTop: 12 }}>
        분석 방법 및 한계: 추가 지원액 합계는 1만 원 단위로
        설정한 가상 소득 단계별 월 지원액을 합산한 값입니다.
        실제 수급 인구와 소득 분포를 반영한 정부 예산이나
        연간 재정 지출액이 아닙니다. 정책 효과 역시 설정한
        가구 조건과 가상 점감 규칙에 따른 시뮬레이션 결과이며,
        실제 정책의 인과효과를 의미하지 않습니다.
      </p>
    </section>
  );
}


function SensitivitySection({ rows }) {
  const top = rows.slice(0, 10);
  const maxEffect = Math.max(
    1,
    ...top.map((item) => Math.abs(item.supportDelta))
  );

  return (
    <section className="card">
      <h2 className="card-title">⑧ 가구 조건 민감도 분석</h2>

      <p className="hint">
        대표 가구의 조건을 한 번에 하나씩 변경하여
        동일한 근로소득에서 복지 지원액과 절벽 발생 변화를 비교합니다.
      </p>

      <div className="stats compact">
        <div className="stat">
          <div className="label">비교 시나리오</div>
          <div className="value">{rows.length}<small>건</small></div>
        </div>
        <div className="stat">
          <div className="label">지원액이 달라진 경우</div>
          <div className="value">
            {rows.filter((r) => r.supportDelta !== 0).length}
            <small>건</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">절벽 수가 달라진 경우</div>
          <div className="value">
            {rows.filter((r) => r.cliffDelta !== 0).length}
            <small>건</small>
          </div>
        </div>
      </div>

      <h3 className="card-title">지원액이 크게 달라지는 조건</h3>

      {top.map((item, index) => (
        <div key={`${item.householdKey}-${item.region}-${item.factor}`}
          style={{ marginBottom: 16 }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            marginBottom: 5,
          }}>
            <b>{index + 1}. {item.factor} <small style={{ fontWeight: 400, color: "var(--muted)" }}>({item.description})</small></b>
            <b style={{
              color: item.supportDelta < 0
                ? "var(--cliff)"
                : "var(--ok)",
            }}>
              {item.supportDelta > 0 ? "+" : ""}
              {man(item.supportDelta)}원
            </b>
          </div>

          <div style={{
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 5,
          }}>
            {item.household} · {item.region}
          </div>

          <div style={{
            height: 9,
            background: "var(--surface-2, #f2f4f6)",
            borderRadius: 10,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.abs(item.supportDelta) / maxEffect * 100}%`,
              height: "100%",
              background: item.supportDelta < 0 ? "var(--red)" : "var(--green)", // 줄어들면 빨강, 늘어나면 초록
              borderRadius: 10,
            }} />
          </div>
        </div>
      ))}

      <details className="more-table">
      <summary>조건별 상세 비교 ({rows.length}건)</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>가구</th>
              <th>지역</th>
              <th>변경 조건</th>
              <th>기존 지원액</th>
              <th>변경 지원액</th>
              <th>지원액 차이</th>
              <th>절벽 수 변화</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.householdKey}-${item.region}-${item.factor}-${index}`}>
                <td>{item.household}</td>
                <td>{item.region}</td>
                <td>{item.factor}</td>
                <td className="num">{won(item.baseSupport)}</td>
                <td className="num">{won(item.changedSupport)}</td>
                <td className="num">
                  {item.supportDelta > 0 ? "+" : ""}
                  {won(item.supportDelta)}
                </td>
                <td className="num">
                  {item.baseCliffs} → {item.changedCliffs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>

      <p className="hint" style={{ marginTop: 16 }}>
        분석 기준: 기준 가구의 기준중위소득 30%에 해당하는 동일한
        근로소득에서 지원액을 비교합니다. 절벽 수는 각 가구의
        중위소득을 기준으로 최대 소득 범위를 설정해 계산합니다.
        조건별 비교는 가상 시나리오이며 실제 정책의 인과효과나
        전체 인구의 평균 효과를 의미하지 않습니다.
      </p>
    </section>
  );
}

function CauseSection({ cases }) {
  const result = summarizeCliffCauses(cases);
  const endingResults = summarizeBenefitEndings(cases);

  return (
    <section className="card">
      <h2 className="card-title">⑥ 복지 절벽 원인 기여도 분석</h2>

      <p className="hint">
        절벽이 발생한 소득 단계에서 각 복지제도의 지원액이 얼마나
        감소했는지 비교합니다. 기여율은 전체 혜택 감소액 중
        해당 제도가 차지하는 비중입니다.
      </p>

      <div className="stats compact">
        <div className="stat">
          <div className="label">분석한 절벽 발생 건수</div>
          <div className="value">
            {result.eventCount}<small>건</small>
          </div>
        </div>

        <div className="stat">
          <div className="label">전체 혜택 감소액 합계</div>
          <div className="value">
            {man(result.totalReduction)}<small>원</small>
          </div>
        </div>

        <div className="stat">
          <div className="label">분석 대상 제도</div>
          <div className="value">
            {result.benefits.length}<small>개</small>
          </div>
        </div>
      </div>

      {result.benefits.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>복지제도</th>
                  <th style={{ textAlign: "right" }}>누적 감소액</th>
                  <th style={{ textAlign: "right" }}>기여율</th>
                  <th style={{ textAlign: "right" }}>감소 발생 횟수</th>
                </tr>
              </thead>
              <tbody>
                {result.benefits.map((item) => (
                  <tr key={item.name}>
                    <td><b>{item.name}</b></td>
                    <td className="num">{won(item.totalReduction)}</td>
                    <td className="num">
                      <b>{pct(item.contributionPct)}</b>
                    </td>
                    <td className="num">{item.occurrences}회</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3 className="card-title">제도별 감소액 기여도</h3>
            {result.benefits.map((item) => (
              <div key={item.name} style={{ marginBottom: 14 }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 5,
                  fontSize: 13,
                }}>
                  <b>{item.name}</b>
                  <span>{pct(item.contributionPct)}</span>
                </div>
                <div style={{
                  height: 10,
                  borderRadius: 10,
                  background: "var(--surface-2, #f2f4f6)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${item.contributionPct}%`,
                    height: "100%",
                    background: "#68ba83",
                    borderRadius: 10,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="empty">분석할 혜택 감소 데이터가 없습니다.</p>
      )}

<details className="more-table" style={{ marginTop: 28 }}>
        <summary>전체 소득 구간별 혜택 자격 상실 빈도</summary>

        <p className="hint">
          대구광역시 북구와 경상북도 경산시의 대표 가구 6종을 대상으로,
          복지 절벽 발생 여부와 관계없이 전체 소득 구간에서
          각 복지제도의 자격이 사라진 횟수를 집계합니다.
        </p>

        {endingResults.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>복지제도</th>
                  <th style={{ textAlign: "right" }}>자격 상실 횟수</th>
                  <th style={{ textAlign: "right" }}>영향 가구 유형 수</th>
                  <th style={{ textAlign: "right" }}>영향 지역 수</th>
                </tr>
              </thead>
              <tbody>
                {endingResults.map((item) => (
                  <tr key={item.name}>
                    <td><b>{item.name}</b></td>
                    <td className="num">{item.frequency}회</td>
                    <td className="num">{item.householdCount}개</td>
                    <td className="num">{item.regionCount}개</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">분석할 자격 상실 데이터가 없습니다.</p>
        )}
      </details>
    </section>
  );
}
function CoLossSection({ cases }) {
  const result = summarizeCoLosses(cases);
  const top = result.combinations.slice(0, 10);

  return (
    <section className="card">
      <h2 className="card-title">⑦ 함께 끊기는 혜택 조합</h2>
      <p>
        복지 절벽 발생 시 함께 자격을 잃는 혜택 조합을 분석합니다.
      </p>

      <div className="stats compact">
        <div className="stat">
          <div className="label">전체 절벽 이벤트</div>
          <div className="value">{man(result.totalEvents)}<small>건</small></div>
        </div>
        <div className="stat">
          <div className="label">2개 이상 동시 탈락</div>
          <div className="value">{man(result.multiLossEvents)}<small>건</small></div>
        </div>
        <div className="stat">
          <div className="label">동시 탈락 이벤트 비율</div>
          <div className="value">{result.multiLossPct.toFixed(1)}<small>%</small></div>
        </div>
      </div>

      <h3>자주 함께 사라지는 혜택 조합</h3>

      {top.length === 0 ? (
        <p>현재 분석 사례에서 동시 탈락 조합이 발견되지 않았습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>순위</th>
                <th>동시 탈락 혜택</th>
                <th>발생 횟수</th>
                <th>발생 비율</th>
                <th>가구 유형 수</th>
                <th>지역 수</th>
              </tr>
            </thead>
            <tbody>
              {top.map((item, index) => (
                <tr key={item.benefits.join("-")}>
                  <td>{index + 1}</td>
                  <td>{item.benefits.join(" + ")}</td>
                  <td>{item.count}회</td>
                  <td>{item.occurrencePct.toFixed(1)}%</td>
                  <td>{item.householdCount}개</td>
                  <td>{item.regionCount}개</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        분석 기준: 시뮬레이션에서 확인된 복지 절벽 이벤트 중
        두 개 이상의 혜택 자격이 동시에 종료된 조합입니다.
        발생 비율은 전체 절벽 이벤트 대비 해당 조합의 발생 비율이며,
        실제 전체 인구의 발생 확률을 의미하지 않습니다.
      </p>
    </section>
  );
}
// ① 가구별 표: 열을 '가구 · 계산 정보 · 변화 결과'로 묶고, 가구 유형별로 접었다 펴기 (처음엔 가구마다 한 줄 요약)
function Summary({ cases }) {
  const maxDrop = Math.max(...cases.map((c) => c.maxCliff?.drop ?? 0));
  const groups = [];
  for (const c of cases) {
    const g = groups.find((x) => x.key === c.type.key);
    if (g) g.items.push(c); else groups.push({ key: c.type.key, label: c.type.label, size: c.size, items: [c] });
  }
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allOpen = open.size === groups.length;
  const lossCell = (v) => (v < 0 ? <span className="loss">−{won(-v)}</span> : `+${won(v)}`);
  return (
    <>
      <div className="an-table-tools">
        <span className="hint">가구를 누르면 지역별 줄이 펼쳐져요. 빨간 금액이 줄어드는 돈이에요.</span>
        <button type="button" className="btn sm" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}>{allOpen ? "모두 접기" : "모두 펼치기"}</button>
      </div>
      <div className="table-wrap"><table className="an-table">
        <thead>
          <tr className="group-head"><th colSpan="2">가구</th><th colSpan="4" className="sep">계산 정보</th><th colSpan="2" className="sep">변화 결과</th></tr>
          <tr><th>가구 유형</th><th>지역</th><th className="sep c">절벽 수</th><th className="r">첫 절벽</th><th className="r">가장 큰 손해 위치</th><th>그때 사라지는 혜택</th>
            <th className="sep r">가장 큰 손해</th><th className="r">10만 원 더 벌 때 최악</th></tr>
        </thead>
        <tbody>{groups.map((g) => {
          const isOpen = open.has(g.key);
          const worstCliff = Math.max(...g.items.map((c) => c.maxCliff?.drop ?? 0));
          const worst = Math.min(...g.items.map((c) => c.worst));
          return [
            <tr key={g.key} className={`group-row ${isOpen ? "open" : ""}`} onClick={() => toggle(g.key)} tabIndex={0} aria-expanded={isOpen}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(g.key); } }}>
              <td><span className="chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span><b>{g.label}</b> <span className="hint">({g.size}인)</span></td>
              <td className="hint">{g.items.length}개 지역</td>
              <td className="sep c num">{g.items.reduce((n, c) => n + c.cliffs.length, 0)}</td>
              <td className="hint" colSpan="3">{isOpen ? "" : "펼쳐서 지역별 계산 정보 보기"}</td>
              <td className={`sep r num ${worstCliff === maxDrop && worstCliff > 0 ? "best" : ""}`}>{worstCliff ? <span className="loss">−{won(worstCliff)}</span> : "-"}</td>
              <td className="r num">{lossCell(worst)}</td>
            </tr>,
            ...(isOpen ? g.items.map((c) => {
              const first = c.cliffs[0], mc = c.maxCliff;
              return (
                <tr key={g.key + c.region} className="sub-row">
                  <td />
                  <td>{c.region}</td>
                  <td className="sep c num">{c.cliffs.length}</td>
                  <td className="r num">{first ? <>{man(first.income)}원 <span className="hint">({pct(first.pct)})</span></> : "-"}</td>
                  <td className="r num">{mc ? <>{man(mc.income)}원 <span className="hint">({pct(mc.pct)})</span></> : "-"}</td>
                  <td>{mc ? mc.lost.join(", ") || "금액 감소" : "-"}</td>
                  <td className={`sep r num ${mc && mc.drop === maxDrop ? "best" : ""}`}>{mc ? <span className="loss">−{won(mc.drop)}</span> : "-"}</td>
                  <td className="r num">{lossCell(c.worst)}</td>
                </tr>
              );
            }) : []),
          ];
        })}</tbody>
      </table></div>
    </>
  );
}

// 큰 묶음 머리말 (01 요약 · 02 상세 데이터 · 03 변화 분석 · 04 근거)
function Group({ id, no, title, desc }) {
  return <div className="an-group" id={id}><span className="an-no">{no}</span><div><h2>{title}</h2><p>{desc}</p></div></div>;
}

// 고정 목차: 지금 보는 구역을 표시
const TOC = [["an-summary", "요약"], ["an-table", "가구별 표"], ["an-curve", "소득 변화"], ["an-change", "변화 분석"], ["an-basis", "계산 근거"]];
function Toc() {
  const [cur, setCur] = useState(TOC[0][0]);
  useEffect(() => {
    const onScroll = () => {
      let at = TOC[0][0];
      for (const [id] of TOC) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 160) at = id; }
      setCur(at);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className="an-toc" aria-label="분석 목차">
      {TOC.map(([id, label]) => <a key={id} href={`#${id}`} className={cur === id ? "on" : ""} aria-current={cur === id ? "true" : undefined}>{label}</a>)}
    </nav>
  );
}

export default function Analysis() {
  const { data, error } = useJson("/data/rules.json");
  const all = useMemo(() => (data ? runAll(data, createEngine(data)) : null), [data]);
  const [moreOpen, setMoreOpen] = useState(false);
  // 민감도 분석은 계산량이 많아 '추가 분석'을 펼칠 때만 계산
  const sensitivityRows = useMemo(
    () => (data && moreOpen ? buildSensitivity(data, createEngine(data)) : []),
    [data, moreOpen]
  );
  const [curveRegion, setCurveRegion] = useState("경상북도 경산시");
  const [curveFocus, setCurveFocus] = useState("single_parent");
  const [emtrType, setEmtrType] = useState("single_parent");
  const [emtrRegion, setEmtrRegion] = useState("경상북도 경산시");

  if (error) return <main className="page"><p className="empty">데이터를 불러오지 못했습니다: {String(error.message)}</p></main>;
  if (!all) return <main className="page"><p className="empty">분석 중…</p></main>;

  const curveCases = all.cases.filter((c) => c.region === curveRegion);
  // 고른 가구는 진하게(맨 위에 그림), 나머지는 연한 회색
  const curveData = { datasets: [...curveCases].sort((a, b) => (a.type.key === curveFocus) - (b.type.key === curveFocus)).map((c) => ({
    label: c.type.label, showLine: true, pointRadius: 0, borderWidth: c.type.key === curveFocus ? 3 : 1.5,
    borderColor: c.type.key === curveFocus ? "#191f28" : "#cfd4da", backgroundColor: c.type.key === curveFocus ? "#191f28" : "#cfd4da",
    data: c.sim.incomes.map((inc, j) => ({ x: (inc / c.m) * 100, y: (c.sim.disposable[j] / c.m) * 100 })),
  })) };

  const NB = RANGE * 20; // 5%p 구간 수
  const buckets = Array.from({ length: NB }, (_, i) => ({ from: i * 5, to: i * 5 + 5, count: 0, names: {} }));
  for (const e of all.cases.flatMap((c) => c.endings)) {
    const b = buckets[Math.min(NB - 1, Math.max(0, Math.ceil(e.pct / 5) - 1))];
    b.count++; b.names[e.name] = (b.names[e.name] || 0) + 1;
  }
  const maxB = Math.max(...buckets.map((b) => b.count));

  const ec = all.cases.find((c) => c.type.key === emtrType && c.region === emtrRegion);
  const eLabels = ec.sim.incomes.slice(0, ec.retained.length);
  const avg = ec.retained.reduce((s, r) => s + r, 0) / ec.retained.length;
  const worstIdx = ec.retained.indexOf(ec.worst);
  // 손해 구간(남는 돈 < 0)에만 연한 주황 배경
  const lossBand = {
    id: "lossBand",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart;
      const half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
      ctx.save(); ctx.fillStyle = "rgba(240, 140, 60, 0.16)";
      ec.retained.forEach((v, i) => { if (v < 0) { const px = x.getPixelForValue(i); ctx.fillRect(px - half, chartArea.top, half * 2, chartArea.bottom - chartArea.top); } });
      ctx.restore();
    },
  };

  return (
    <>
      <main className="page analysis">
        <PageHead title={<>복지 절벽은 <em>누구에게, 어디서</em> 나타날까?</>}
          desc="대표 가구 6개 × 지역 2곳, 12가지 경우를 소득 0원부터 기준중위소득 200%까지 1만 원 단위로 계산했어요." />
        <Toc />
        <Group id="an-summary" no="01" title="요약" desc="분석 결과 한눈에 보기 · 카드를 누르면 자세한 분석으로 이동해요" />
        <Findings all={all} />
        {data.provisional?.length > 0 && <div className="notice">일부 금액({data.provisional.length}개 항목)이 추정값이에요. 금액이 바뀌면 아래 결과도 함께 바뀌어요.</div>}

        <Group id="an-detail" no="02" title="상세 데이터" desc="가구 유형·지역별 계산 결과와 소득별 변화" />
        <section className="card" id="an-table">
          <h2 className="card-title">① 가구 유형 × 지역별 절벽 요약</h2>
          <p className="hint">절벽 = 소득이 1만 원 늘었는데 '근로소득 + 혜택' 합계가 줄어드는 지점.</p>
          <Summary cases={all.cases} />
        </section>
        <section className="card" id="an-curve">
          <div className="card-head">
            <h2 className="card-title">② 가구 유형별 '근로소득 + 혜택' 곡선</h2>
            <div className="controls">
              <label className="field-inline small">강조할 가구 <select value={curveFocus} onChange={(e) => setCurveFocus(e.target.value)}>{data.analysis_households.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label className="field-inline small">지역 <select value={curveRegion} onChange={(e) => setCurveRegion(e.target.value)}>{all.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
            </div>
          </div>
          <p className="chart-desc">소득이 늘 때 실제로 쓸 수 있는 돈이 어떻게 바뀌는지 · 선이 아래로 꺾이는 곳이 절벽이에요</p>
          <p className="hint">고른 가구는 진하게, 나머지 가구는 회색으로 비교해요. 가로·세로 모두 <b>기준중위소득 대비 %</b>예요.</p>
          <div className="chart-box"><Scatter data={curveData} options={{
            responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", intersect: false },
            scales: { x: { min: 0, max: RANGE * 100, title: { display: true, text: "월 근로소득 (기준중위소득 대비 %)" }, ticks: { callback: (v) => `${v}%` } },
              y: { min: 0, title: { display: true, text: "근로소득 + 혜택 (중위소득 대비 %)" }, ticks: { callback: (v) => `${v}%` } } },
            plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: 근로소득 ${it.parsed.x.toFixed(0)}% → 합계 ${it.parsed.y.toFixed(0)}%` } } },
          }} /></div>
        </section>
        <Group id="an-change" no="03" title="변화 분석" desc="혜택이 끊기는 구간, 더 벌 때 남는 돈, 제도 개선 효과와 원인" />
        <section className="card" id="an-ends">
  <h2 className="card-title">③ 혜택이 끊기는 소득 구간 분포</h2>
  <p className="chart-desc">어느 소득 구간에서 혜택이 가장 많이 끊기는지 · 빨간 막대가 가장 많이 몰린 구간이에요</p>
  <p className="hint">12가지 경우에서 각 혜택의 자격이 사라지는 지점을 모아 기준중위소득 대비 5% 구간별로 세었어요.</p>

  <div className="chart-box short">
    <Bar
      data={{
        labels: buckets.map((b) => `${b.from}~${b.to}%`),
        datasets: [{
          label: "혜택이 끊기는 횟수",
          data: buckets.map((b) => b.count),
          backgroundColor: buckets.map((b) => (b.count === maxB ? "#e5503c" : "#c4cad2")),
          borderRadius: 6
        }]
      }}
      plugins={[{
        id: "peakLabel",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            if (buckets[i].count !== maxB) return;
            ctx.save(); ctx.fillStyle = "#c2412d"; ctx.font = "700 12px Pretendard, sans-serif"; ctx.textAlign = "center";
            ctx.fillText(`${maxB}회 · ${buckets[i].from}~${buckets[i].to}%`, bar.x, bar.y - 8);
            ctx.restore();
          });
        },
      }]}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 22 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (its) => `중위소득 ${its[0].label}`, label: (it) => ` 혜택이 끊기는 횟수 ${it.raw}회` } } },
        scales: {
          x: {
            title: {
              display: true,
              text: "월 근로소득 (기준중위소득 대비)"
            },
            ticks: { maxRotation: 0 }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }}
    />
  </div>

  <details className="more-table">
  <summary>구간별 끊기는 혜택 표 보기</summary>
  <div className="table-wrap">
    <table className="an-table">
      <thead>
        <tr>
          <th>구간</th>
          <th style={{ textAlign: "right" }}>횟수</th>
          <th>끊기는 혜택 (횟수)</th>
        </tr>
      </thead>
      <tbody>
        {buckets.filter((b) => b.count).map((b) => (
          <tr key={b.from}>
            <td>{b.from}~{b.to}%</td>
            <td className="num">{b.count}</td>
            <td>
              {Object.entries(b.names)
                .sort((a, c) => c[1] - a[1])
                .map(([n, k]) => `${n} ${k}`)
                .join(", ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  </details>
</section>
        <section className="card" id="an-emtr">
          <div className="card-head">
            <h2 className="card-title">④ 10만 원 더 벌면 실제로 얼마가 남나</h2>
            <div className="controls">
              <label className="field-inline small">가구 <select value={emtrType} onChange={(e) => setEmtrType(e.target.value)}>{data.analysis_households.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label className="field-inline small">지역 <select value={emtrRegion} onChange={(e) => setEmtrRegion(e.target.value)}>{all.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
            </div>
          </div>
          <p className="chart-desc">소득 구간마다 10만 원을 더 벌 때 손에 남는 돈 · 주황 배경이 오히려 손해인 구간이에요</p>
          <p className="hint">점선(10만 원)보다 낮으면 일부를 잃는 것이고, <b style={{ color: "var(--cliff)" }}>0원 아래면 오히려 손해</b>예요.</p>
          <div className="chart-box short"><Line plugins={[lossBand]} data={{ labels: eLabels, datasets: [
            {
              label: "10만 원 더 벌 때 늘어나는 금액",
              data: ec.retained,
              borderWidth: 2,
              pointRadius: 0,
              borderColor: "#4ba468",
              segment: {
                borderColor: (ctx) =>
                  ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0
                    ? "#e5503c"
                    : "#4ba468"
              }
            },
            {
              label: "기준선: 10만 원 그대로",
              data: eLabels.map(() => EXTRA),
              borderColor: "#b0b8c1",
              borderDash: [5, 4],
              borderWidth: 1,
              pointRadius: 0
            },
            {
              label: "0원",
              data: eLabels.map(() => 0),
              borderColor: "#d1d6db",
              borderWidth: 1,
              pointRadius: 0
            },
          ] }} options={{ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
            scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (_v, i) => (eLabels[i] % 500000 === 0 ? man(eLabels[i]) : null) } }, y: { ticks: { callback: (v) => man(v) } } },
            plugins: { legend: { position: "bottom" }, tooltip: { filter: (it) => it.datasetIndex === 0, callbacks: { title: (its) => `월 근로소득 ${won(eLabels[its[0].dataIndex])} → +10만 원`, label: (it) => ` 늘어나는 금액: ${won(it.raw)}` } } } }} /></div>
          <p className="stat-inline">평균적으로 10만 원을 더 벌면 <b>{won(avg)}</b>이 늘어납니다. {ec.worst < 0
            ? <>가장 나쁜 구간은 월 <b>{won(eLabels[worstIdx])}</b>에서 10만 원을 더 벌 때로, 오히려 <b style={{ color: "var(--cliff)" }}>{won(-ec.worst)}</b>이 줄어듭니다.</>
            : <>이 가구에는 손해 구간이 없습니다.</>}</p>
        </section>
        {/* ⑤ 정책 개입 효과 */}
        <div id="an-policy" className="anchor"><PolicySection all={all} data={data} /></div>

        {/* ⑥ 복지 절벽 원인 기여도 */}
        <CauseSection cases={all.cases} />

        {/* ⑦·⑧ 추가 분석: 펼쳤을 때만 */}
        <button type="button" className="more-analysis" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          <span><b>{moreOpen ? "추가 분석 접기" : "추가 분석 더 보기"}</b>
            <small>⑦ 함께 끊기는 혜택 조합 · ⑧ 가구 조건 민감도</small></span>
          <span className={`more-chevron ${moreOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
        </button>
        {moreOpen && <>
          <CoLossSection cases={all.cases} />
          <SensitivitySection rows={sensitivityRows} />
        </>}

        <Group id="an-basis" no="04" title="근거 및 참고 자료" desc="계산 기준과 분석 방법, 한계" />
        <section className="card">
          <details className="basis-fold">
          <summary><span className="card-title">분석 방법과 한계</span><span className="hint">펼쳐 보기</span></summary>
          <div className="method-grid">
            <div><h3>방법</h3><ol>
              <li>복지로 선정기준 원문을 판정 규칙으로 변환 (<code>rules.json</code>)</li>
              <li>가구 유형 6개 × 지역 2곳 = 12가지 경우 설정</li>
              <li>소득 0원 ~ 기준중위소득 200%, 1만 원 단위로 받는 혜택 계산 (기초연금·자녀장려금처럼 중위 100% 위에서 끊기는 혜택 포함)</li>
              <li>'근로소득 + 혜택'이 1,000원 이상 줄어드는 지점을 절벽으로 기록</li>
              <li>같은 계산을 파이썬(<code>analysis/cliff_analysis.py</code>)으로도 실행해 결과 일치 확인</li>
            </ol></div>
            <div><h3>한계</h3><ul>{[...data.assumptions, "가구 유형 6개는 대표 사례이며 모든 가구를 대표하지 않습니다.", "지역은 대구 북구와 경산시 2곳만 분석했습니다."].map((a) => <li key={a}>{a}</li>)}</ul></div>
          </div>
          </details>
        </section>
      </main>
    </>
  );
}
