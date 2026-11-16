// 자립 경로 안내: 시뮬레이션 결과로 '다음 절벽'까지의 거리, 손해를 만회하는 소득, 이 가구에 맞는 제도를 계산한다.
// 계산 엔진(engine.js)의 결과만 읽으므로 rules.py와 맞출 필요는 없다.

// 다음 절벽 분석
export function analyzeNextCliff(sim, cliffs, income) {
  const next = cliffs.find((c) => c.income > income);
  if (!next) return null;
  const before = sim.disposable[next.index - 1]; // 절벽 직전의 '근로소득 + 혜택'
  let recover = null;
  for (let j = next.index; j < sim.incomes.length; j++) {
    if (sim.disposable[j] >= before) { recover = sim.incomes[j]; break; }
  }
  const prev = sim.elig[next.index - 1], after = sim.elig[next.index];
  // 절벽 너머: 그다음 절벽 직전(없으면 기준중위소득 100%)까지 오르면 지금보다 얼마나 나아지나
  const nowIdx = Math.min(sim.incomes.length - 1, Math.round(income / sim.step));
  const following = cliffs.find((c) => c.income > (recover ?? next.income));
  const hIdx = following ? following.index - 1 : sim.incomes.length - 1;
  const horizon = { income: sim.incomes[hIdx], gain: sim.disposable[hIdx] - sim.disposable[nowIdx], beforeNextCliff: Boolean(following) };
  return {
    horizon,
    cliff: next,
    gap: next.income - income,              // 지금부터 절벽까지 더 벌 수 있는 금액
    before,
    recover,                                // 절벽 직전 수준을 되찾는 월 근로소득 (없으면 null)
    lossSpan: recover != null ? recover - next.income : null, // 일을 더 해도 절벽 직전보다 못한 구간의 폭
    lost: [...prev].filter((n) => !after.has(n)),
    gained: [...after].filter((n) => !prev.has(n)),
    kept: [...prev].filter((n) => after.has(n)),
  };
}

// 지금 손해 구간에 있는지: 이미 지나온 절벽 가운데, 절벽 직전 수준을 아직 되찾지 못한 것
// (다음 절벽만 보면 '지금 손해 중'인 경우를 놓친다)
export function analyzeCurrentLoss(sim, cliffs, income) {
  const idx = Math.min(sim.incomes.length - 1, Math.round(income / sim.step));
  const now = sim.disposable[idx];
  let worst = null;
  for (const c of cliffs) {
    if (c.index > idx) break;
    const before = sim.disposable[c.index - 1];
    if (now < before && (!worst || before > worst.before)) worst = { cliff: c, before };
  }
  if (!worst) return null;
  let recover = null;
  for (let j = idx + 1; j < sim.incomes.length; j++) {
    if (sim.disposable[j] >= worst.before) { recover = sim.incomes[j]; break; }
  }
  return { ...worst, shortfall: worst.before - now, recover, beforeIncome: sim.incomes[worst.cliff.index - 1] };
}

