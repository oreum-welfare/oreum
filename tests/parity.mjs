// 엔진 일치 검사 2단계: JS 엔진 결과를 파이썬 결과(tests/py_out.json)와 비교한다.
// 실행: python tests/parity_py.py && node tests/parity.mjs
// 확인하는 것: 테스트 가구마다 소득 구간별 가처분소득과 절벽 위치가 파이썬과 같은지
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createEngine } = await import(pathToFileURL(join(root, "oreum-app/src/lib/engine.js")));
const eng = createEngine(JSON.parse(readFileSync(join(root, "data/rules.json"), "utf8")));
const cases = JSON.parse(readFileSync(join(root, "tests/cases.json"), "utf8"));
const py = JSON.parse(readFileSync(join(root, "tests/py_out.json"), "utf8"));
const map = { spouse_65: "spouse65", dual_earner: "dualEarner", birth_order: "birthOrder", single_parent: "singleParent", third_child_7to18: "thirdChild7to18", residence_months: "residenceMonths", severe_disabled: "severeDisabled", housing_asset: "housingAsset", financial_asset: "financialAsset" };

let bad = 0;
cases.forEach((c, i) => {
  const hh = { region: "경상북도 경산시", age: 40, spouse: false, spouse65: false, dualEarner: false, infants: 0, elem: 0, middle: 0, high: 0, newborn: false, birthOrder: 1, disabled: false, severeDisabled: false, singleParent: false, thirdChild7to18: false, residenceMonths: 60 };
  for (const [k, v] of Object.entries(c)) hh[map[k] ?? k] = v;
  const mx = Math.round(eng.medianIncome(eng.derive(hh).size) / 10000) * 10000;
  const sim = eng.simulate(hh, mx);
  const cl = eng.findCliffs(sim).map((x) => [x.income, x.lost]);
  const sameLen = sim.disposable.length === py[i].disp.length;
  const maxDiff = sameLen ? Math.max(...sim.disposable.map((v, j) => Math.abs(v - py[i].disp[j]))) : Infinity;
  const sameCliffs = JSON.stringify(cl) === JSON.stringify(py[i].cliffs.map((x) => [x[0], x[2]]));
  const ok = maxDiff < 0.01 && sameCliffs;
  if (!ok) bad++;
  console.log(`가구 ${i + 1}: ${ok ? "일치" : "불일치"} (구간 ${sim.disposable.length}개, 최대 차이 ${maxDiff.toFixed(4)}원, 절벽 ${cl.length}개)`);
});
if (bad) {
  console.error(`${bad}개 가구에서 JS와 파이썬 결과가 다릅니다. oreum-app/src/lib/engine.js와 rules.py를 함께 고쳤는지 확인하세요.`);
  process.exit(1);
}
console.log(`모두 일치: 테스트 가구 ${cases.length}개`);
