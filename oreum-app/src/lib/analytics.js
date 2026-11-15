/**
 * 복지 절벽 분석 지표
 * 엔진에서 계산한 혜택 금액과 자격 데이터를 활용한다.
 */

/**
 * 기존 절벽 요약
 */
export function summarizeCliffs(cliffs) {
  const count = cliffs.length;

  if (count === 0) {
    return {
      count: 0,
      totalDrop: 0,
      avgDrop: 0,
      maxCliff: null,
      benefitLossCounts: [],
    };
  }

  const totalDrop = cliffs.reduce((sum, cliff) => sum + cliff.drop, 0);

  const maxCliff = cliffs.reduce(
    (best, cliff) => cliff.drop > best.drop ? cliff : best,
    cliffs[0]
  );

  const benefitCounts = {};

  cliffs.forEach((cliff) => {
    (cliff.lost || []).forEach((name) => {
      benefitCounts[name] = (benefitCounts[name] || 0) + 1;
    });
  });

  const benefitLossCounts = Object.entries(benefitCounts)
    .map(([name, frequency]) => ({ name, frequency }))
    .sort((a, b) => b.frequency - a.frequency);

  return {
    count,
    totalDrop,
    avgDrop: Math.round(totalDrop / count),
    maxCliff,
    benefitLossCounts,
  };
}

/**
 * 특정 절벽 발생 지점에서 제도별 지원액 감소를 분해한다.
 *
 * contributionPct는 전체 혜택 감소액 중 해당 제도의 비율이다.
 * 실제 가처분소득 감소에 대한 통계적 인과효과를 의미하지 않는다.
 */
export function analyzeCliffCause(sim, cliff, benefits = []) {
  const index = cliff.index;

  if (index <= 0 || index >= sim.incomes.length) {
    return {
      income: cliff.income,
      totalBenefitReduction: 0,
      causes: [],
      eligibilityOnlyLosses: cliff.lost || [],
    };
  }

  const namesById = Object.fromEntries(
    benefits.map((benefit) => [benefit.id, benefit.name])
  );

  const causes = Object.entries(sim.series)
    .map(([id, amounts]) => {
      const before = amounts[index - 1] || 0;
      const after = amounts[index] || 0;
      const reduction = Math.max(0, before - after);

      return {
        id,
        name: namesById[id] || id,
        before,
        after,
        reduction,
      };
    })
    .filter((item) => item.reduction > 0)
    .sort((a, b) => b.reduction - a.reduction);

  const totalBenefitReduction = causes.reduce(
    (sum, item) => sum + item.reduction,
    0
  );

  const lostNames = new Set(cliff.lost || []);
  const monetaryLossNames = new Set(causes.map((item) => item.name));

  const eligibilityOnlyLosses = [...lostNames].filter(
    (name) => !monetaryLossNames.has(name)
  );

  return {
    income: cliff.income,
    totalBenefitReduction,
    causes: causes.map((item) => ({
      ...item,
      contributionPct: totalBenefitReduction > 0
        ? (item.reduction / totalBenefitReduction) * 100
        : 0,
    })),
    eligibilityOnlyLosses,
  };
}

/**
 * 여러 가구·지역의 절벽 원인 기여도를 통합한다.
 */
export function summarizeCliffCauses(cases) {
  const totals = new Map();
  let eventCount = 0;

  for (const scenario of cases) {
    for (const cliff of scenario.cliffCauses || []) {
      eventCount++;

      for (const cause of cliff.causes) {
        const current = totals.get(cause.name) || {
          name: cause.name,
          totalReduction: 0,
          occurrences: 0,
        };

        current.totalReduction += cause.reduction;
        current.occurrences += 1;
        totals.set(cause.name, current);
      }
    }
  }

  const totalReduction = [...totals.values()].reduce(
    (sum, item) => sum + item.totalReduction,
    0
  );

  return {
    eventCount,
    totalReduction,
    benefits: [...totals.values()]
      .map((item) => ({
        ...item,
        contributionPct: totalReduction > 0
          ? (item.totalReduction / totalReduction) * 100
          : 0,
      }))
      .sort((a, b) => b.totalReduction - a.totalReduction),
  };
}

/**
 * 복지 혜택 동시 탈락 조합 분석
 * 각 복지 절벽 이벤트에서 함께 사라진 혜택의 조합을 집계한다.
 */
export function summarizeCoLosses(cases) {
  const pairMap = new Map();
  const eventMap = new Map();
  let totalEvents = 0;
  let multiLossEvents = 0;

  for (const scenario of cases) {
    for (const cliff of scenario.cliffs || []) {
      totalEvents++;

      const lost = [...new Set(cliff.lost || [])].sort();

      if (lost.length >= 2) {
        multiLossEvents++;
      }

      for (let i = 0; i < lost.length; i++) {
        for (let j = i + 1; j < lost.length; j++) {
          const key = JSON.stringify([lost[i], lost[j]]);

          if (!pairMap.has(key)) {
            pairMap.set(key, {
              benefits: [lost[i], lost[j]],
              count: 0,
              households: new Set(),
              regions: new Set(),
            });
          }

          const item = pairMap.get(key);
          item.count++;
          item.households.add(scenario.type);
          item.regions.add(scenario.region);
        }
      }
    }
  }

  const combinations = [...pairMap.values()]
    .map((item) => ({
      benefits: item.benefits,
      count: item.count,
      householdCount: item.households.size,
      regionCount: item.regions.size,
      occurrencePct: totalEvents
        ? (item.count / totalEvents) * 100
        : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEvents,
    multiLossEvents,
    multiLossPct: totalEvents
      ? (multiLossEvents / totalEvents) * 100
      : 0,
    combinations,
  };
}