// 이 가구에 맞는 자립 지원 제도 (조건이 맞는 것만)
// 세부 조건·금액은 해마다 바뀌므로 '대상'과 '무엇을 하는지'만 안내하고 신청 전 확인을 권한다.
export function recommendPrograms(hh, benefits, params, income) {
  const has = (id) => benefits.some((b) => b.id === id);
  const saengMedical = has("saeng") || has("medical");
  const recipient = saengMedical || has("jugeo") || has("edu");
  const nearPoor = !recipient && has("munhwa"); // 문화누리카드 = 수급자·차상위 → 수급자가 아니면 차상위
  const out = [];

  if (recipient && income > 0) {
    const yd = params.youth_deduction, sd = params.senior_disabled_deduction;
    let flat = 0, who = "";
    if (yd && hh.age <= yd.age_max) { flat = yd.flat; who = `만 ${yd.age_max}세 이하`; }
    else if (sd && (hh.age >= sd.age_min || hh.disabled || hh.severeDisabled)) { flat = sd.flat; who = "65세 이상·장애인"; }
    const excluded = Math.min(income, flat) + params.earned_deduction_rate * Math.max(0, income - flat);
    out.push({
      key: "deduction", title: "근로소득공제",
      why: `지금 소득 ${Math.round(income / 10000)}만 원 중 약 ${Math.round(excluded / 10000)}만 원은 소득인정액 계산에서 빠집니다.`,
      what: flat
        ? `${who}는 월 ${flat / 10000}만 원을 먼저 빼고, 나머지의 ${params.earned_deduction_rate * 100}%를 더 뺍니다. 그래서 실제 소득이 기준선보다 높아도 수급 자격이 유지될 수 있습니다.`
        : `근로·사업소득의 ${params.earned_deduction_rate * 100}%를 빼고 소득인정액을 계산합니다. 그래서 실제 소득이 기준선보다 높아도 수급 자격이 유지될 수 있습니다.`,
      where: "자동 적용 (2026 기초생활보장 사업안내)",
    });
  }
  if (saengMedical && income > 0) {
    out.push({
      key: "hope1", title: "희망저축계좌Ⅰ",
      why: "생계·의료급여를 받으면서 일하고 있는 가구가 대상입니다.",
      what: "매달 저축하면 정부가 근로소득장려금을 더 쌓아 주고, 정해진 기간 안에 탈수급하면 모은 돈을 받습니다. 절벽을 넘은 뒤의 손해를 메우는 데 쓸 수 있습니다.",
      where: "읍면동 행정복지센터 · 복지로",
    });
  }
  if (((recipient && !saengMedical) || nearPoor) && income > 0) { // 일하는 가구 대상
    out.push({
      key: "hope2", title: "희망저축계좌Ⅱ",
      why: recipient ? "주거·교육급여를 받는 일하는 가구가 대상입니다." : "차상위계층의 일하는 가구가 대상입니다.",
      what: "매달 저축하면 정부가 같은 금액을 더해 주고, 교육·자격 요건을 채우면 모은 돈을 받습니다.",
      where: "읍면동 행정복지센터 · 복지로",
    });
  }
  if (hh.age >= 19 && hh.age <= 34 && income > 0) {
    out.push({
      key: "youth", title: "청년내일저축계좌",
      why: `본인이 만 ${hh.age}세로 일하는 청년입니다.`,
      what: "매달 저축하면 정부가 지원금을 더해 줍니다. 수급자·차상위 청년은 지원금이 더 많습니다. 소득·재산 기준이 있으니 신청 전에 확인하세요.",
      where: "복지로 온라인 신청 · 읍면동 행정복지센터",
    });
  }
  if ((recipient || nearPoor) && hh.age >= 18 && hh.age < 65) {
    out.push({
      key: "jahwal", title: "자활사업",
      why: "수급자·차상위 가구는 지역자활센터의 일자리·창업 지원을 받을 수 있습니다.",
      what: "자활근로로 일 경험과 소득을 얻으면서 자립 계획을 함께 세웁니다. 절벽을 넘는 시기와 방법을 상담하기 좋은 곳입니다.",
      where: "지역자활센터",
    });
  }
  if (has("gs_loan")) {
    out.push({
      key: "gsloan", title: "경산시 저소득주민생활안정자금",
      why: "수급 자격이 있을 때만 신청할 수 있는 무이자 융자입니다. 탈수급하면 자격이 없어집니다.",
      what: "전세보증금·사업자금·학자금 등을 최대 1,200만 원까지 빌릴 수 있습니다. 자립 준비에 필요하면 탈수급 전에 상담하세요.",
      where: "경산시 읍면동 행정복지센터",
    });
  }
  if (has("eitc") || has("ctc")) {
    out.push({
      key: "eitc", title: "근로·자녀장려금",
      why: "수급 자격과 상관없이 근로소득 구간으로 받는 현금이라, 절벽을 넘어도 이어서 받을 수 있습니다.",
      what: "전년도 소득을 기준으로 해마다 신청해서 받습니다. 놓치지 않도록 5월 정기 신청을 챙기세요.",
      where: "국세청 홈택스·손택스",
    });
  }
  return out;
}
