// 엔진 기대값 검사: 팀원 테스트에서 발견된 경우들이 다시 틀리지 않는지 확인한다.
// 실행: node tests/engine_checks.mjs
// (parity 검사는 JS와 파이썬이 '서로 같은지'만 보므로, 둘 다 같이 틀리는 경우는 여기서 잡는다)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createEngine } = await import(pathToFileURL(join(root, "oreum-app/src/lib/engine.js")));
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

if (bad) {
  console.error(`${bad}개 검사 실패`);
  process.exit(1);
}
console.log("엔진 기대값 검사 모두 통과");
