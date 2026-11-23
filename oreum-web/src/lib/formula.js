// 제도 금액 계산식 (AI가 원문을 읽어 만들고, 담당자가 승인한다).
// 프로그램 코드가 아니라 정해진 문법만 쓰는 식이라 안전하다: eval을 쓰지 않고, 허용한 변수·함수 밖은 거절한다.
//
// 문법: 숫자, 변수(아래 FORMULA_VARS), + - * / ( ), 비교 < <= > >= == !=, && || !,
//       함수 min(a,b,…) max(a,b,…) round(x) floor(x) ceil(x) if(조건, 참일 때, 거짓일 때)
//       lookup("표 이름", 키): amount.tables의 표에서 찾기. 키가 표에 없으면 그보다 작은 키 중 가장 큰 것 (예: 7인 → 6인 금액)
// 예: max(0, lookup("기준액", household_size) - income_recognized_won)
//     if(child_count >= 3, 300000, 100000) * child_count

export const FORMULA_VARS = {
  age: "나이 (세)",
  household_size: "가구원 수 (명)",
  income_recognized_won: "소득인정액 (원/월)",
  income_recognized_pct_median: "소득인정액이 기준 중위소득의 몇 %",
  total_income_annual: "연간 총소득 (원)",
  assets: "재산 합계 (원)",
  child_count: "자녀 수 (명)",
  child_birth_order: "자녀 출생 순위",
  residence_months: "거주 기간 (개월)",
  senior_count: "65세 이상 가구원 수 (명)",
  newborn: "신생아 있음 (1/0)",
  disabled: "장애인 있음 (1/0)",
  single_parent: "한부모 가구 (1/0)",
  basic_pension_recipient: "기초연금 받음 (1/0)",
};
const FUNCS = {
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  round: (x) => Math.round(x), floor: (x) => Math.floor(x), ceil: (x) => Math.ceil(x),
};
const MAX_LEN = 600, MAX_DEPTH = 40;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++; // 쉼표는 함수 인자 구분이라 숫자에 못 씀 (자리 구분은 _ : 1_000_000)
      const raw = src.slice(i, j).replace(/_/g, "");
      if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`숫자 형식이 이상해요: ${src.slice(i, j)}`);
      out.push({ t: "num", v: Number(raw) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error("따옴표가 닫히지 않았어요");
      out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/()<>!,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`쓸 수 없는 글자예요: ${c}`);
  }
  return out;
}

