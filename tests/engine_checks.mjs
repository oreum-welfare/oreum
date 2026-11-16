// 엔진 기대값 검사: 팀원 테스트에서 발견된 경우들이 다시 틀리지 않는지 확인한다.
// 실행: node tests/engine_checks.mjs
// (parity 검사는 JS와 파이썬이 '서로 같은지'만 보므로, 둘 다 같이 틀리는 경우는 여기서 잡는다)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createEngine } = await import(pathToFileURL(join(root, "oreum-app/src/lib/engine.js")));
const { analyzeCurrentLoss, recommendPrograms } = await import(pathToFileURL(join(root, "oreum-app/src/lib/guide.js")));
const data = JSON.parse(readFileSync(join(root, "data/rules.json"), "utf8"));
const eng = createEngine(data);
const P = data.params;

const BASE = { region: "경상북도 경산시", age: 40, spouse: false, spouse65: false, dualEarner: false, infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1, disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60 };
const hh = (patch) => ({ ...BASE, ...patch });
const amount = (h, earned, id) => eng.evaluate(h, earned).find((b) => b.id === id)?.monthly ?? 0;

let bad = 0;
const check = (name, ok, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "통과" : "실패"}: ${name}${detail ? ` (${detail})` : ""}`);
};

// 1. 기초연금: 배우자만 65세 이상이어도 배우자가 받는다 (본인만 65세인 경우와 같은 금액)
{
  const spouseOnly = amount(hh({ age: 60, spouse: true, spouse65: true }), 0, "basic_pension");
  const selfOnly = amount(hh({ age: 65, spouse: true, spouse65: false }), 0, "basic_pension");
  const both = amount(hh({ age: 70, spouse: true, spouse65: true }), 0, "basic_pension");
  check("기초연금 - 배우자만 65세 이상", spouseOnly === P.basic_pension_amount && spouseOnly === selfOnly, `배우자만 ${spouseOnly}, 본인만 ${selfOnly}`);
  check("기초연금 - 부부 모두 65세 이상은 각 20% 감액", Math.abs(both - 2 * P.basic_pension_amount * (1 - P.basic_pension_couple_cut)) < 1, `${both}`);
}

// 2. 근로장려금 재산 요건: 정확히 1억7천만 원이면 50%
{
  const limit = P.assets.eitc.half_from;
  const under = amount(hh({ age: 35, elem: 1, financialAsset: limit - 1 }), 1500000, "eitc");
  const at = amount(hh({ age: 35, elem: 1, financialAsset: limit }), 1500000, "eitc");
  check("근로장려금 - 재산 1억7천만 원부터 50%", under > 0 && Math.abs(at - under / 2) < 1, `1억6999만 ${Math.round(under)}원 → 1억7천만 ${Math.round(at)}원`);
}

// 3. 배우자가 있으면 한부모 혜택은 계산하지 않는다 (둘 다 체크해도)
{
  const both = eng.evaluate(hh({ age: 35, spouse: true, singleParent: true, elem: 1 }), 0).map((b) => b.id);
  check("배우자 + 한부모 동시 선택 시 한부모 아동양육비 없음", !both.includes("sp_child"), both.includes("sp_child") ? "sp_child 계산됨" : "");
}

// 4. 자녀 수에 소수·음수·빈 값이 들어와도 NaN이 나오지 않는다
{
  for (const v of [0.5, -1, "", undefined]) {
    const h = hh({ elem: v });
    const m = eng.medianIncome(eng.derive(h).size);
    const total = eng.evaluate(h, 0).reduce((s, b) => s + b.monthly, 0);
    check(`자녀 수 ${JSON.stringify(v)} 입력`, Number.isFinite(m) && Number.isFinite(total), `중위소득 ${m}, 혜택 합계 ${Math.round(total)}`);
  }
}

// 5. 출생 순위 0 등 잘못된 값도 오류 없이 계산 (1~4로 정리)
{
  let ok = true, gs = 0;
  try { gs = amount(hh({ infants: 1, newborn: true, birthOrder: 0 }), 0, "gs_birth"); } catch { ok = false; }
  check("출생 순위 0 입력 시 오류 없음 (첫째로 계산)", ok && gs === amount(hh({ infants: 1, newborn: true, birthOrder: 1 }), 0, "gs_birth"), `${gs}`);
}

// 6. 셋째 이상 자녀(7~18세)는 자녀 3명 이상 + 초·중·고 자녀가 있을 때만
{
  const noKids = eng.evaluate(hh({ thirdChild7to18: true }), 0).some((b) => b.id === "gs_multichild");
  const three = eng.evaluate(hh({ thirdChild7to18: true, elem: 1, middle: 1, high: 1 }), 0).some((b) => b.id === "gs_multichild");
  check("자녀 없이 '셋째 이상' 체크 시 다자녀 지원 없음, 3자녀면 있음", !noKids && three);
}

// 7. 7인 이상 가구: 가구원 수가 6으로 고정되지 않고, 기준중위소득이 6인보다 큼
{
  const seven = hh({ spouse: true, elem: 3, middle: 1, high: 1 });
  const six = hh({ spouse: true, elem: 2, middle: 1, high: 1 });
  const s7 = eng.derive(seven).size, m7 = eng.medianIncome(s7), m6 = eng.medianIncome(eng.derive(six).size), m5 = eng.medianIncome(5);
  check("7인 가구 가구원 수 7, 중위소득 = 6인 + (6인 − 5인)", s7 === 7 && Math.abs(m7 - (m6 + (m6 - m5))) <= 2, `7인 ${m7}, 6인 ${m6}`);
  check("7인 가구 계산에 NaN 없음", eng.evaluate(seven, 0).every((b) => Number.isFinite(b.monthly)));
}

// 8. 지금 손해 구간: 절벽을 막 지난 소득이면 '지금 손해 구간'으로 판정
{
  const sp = hh({ age: 38, singleParent: true, elem: 1, middle: 1 });
  const sim = eng.simulate(sp, 6000000);
  const cl = eng.findCliffs(sim);
  const just = analyzeCurrentLoss(sim, cl, cl[0].income);
  const before = analyzeCurrentLoss(sim, cl, cl[0].income - 10000);
  check("절벽 직후는 '지금 손해 구간', 절벽 직전은 아님", Boolean(just) && just.shortfall > 0 && !before, just ? `${Math.round(just.shortfall)}원 적음, 회복 ${just.recover}` : "");
}

// 9. 희망저축계좌Ⅱ는 근로소득이 있을 때만 추천
{
  let zeroHope2 = false;
  for (const p of [{ age: 45, spouse: true, elem: 2 }, { age: 40, financialAsset: 60000000 }, { age: 30, housingAsset: 100000000 }]) {
    const h2 = hh(p);
    if (recommendPrograms(h2, eng.evaluate(h2, 0), data.params, 0).some((x) => x.key === "hope2")) zeroHope2 = true;
  }
  check("근로소득 0원이면 희망저축계좌Ⅱ 추천 없음", !zeroHope2);
}

// 10. 주거급여가 0원으로 계산되면 목록에 없고 수급자로도 보지 않음 (대가족 경계 소득까지 전 구간 확인)
{
  let zero = 0;
  for (const p of [{ spouse: true, elem: 4, middle: 1, high: 1 }, { spouse: true, elem: 5, middle: 2, high: 1 }, {}]) {
    const h2 = hh(p);
    const sim = eng.simulate(h2, Math.round(eng.medianIncome(eng.derive(h2).size) / 10000) * 10000);
    for (const inc of sim.incomes) if (eng.evaluate(h2, inc).some((b) => b.id === "jugeo" && b.monthly <= 0)) zero++;
  }
  check("주거급여 0원 항목이 나오지 않음", zero === 0, `${zero}건`);
}

// 11. 경산 다자녀: 고등학생만 있으면 16~18세 금액(연 100만 원), 초·중학생이 있으면 7~15세(연 50만 원)
{
  const highOnly = amount(hh({ thirdChild7to18: true, high: 3 }), 0, "gs_multichild");
  const mixed = amount(hh({ thirdChild7to18: true, elem: 1, middle: 1, high: 1 }), 0, "gs_multichild");
  check("다자녀 지원 연령대별 금액", Math.round(highOnly * 12) === P.gs_multichild_annual["16-18"] && Math.round(mixed * 12) === P.gs_multichild_annual["7-15"], `고등만 ${Math.round(highOnly)}원/월, 혼합 ${Math.round(mixed)}원/월`);
}

// 12. 65세 이상 중증장애인 + 기초연금 수급: 장애인연금 부가급여 계속
{
  const elder = amount(hh({ age: 70, severeDisabled: true }), 0, "dis_pension");
  const elderMild = amount(hh({ age: 70, disabled: true }), 0, "dis_pension");
  check("65세 이상 중증장애인은 부가급여, 경증은 없음", elder > 0 && elderMild === 0, `중증 ${elder}원, 경증 ${elderMild}원`);
}

// 13. 음수 재산·부채, 영유아 0명인데 '올해 출산'은 정리
{
  const neg = eng.evaluate(hh({ housingAsset: -50000000, financialAsset: -1, debt: -30000000 }), 0).reduce((s2, b) => s2 + b.monthly, 0);
  const zero = eng.evaluate(hh({}), 0).reduce((s2, b) => s2 + b.monthly, 0);
  check("음수 재산·부채는 0원으로 계산", Math.abs(neg - zero) < 1, `${Math.round(neg)} vs ${Math.round(zero)}`);
  const birthNoKid = eng.evaluate(hh({ newborn: true, infants: 0 }), 0).some((b) => b.id === "gs_birth");
  check("영유아 0명이면 출산장려금 없음", !birthNoKid);
}

// 14. 출생 순위는 자녀 수를 넘지 않음 (셋째로 골라도 자녀가 1명이면 첫째로 계산)
{
  const third1 = amount(hh({ infants: 1, newborn: true, birthOrder: 3 }), 0, "gs_birth");
  const first1 = amount(hh({ infants: 1, newborn: true, birthOrder: 1 }), 0, "gs_birth");
  const third3 = amount(hh({ infants: 1, elem: 2, newborn: true, birthOrder: 3 }), 0, "gs_birth");
  check("출생 순위 > 자녀 수면 자녀 수에 맞춰 계산, 자녀 3명이면 셋째 금액", third1 === first1 && third3 > first1, `자녀1·셋째 ${third1}, 자녀3·셋째 ${third3}`);
}

if (bad) {
  console.error(`${bad}개 검사 실패`);
  process.exit(1);
}
console.log("엔진 기대값 검사 모두 통과");
