// 시뮬레이터 입력값 ↔ 주소(쿼리)
// 새로고침해도 결과가 남고, 주소를 복사하면 같은 화면을 공유할 수 있다. 개인 식별 정보는 담지 않는다.

// 예전 링크와 호환: 시범 지역 2곳은 짧은 코드, 그 밖의 지역은 "시도 시군구" 이름을 그대로 쓴다
const REGION_CODE = { "경상북도 경산시": "gs", "대구광역시 북구": "bk" };
const CODE_REGION = Object.fromEntries(Object.entries(REGION_CODE).map(([k, v]) => [v, k]));

// [hh 키, 쿼리 키, 종류]
const FIELDS = [
  ["age", "age", "int"], ["spouse", "sp", "bool"], ["spouse65", "s65", "bool"], ["dualEarner", "dual", "bool"],
  ["infants", "inf", "int"], ["elem", "el", "int"], ["middle", "mi", "int"], ["high", "hi", "int"],
  ["newborn", "nb", "bool"], ["birthOrder", "bo", "int"], ["disabled", "dis", "bool"], ["severeDisabled", "sev", "bool"],
  ["singleParent", "single", "bool"], ["thirdChild7to18", "third", "bool"], ["residenceMonths", "res", "int"],
  ["housingAsset", "ha", "man"], ["financialAsset", "fa", "man"], ["debt", "debt", "man"],
];

export function encodeState({ hh, income, compare, includeInkind, preset }, defaults) {
  const q = new URLSearchParams();
  q.set("r", REGION_CODE[hh.region] || hh.region || "gs");
  for (const [k, key, type] of FIELDS) {
    if (hh[k] === defaults[k]) continue;
    if (type === "bool") q.set(key, hh[k] ? "1" : "0");
    else if (type === "man") q.set(key, String(Math.round(hh[k] / 100) / 100)); // 만 원 단위, 소수 둘째 자리까지 (12.5만 원 등)
    else q.set(key, String(hh[k]));
  }
  q.set("inc", String(Math.round(income / 10000)));
  if (compare != null && compare !== income) q.set("cmp", String(Math.round(compare / 10000)));
  if (!includeInkind) q.set("ink", "0");
  if (preset) q.set("p", preset);
  return q;
}

export function decodeState(params, defaults) {
  const r = params.get("r");
  const hh = { ...defaults, region: CODE_REGION[r] || r || defaults.region };
  for (const [k, key, type] of FIELDS) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (type === "bool") hh[k] = raw === "1";
    else {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) hh[k] = type === "man" ? Math.round(n * 10000) : Math.round(n);
    }
  }
  if (hh.spouse) hh.singleParent = false; // 배우자가 있으면 한부모 가구가 아님 (engine normalize와 같게)
  else { hh.spouse65 = false; hh.dualEarner = false; }
  const inc = Number(params.get("inc"));
  const cmp = params.has("cmp") ? Number(params.get("cmp")) : NaN;
  return {
    hh,
    income: Number.isFinite(inc) && inc >= 0 ? inc * 10000 : 0,
    compare: Number.isFinite(cmp) && cmp >= 0 ? cmp * 10000 : null, // 비교 소득 (없으면 내 소득과 같음)
    includeInkind: params.get("ink") !== "0",
    preset: params.get("p") || null,
  };
}