// 우선순위: || → && → 비교 → + - → * / → 단항(- !) → 값
function parse(src) {
  if (typeof src !== "string" || !src.trim()) throw new Error("계산식이 비어 있어요");
  if (src.length > MAX_LEN) throw new Error(`계산식이 너무 길어요 (${MAX_LEN}자 이내)`);
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (v) => { if (peek()?.v === v) { p++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new Error(`'${v}'가 필요해요`); };
  const bin = (next, ops) => (d) => {
    let left = next(d);
    while (peek()?.t === "op" && ops.includes(peek().v)) { const op = tk[p++].v; left = { k: "bin", op, a: left, b: next(d) }; }
    return left;
  };
  const unary = (d) => {
    if (d > MAX_DEPTH) throw new Error("계산식이 너무 복잡해요");
    if (eat("-")) return { k: "neg", a: unary(d + 1) };
    if (eat("!")) return { k: "not", a: unary(d + 1) };
    return atom(d + 1);
  };
  const mul = bin(unary, ["*", "/"]);
  const add = bin(mul, ["+", "-"]);
  const cmp = bin(add, ["<", "<=", ">", ">=", "==", "!="]);
  const and = bin(cmp, ["&&"]);
  const or = bin(and, ["||"]);
  function atom(d) {
    const x = tk[p++];
    if (!x) throw new Error("계산식이 중간에 끝났어요");
    if (x.t === "num") return { k: "num", v: x.v };
    if (x.t === "op" && x.v === "(") { const e = or(d); need(")"); return e; }
    if (x.t === "id") {
      if (eat("(")) {
        const args = [];
        if (!eat(")")) { do { args.push(peek()?.t === "str" ? { k: "str", v: tk[p++].v } : or(d)); } while (eat(",")); need(")"); }
        if (x.v === "if") { if (args.length !== 3) throw new Error("if(조건, 참, 거짓)은 값 3개가 필요해요"); return { k: "if", args }; }
        if (x.v === "lookup") {
          if (args.length !== 2 || args[0].k !== "str") throw new Error('lookup("표 이름", 키) 형식이어야 해요');
          return { k: "lookup", table: args[0].v, key: args[1] };
        }
        if (!Object.hasOwn(FUNCS, x.v)) throw new Error(`쓸 수 없는 함수예요: ${x.v}`); // in·[]은 toString 같은 기본 속성도 통과시킨다
        if (!args.length || args.some((a) => a.k === "str")) throw new Error(`${x.v}에 숫자 값을 넣어 주세요`);
        return { k: "call", f: x.v, args };
      }
      if (!Object.hasOwn(FORMULA_VARS, x.v)) throw new Error(`쓸 수 없는 변수예요: ${x.v}`); // constructor 같은 기본 속성 거절
      return { k: "var", v: x.v };
    }
    throw new Error(`여기에 '${x.v}'가 올 수 없어요`);
  }
  const ast = or(0);
  if (p < tk.length) throw new Error(`'${tk[p].v}' 뒤를 읽을 수 없어요`);
  return ast;
}

function lookupTable(tables, name, key) {
  const t = tables && Object.hasOwn(tables, name) ? tables[name] : null;
  if (!t || typeof t !== "object") throw new Error(`표가 없어요: ${name}`);
  if (Object.hasOwn(t, String(key))) return Number(t[String(key)]);
  const nums = Object.keys(t).map(Number).filter((n) => Number.isFinite(n) && n <= key).sort((a, b) => b - a);
  if (!nums.length) throw new Error(`표 '${name}'에 ${key}에 맞는 칸이 없어요`);
  return Number(t[String(nums[0])]);
}

function run(n, facts, tables) {
  switch (n.k) {
    case "num": return n.v;
    case "var": { const v = facts[n.v]; return typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0; }
    case "neg": return -run(n.a, facts, tables);
    case "not": return run(n.a, facts, tables) ? 0 : 1;
    case "if": return run(n.args[0], facts, tables) ? run(n.args[1], facts, tables) : run(n.args[2], facts, tables);
    case "lookup": return lookupTable(tables, n.table, run(n.key, facts, tables));
    case "call": return FUNCS[n.f](...n.args.map((a) => run(a, facts, tables)));
    case "bin": {
      const a = run(n.a, facts, tables), b = run(n.b, facts, tables);
      switch (n.op) {
        case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return b === 0 ? 0 : a / b;
        case "<": return +(a < b); case "<=": return +(a <= b); case ">": return +(a > b); case ">=": return +(a >= b);
        case "==": return +(a === b); case "!=": return +(a !== b); case "&&": return +(a && b); case "||": return +(a || b);
        default: throw new Error(n.op);
      }
    }
    default: throw new Error("알 수 없는 식");
  }
}

// 표 모양 검사: { 이름: { 키: 0 이상의 숫자 } }
function checkTables(tables) {
  if (tables == null) return;
  if (typeof tables !== "object" || Array.isArray(tables)) throw new Error("표는 { 이름: { 키: 금액 } } 모양이어야 해요");
  for (const [name, t] of Object.entries(tables)) {
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error(`표 '${name}'의 모양이 이상해요`);
    for (const [k, v] of Object.entries(t)) if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`표 '${name}'의 '${k}' 칸이 숫자가 아니에요`);
  }
}

// 표본 가구로 실제 계산까지 해 본다 (문법은 맞아도 표 이름이 틀리면 여기서 걸린다)
export const SAMPLE_FACTS = { age: 40, household_size: 1, income_recognized_won: 0, income_recognized_pct_median: 0, total_income_annual: 0, assets: 0,
  child_count: 0, child_birth_order: 0, residence_months: 120, senior_count: 0, newborn: false, disabled: false, single_parent: false, basic_pension_recipient: false };

export function validateFormula(amount) {
  try {
    if (!amount || amount.type !== "formula") throw new Error("계산식 금액이 아니에요");
    checkTables(amount.tables);
    const ast = parse(amount.expr);
    for (const size of [1, 4, 7]) {
      const v = run(ast, { ...SAMPLE_FACTS, household_size: size }, amount.tables || {});
      if (!Number.isFinite(v)) throw new Error("계산 결과가 숫자가 아니에요");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 월 금액 (unit이 annual이면 12로 나눔, 0보다 작으면 0). 식이 잘못되면 null → 계산에서 뺀다
export function evalFormula(amount, facts) {
  try {
    checkTables(amount.tables);
    const v = run(parse(amount.expr), facts, amount.tables || {});
    if (!Number.isFinite(v)) return null;
    return Math.max(0, amount.unit === "annual" ? v / 12 : v);
  } catch {
    return null;
  }
}
