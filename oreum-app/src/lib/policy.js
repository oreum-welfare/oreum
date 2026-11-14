// 제도 개선 시뮬레이션: 혜택을 기준선에서 한 번에 끊지 않고, 기준선 위 일정 구간에서 서서히 줄이면(점감) 절벽이 어떻게 되는지 계산한다.
// 현행 계산(engine.simulate) 결과를 바꿔 보는 가상 시나리오이며, 실제 제도가 아니다.
//
// 방법: 어떤 혜택이 소득 i에서 끊기면(직전 금액 A > 0, i에서 0), 그 뒤 K단계 동안 A를 직선으로 0까지 줄인다.
// K = 점감 폭(소득인정액 기준 중위소득 widthPct %p)을 근로소득으로 바꾼 값 ÷ 소득 단계.
// 근로소득 30% 공제 때문에 소득인정액 1원 = 근로소득 1/(1-0.3)원.

export function taperSimulation(sim, median, widthPct, deductionRate = 0.3) {
  const step = sim.step;
  const widthEarned = (widthPct / 100) * median / (1 - deductionRate);
  const K = Math.max(1, Math.round(widthEarned / step));
  const n = sim.incomes.length;
  const series = {};
  let extraSum = 0, extraSteps = 0;
  const extraAt = new Array(n).fill(0);

  for (const [id, arr] of Object.entries(sim.series)) {
    const out = arr.slice();
    for (let i = 1; i < n; i++) {
      if (arr[i - 1] > 0 && arr[i] === 0) {
        const A = arr[i - 1];
        for (let k = 0; k < K && i + k < n; k++) {
          if (arr[i + k] > 0) break; // 혜택이 다시 생기면 점감 중단
          const v = A * (1 - (k + 1) / (K + 1));
          if (v > out[i + k]) { extraAt[i + k] += v - out[i + k]; out[i + k] = v; }
        }
      }
    }
    series[id] = out;
  }
  const disposable = sim.incomes.map((inc, j) => inc + Object.values(series).reduce((s, a) => s + a[j], 0));
  for (const e of extraAt) if (e > 0) { extraSum += e; extraSteps++; }

  const cliffs = [];
  for (let i = 1; i < n; i++) {
    const drop = disposable[i - 1] - disposable[i];
    if (drop >= 1000) cliffs.push({ index: i, income: sim.incomes[i], drop });
  }
  return {
    disposable, cliffs, K, widthEarned,
    extraAvg: extraSteps ? extraSum / extraSteps : 0, // 점감 구간에서 늘어나는 지원의 평균 (월)
    extraMax: Math.max(0, ...extraAt),
  };
}
