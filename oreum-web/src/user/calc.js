// 결과 화면에 필요한 계산을 한곳에서 (엔진 결과만 읽음 → engine.js·rules.py와 맞출 필요 없음)
import { analyzeCliffCause } from "../lib/analytics.js";
import { createEngine } from "../lib/engine.js";
import { analyzeCurrentLoss, analyzeNextCliff, recommendPrograms } from "../lib/guide.js";
import { COMPARE_REGIONS, MAX_MEDIAN_MULTIPLE, NAMES, RANGE_MEDIAN_MULTIPLE, STEP } from "./data.js";

// 근로소득공제가 없다고 가정한 엔진 (공제 덕분에 얼마를 더 받는지 보여 주기 위해). 데이터마다 한 번만 만든다
const noDeductionEngines = new WeakMap();
function noDeductionEngine(data) {
  if (!noDeductionEngines.has(data)) {
    const d = structuredClone(data);
    d.params.earned_deduction_rate = 0;
    if (d.params.youth_deduction) d.params.youth_deduction.flat = 0;
    if (d.params.senior_disabled_deduction) d.params.senior_disabled_deduction.flat = 0;
    noDeductionEngines.set(data, createEngine(d));
  }
  return noDeductionEngines.get(data);
}

const sumCounted = (engine, bs, includeInkind) => bs.filter((b) => engine.counted(b, includeInkind)).reduce((s, b) => s + b.monthly, 0);

export function calculate({ engine, data, hh, income, compare, includeInkind }) {
  const m = engine.medianIncome(engine.derive(hh).size);
  // 계산 범위: 기본 중위 200%, 내 소득이 더 크면 소득의 1.2배까지 (단, 중위 3배를 넘지 않게)
  const baseMax = Math.round((m * RANGE_MEDIAN_MULTIPLE) / STEP) * STEP;
  const capMax = Math.round((m * MAX_MEDIAN_MULTIPLE) / STEP) * STEP;
  const maxIncome = income > baseMax ? Math.min(capMax, Math.ceil((income * 1.2) / STEP) * STEP) : baseMax;
  const inc = Math.min(Math.round(income / STEP) * STEP, maxIncome);
  const capped = income > maxIncome;

  const sim = engine.simulate(hh, maxIncome, STEP, includeInkind);
  const at = (v) => Math.min(sim.incomes.length - 1, Math.round(v / STEP));
  const cliffs = engine.findCliffs(sim);
  const benefits = engine.evaluate(hh, inc);
  const total = sumCounted(engine, benefits, includeInkind);
  const nowDisp = inc + total;

  const info = analyzeNextCliff(sim, cliffs, inc);
  const curLoss = analyzeCurrentLoss(sim, cliffs, inc);
  const programs = recommendPrograms(hh, benefits, data.params, inc);

  // 다음 절벽 문장: 지금보다 생활비가 줄면 '지금 대비', 아니면 '바로 전 소득 대비'
  let cliff = null;
  if (info) {
    const cliffDisp = sim.disposable[info.cliff.index];
    const vsNow = nowDisp - cliffDisp;
    const recoverDisp = info.recover != null ? sim.disposable[at(info.recover)] : null;
    const lost = info.lost.length ? info.lost : ["일부 혜택"];
    const raw = analyzeCliffCause(sim, info.cliff, Object.entries(NAMES).map(([id, name]) => ({ id, name })));
    cliff = {
      income: info.cliff.income, lost, drop: info.cliff.drop,
      vsNow: vsNow > 0 ? vsNow : null, // 지금보다 줄어드는 생활비
      before: info.cliff.income - STEP,
      recover: info.recover, recoverBetter: recoverDisp != null && recoverDisp > nowDisp,
      causes: raw.causes.filter((c) => c.reduction >= 1000),
      kept: info.kept, gained: info.gained, // 절벽을 넘어도 계속 받는 혜택 / 넘으면 새로 생기는 혜택 (수급 자격 연쇄 변동)
    };
  }

  // 넘는 방법에 보여 줄 금액
  // - 근로소득공제 덕분에 지금 더 받는 돈 (공제가 없다면 받았을 혜택과의 차이)
  // - 다시 늘어나는 소득(없으면 절벽 소득)에서도 계속 받는 근로·자녀장려금
  const e0 = noDeductionEngine(data);
  const deductionGain = income > 0 ? Math.max(0, total - sumCounted(e0, e0.evaluate(hh, inc), includeInkind)) : 0;
  const creditAt = (v) => engine.evaluate(hh, v).filter((b) => b.id === "eitc" || b.id === "ctc").reduce((s, b) => s + b.monthly, 0);
  // 소득 길에 보여 주는 소득과 같은 기준: 지금 줄어든 구간이면 그 회복 소득, 아니면 다음 절벽의 회복 소득
  const afterIncome = curLoss ? (curLoss.recover ?? null) : info ? (info.recover ?? info.cliff.income) : null;
  const creditAfter = afterIncome != null ? creditAt(afterIncome) : 0;
  const gains = { deductionGain, afterIncome, creditAfter };

  // 지역 비교
  const compareKeys = [hh.region, ...COMPARE_REGIONS.filter((k) => k !== hh.region && data.regions[k])];
  const regions = compareKeys.map((r) => {
    const h2 = { ...hh, region: r };
    const bs = engine.evaluate(h2, inc);
    const s2 = engine.simulate(h2, maxIncome, STEP, includeInkind);
    return { region: r, total: sumCounted(engine, bs, includeInkind), cliffs: engine.findCliffs(s2) };
  });

  // 비교 소득
  const cmp = Math.min(Math.round((compare ?? inc) / STEP) * STEP, maxIncome);
  const cmpBenefits = cmp === inc ? benefits : engine.evaluate(hh, cmp);
  const cmpTotal = sumCounted(engine, cmpBenefits, includeInkind);
  const baseNames = new Set(benefits.map((b) => b.name)), cmpNames = new Set(cmpBenefits.map((b) => b.name));
  const diff = {
    disp: cmp + cmpTotal - nowDisp,
    lost: [...baseNames].filter((n) => !cmpNames.has(n)),
    gained: [...cmpNames].filter((n) => !baseNames.has(n)),
  };

  return { m, maxIncome, inc, capped, sim, cliffs, benefits, total, nowDisp, info, curLoss, cliff, programs, gains, regions, cmp, cmpTotal, diff };
}
