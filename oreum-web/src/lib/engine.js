// 오름 - 복지 절벽 판정 엔진 (JavaScript, 웹 화면용)
// rules.py(파이썬, 분석용)와 같은 계산을 한다. 계산 로직을 바꾸면 두 파일을 함께 바꿀 것.
// 규칙·금액 값은 data/rules.json에서 읽는다.

export const KIND_LABEL = { cash: "현금", inkind: "감면·현물", access: "자격·융자" };

export function createEngine(data) {
  const P = data.params;
  const L = data.lines;
  // 7인 이상 가구: 1인이 늘 때마다 '6인 기준 − 5인 기준' 차이를 6인 기준에 더한다 (기준중위소득 산정 방식)
  const lineAt = (table, size) => {
    const s = Math.max(1, size);
    return s <= 6 ? table[s] : table[6] + (table[6] - table[5]) * (s - 6);
  };
  const medianIncome = (size) => Math.round(lineAt(L.saeng_32, size) / 0.32);
  const saengLine = (size) => lineAt(L.saeng_32, size);
  // 기준임대료 (고시): 7인은 6인과 같고, 8인부터 2인 늘 때마다 6인 기준의 10%를 더한다
  const rentFor = (grade, size) => {
    const row = P.rent[grade];
    if (size <= 7) return row[Math.min(Math.max(1, size), 6)];
    return row[6] + (row[6] * Math.floor((size - 6) / 2)) / 10;
  };
  const jugeoLine = (size) => (size <= 6 && L.jugeo_48[size] != null ? L.jugeo_48[Math.max(1, size)] : Math.round(medianIncome(size) * 0.48));

  // 입력값 정리: 자녀 수·나이는 0 이상의 정수(소수·음수·빈 값이면 NaN이 퍼짐), 배우자가 있으면 한부모 가구가 아님
  // 출생 순위는 1~4(넷째 이상), 셋째 이상 자녀(7~18세)는 자녀가 3명 이상이고 초·중·고 자녀가 있을 때만
  function normalize(hh) {
    const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
    const kids = { infants: int(hh.infants), elem: int(hh.elem), middle: int(hh.middle), high: int(hh.high) };
    const children = kids.infants + kids.elem + kids.middle + kids.high;
    return {
      ...hh,
      age: int(hh.age), ...kids,
      birthOrder: Math.min(4, Math.max(1, int(hh.birthOrder) || 1), Math.max(1, children)), // 자녀 수보다 클 수 없음
      newborn: Boolean(hh.newborn && kids.infants >= 1), // 영유아가 0명이면 올해 출산 아님
      residenceMonths: int(hh.residenceMonths),
      housingAsset: Math.max(0, Number(hh.housingAsset) || 0), financialAsset: Math.max(0, Number(hh.financialAsset) || 0),
      debt: Math.max(0, Number(hh.debt) || 0), // 음수 재산·부채로 소득환산액이 마이너스가 되지 않게
      thirdChild7to18: Boolean(hh.thirdChild7to18 && children >= 3 && kids.elem + kids.middle + kids.high >= 1),
      singleParent: Boolean(hh.singleParent && !hh.spouse),
      spouse65: Boolean(hh.spouse && hh.spouse65), dualEarner: Boolean(hh.spouse && hh.dualEarner),
    };
  }

  function derive(hh) {
    hh = normalize(hh);
    const children = hh.infants + hh.elem + hh.middle + hh.high;
    return {
      children,
      schoolKids: hh.elem + hh.middle + hh.high,
      size: 1 + (hh.spouse ? 1 : 0) + children, // 7인 이상도 그대로 (기준선은 lineAt으로 늘림)
      seniors: (hh.age >= 65 ? 1 : 0) + (hh.spouse && hh.spouse65 ? 1 : 0),
      disabled: Boolean(hh.disabled || hh.severeDisabled),
    };
  }

  function eitcType(hh, d) {
    if (hh.dualEarner) return "dual";
    if (hh.spouse || d.children > 0) return "one";
    return "single";
  }

  function eitc(annual, typ) {
    const [a, b, c, mx] = P.eitc[typ];
    if (annual <= 0 || annual >= c) return 0;
    if (annual < a) return (mx * annual) / a;
    if (annual <= b) return mx;
    return (mx * (c - annual)) / (c - b);
  }

  function ctc(annual, typ, kids) {
    if (kids === 0 || typ === "single" || annual >= P.ctc_limit) return 0;
    const fullUntil = P.ctc_full_until[typ];
    if (annual <= fullUntil) return P.ctc_max_per_child * kids;
    const ratio = 1 - (0.5 * (annual - fullUntil)) / (P.ctc_limit - fullUntil);
    return P.ctc_max_per_child * kids * ratio;
  }

  // 월 근로소득(가구 합계) earned 일 때 받을 수 있는 혜택 목록
  // 재산의 소득환산액 (월). basic = 기초생활보장·한부모 방식, pension = 기초연금·장애인연금 방식
  // eitcFactor = 근로·자녀장려금 재산 요건 (1 / 0.5 / 0)
  function assetIncomes(hh, region) {
    const A = P.assets;
    if (!A) return { basic: 0, pension: 0, eitcFactor: 1 };
    const H = hh.housingAsset || 0, F = hh.financialAsset || 0, D = hh.debt || 0;
    let hin = Math.min(H, region.housing_limit);
    let hover = H - hin;
    let fin = Math.max(0, F - A.basic.financial_living_allowance);
    let ded = region.asset_base + D; // 기본재산액과 부채를 주거용(한도 내) → 한도 초과분 → 금융재산 순으로 공제
    let t = Math.min(hin, ded); hin -= t; ded -= t;
    t = Math.min(hover, ded); hover -= t; ded -= t;
    t = Math.min(fin, ded); fin -= t;
    const basic = hin * A.basic.rate_housing + hover * A.basic.rate_general + fin * A.basic.rate_financial;
    const general = Math.max(0, H - region.pension_asset_deduction);
    const pfin = Math.max(0, F - A.pension.financial_deduction);
    const pension = (Math.max(0, general + pfin - D) * A.pension.annual_rate) / 12;
    const total = H + F;
    const eitcFactor = total >= A.eitc.limit ? 0 : total >= A.eitc.half_from ? 0.5 : 1; // 1억7천만 원 이상 50%
    return { basic, pension, eitcFactor };
  }

  function evaluate(hh, earned) {
    hh = normalize(hh);
    const d = derive(hh);
    const size = d.size;
    const m = medianIncome(size);
    const region = data.regions[hh.region];
    const out = [];
    const add = (id, name, level, kind, monthly, note) => out.push({ id, name, level, kind, monthly, note });
    const asset = assetIncomes(hh, region);

    // 기초연금 (소득인정액 계산에 들어가므로 먼저)
    let bp = 0;
    if (d.seniors > 0) { // 본인 또는 배우자 중 65세 이상인 사람이 받는다 (부부가구는 부부 선정기준액)
      const couple = hh.spouse;
      const line = P.basic_pension_line[couple ? "couple" : "single"];
      const evalIncome = 0.7 * Math.max(0, earned - P.basic_pension_earned_deduction) + asset.pension;
      if (evalIncome <= line) {
        bp = d.seniors === 2
          ? 2 * P.basic_pension_amount * (1 - P.basic_pension_couple_cut)
          : P.basic_pension_amount;
        add("basic_pension", "기초연금", "중앙", "cash", bp, "소득인정액이 선정기준액 이하");
      }
    }

    // 장애인연금 기초급여 (18~64세 중증장애인). 기초연금처럼 생계급여 소득인정액에 포함(추정)
    const DP = P.dis_pension;
    let dpBasic = 0;
    if (DP && hh.severeDisabled && hh.age >= DP.age_min && hh.age <= DP.age_max) {
      const line = hh.spouse ? DP.line_couple : DP.line_single;
      if (0.7 * Math.max(0, earned - DP.earned_deduction) + asset.pension <= line) dpBasic = DP.basic;
    }

    // 소득인정액 = 소득평가액 + 재산의 소득환산액 + 기초연금·장애인연금 기초급여
    // 근로소득공제 (2026 사업안내): 청년(34세 이하) 60만 원, 노인(65세+)·장애인 20만 원을 먼저 뺀 뒤 30%
    const yd = P.youth_deduction, sd = P.senior_disabled_deduction;
    let flat = 0;
    if (yd && hh.age <= yd.age_max) flat = yd.flat;
    else if (sd && (hh.age >= sd.age_min || d.disabled)) flat = sd.flat;
    const evalEarned = Math.max(0, earned - flat);
    const ri = evalEarned * (1 - P.earned_deduction_rate) + asset.basic + bp + dpBasic;

    const sLine = saengLine(size);
    const saeng = Math.max(0, sLine - ri);
    if (saeng > 0) add("saeng", "생계급여", "중앙", "cash", saeng, "중위 32% − 소득인정액 (기초연금은 소득으로 차감됨)");

    // 의료급여: 일반 근로소득공제 30%는 생계·주거·교육급여에만 적용. 의료급여는 유형별 공제(34세 이하·65세 이상·장애인 등)만 (2026 사업안내)
    const riMedical = (flat ? evalEarned * (1 - P.earned_deduction_rate) : earned) + asset.basic + bp + dpBasic;
    const medical = riMedical <= 0.4 * m;
    if (medical) add("medical", "의료급여", "중앙", "inkind", P.medical_value_per_person * size, "소득인정액 ≤ 중위 40%, 건강보험 전환 시 본인부담 추정 1인당 월 46,450원");

    // 주거급여: 기준선 이하여도 자기부담분이 기준임대료보다 크면 지급액이 0원 → 수급자로 보지 않는다
    let jugeoElig = false;
    if (ri <= jugeoLine(size)) {
      const rent = rentFor(region.rent_grade, size);
      const deduct = ri <= sLine ? 0 : P.jugeo_self_share * (ri - sLine);
      const jugeo = Math.max(0, rent - deduct);
      if (jugeo > 0) {
        jugeoElig = true;
        add("jugeo", "주거급여", "중앙", "cash", jugeo, `소득인정액 ≤ 중위 48%, ${region.rent_grade} 기준임대료 (임차 가정)`);
      }
    }

    const eduElig = ri <= 0.5 * m && d.schoolKids > 0;
    if (eduElig) {
      const edu = (hh.elem * P.edu_annual.elem + hh.middle * P.edu_annual.middle + hh.high * P.edu_annual.high) / 12;
      add("edu", "교육급여", "중앙", "cash", edu, "소득인정액 ≤ 중위 50%, 정액");
    }

    const recipient = saeng > 0 || medical || jugeoElig || eduElig;
    const nearPoor = !recipient && ri <= 0.5 * m; // 차상위 근사

    const trait = d.seniors > 0 || hh.infants > 0 || d.disabled || hh.singleParent || d.children >= 2;
    if (recipient && trait) {
      add("energy", "에너지바우처", "중앙", "inkind", P.energy_annual[Math.min(size, 4)] / 12,
        "기초수급자 + 노인·영유아·장애인·한부모·다자녀 등");
    }

    if (saeng > 0 || medical) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.saeng_medical, "생계·의료급여 수급자 (월 최대)");
    } else if (recipient || nearPoor) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.housing_edu_nearpoor, "주거·교육급여 수급자, 차상위 (월 최대)");
    } else if (bp > 0 || d.disabled) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.pension_disabled, "기초연금 수급자, 장애인 (월 최대)");
    }

    // 문화누리카드: 6세 이상 기초수급자·차상위, 1인당 연 15만 원 (영유아 제외)
    if (P.munhwa && (recipient || nearPoor)) {
      const n = 1 + (hh.spouse ? 1 : 0) + hh.elem + hh.middle + hh.high;
      add("munhwa", "문화누리카드", "중앙", "inkind", (P.munhwa.annual_per_person * n) / 12,
        `기초수급자·차상위, 6세 이상 ${n}명 × 연 ${P.munhwa.annual_per_person.toLocaleString("ko-KR")}원`);
    }

    // 장애인연금 = 기초급여 + 부가급여(소득계층별)
    if (dpBasic > 0) {
      const extra = recipient ? DP.additional.recipient : nearPoor ? DP.additional.near_poor : DP.additional.above;
      add("dis_pension", "장애인연금", "중앙", "cash", dpBasic + extra,
        `18~64세 중증장애인, 기초급여 ${dpBasic.toLocaleString("ko-KR")}원 + 부가급여 ${extra.toLocaleString("ko-KR")}원`);
    } else if (DP && hh.severeDisabled && hh.age > DP.age_max && bp > 0) {
      // 65세 이상: 기초급여 대신 기초연금을 받고, 부가급여만 계속 받는다 (금액은 18~64세 표를 적용, 추정)
      const extra = recipient ? DP.additional.recipient : nearPoor ? DP.additional.near_poor : DP.additional.above;
      add("dis_pension", "장애인연금(부가급여)", "중앙", "cash", extra,
        `65세 이상 중증장애인 + 기초연금 수급, 부가급여 ${extra.toLocaleString("ko-KR")}원 (65세 이상 금액은 추정)`);
    }

    const typ = eitcType(hh, d);
    const annual = earned * 12;
    const e = eitc(annual, typ) * asset.eitcFactor;
    if (e > 0) add("eitc", "근로장려금", "중앙", "cash", e / 12, "연 지급액을 월로 환산 (전년도 소득 기준 지급)");
    const c = ctc(annual, typ, d.children) * asset.eitcFactor;
    if (c > 0) add("ctc", "자녀장려금", "중앙", "cash", c / 12, "연 지급액을 월로 환산");

    // 한부모가족 아동양육비: 소득인정액(근로소득 30% 공제) ≤ 중위 65%, 18세 미만 자녀 1인당 월 23만 원
    if (P.sp_child && hh.singleParent && d.children > 0) {
      const riSp = earned * (1 - P.earned_deduction_rate) + asset.basic;
      if (riSp <= (P.sp_child.pct_median / 100) * m) {
        add("sp_child", "한부모 아동양육비", "중앙", "cash", P.sp_child.monthly_per_child * d.children,
          `한부모 + 소득인정액 ≤ 중위 ${P.sp_child.pct_median}%, 자녀 ${d.children}명 × 월 ${P.sp_child.monthly_per_child.toLocaleString("ko-KR")}원`);
      }
    }

    // ---- 지자체 (rules.json local_programs 중 이 지역의 '승인' 제도만) ----
    const recipientStatus = [saeng > 0 && "생계", medical && "의료", jugeoElig && "주거", eduElig && "교육", nearPoor && "차상위"].filter(Boolean);
    const facts = {
      age: hh.age, household_size: size, income_recognized_pct_median: (ri / m) * 100, income_recognized_won: ri,
      total_income_annual: earned * 12, assets: hh.housingAsset + hh.financialAsset, recipient_status: recipientStatus,
      basic_pension_recipient: bp > 0, residence_months: hh.residenceMonths, child_count: d.children, newborn: hh.newborn,
      school_enrolled: d.schoolKids > 0, disabled: d.disabled, single_parent: hh.singleParent, senior_in_household: d.seniors > 0,
      third_child_7to18: hh.thirdChild7to18, child_birth_order: hh.birthOrder,
    };
    for (const prog of localProgramsFor(hh.region)) {
      const f = { ...facts };
      if (prog.facts?.nhis_premium_rate) f.nhis_premium = earned * P[prog.facts.nhis_premium_rate];
      if (!conditionsMet(prog.conditions, f)) continue;
      const { monthly, vars } = programAmount(prog.amount, hh, d);
      add(prog.id, prog.name, "지자체", prog.kind, monthly, fillNote(prog.note, vars));
    }
    return out;
  }

  // ---- 지자체 제도 (데이터) ----
  const won = (n) => Number(n).toLocaleString("ko-KR");
  const paramValue = (v) => (typeof v === "string" && v.startsWith("@") ? P[v.slice(1)] : v);
  function localProgramsFor(regionKey) {
    const region = data.regions[regionKey];
    return (data.local_programs || []).filter((p) => p.status === "승인"
      && (p.region ? p.region === regionKey : p.sido && region && p.sido === region.sido));
  }
  // 조건 하나: 판정할 수 없는 항목(other 등)이면 거짓
  function conditionOk(c, facts) {
    if (!(c.field in facts) || facts[c.field] === undefined) return false;
    const fact = facts[c.field];
    const raw = paramValue(c.value);
    const list = String(raw).split(",").map((s) => s.trim());
    if (c.op === "in" || c.op === "not_in") {
      const hit = Array.isArray(fact) ? fact.some((x) => list.includes(String(x))) : list.includes(String(fact));
      return c.op === "in" ? hit : !hit;
    }
    if (typeof fact === "boolean") return c.op === "==" && fact === (String(raw) === "true");
    const x = Number(fact);
    if (c.op === "between") return x >= Number(list[0]) && x <= Number(list[1]);
    const v = Number(raw);
    return c.op === "<=" ? x <= v : c.op === "<" ? x < v : c.op === ">=" ? x >= v : c.op === ">" ? x > v : c.op === "==" ? x === v : false;
  }
  // group이 빈 조건은 모두 충족, 같은 group끼리는 하나 이상 충족
  function conditionsMet(conds, facts) {
    const groups = {};
    for (const c of conds || []) {
      if (!c.group) { if (!conditionOk(c, facts)) return false; }
      else (groups[c.group] ||= []).push(c);
    }
    return Object.values(groups).every((g) => g.some((c) => conditionOk(c, facts)));
  }
  function programAmount(a, hh, d) {
    if (a.type === "per_senior") return { monthly: P[a.param] * d.seniors, vars: {} };
    if (a.type === "by_birth_order") {
      const [amt, months] = P[a.param][Math.min(hh.birthOrder, 4)];
      return { monthly: amt, vars: { amount: won(amt), months, lump: won(P[a.lump_param] ?? 0) } };
    }
    if (a.type === "child_band_annual") {
      // 셋째(막내 쪽)의 나이를 알 수 없어, 초·중학생이 있으면 7~15세, 고등학생만 있으면 16~18세 금액으로 본다
      const band = hh.elem + hh.middle > 0 ? "7-15" : "16-18";
      const annual = P[a.param][band];
      return { monthly: annual / 12, vars: { annual_man: won(annual / 10000), band_label: band === "7-15" ? "7~15세" : "16~18세" } };
    }
    return { monthly: a.param ? P[a.param] : a.monthly || 0, vars: {} }; // fixed
  }
  const fillNote = (note, vars) => (note || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));

  const counted = (b, includeInkind) => b.kind === "cash" || (includeInkind && b.kind === "inkind");

  // 소득 0원부터 maxIncome까지 step 단위로 계산
  function simulate(hh, maxIncome, step = 10000, includeInkind = true) {
    const incomes = [], disposable = [], elig = [], rows = [];
    const names = new Set();
    for (let inc = 0; inc <= maxIncome; inc += step) {
      const bs = evaluate(hh, inc);
      const row = {};
      let total = 0;
      for (const b of bs) {
        if (counted(b, includeInkind)) { row[b.id] = b.monthly; total += b.monthly; names.add(b.id); }
      }
      incomes.push(inc); rows.push(row); disposable.push(inc + total);
      elig.push(new Set(bs.map((b) => b.name)));
    }
    const series = {};
    for (const id of names) series[id] = rows.map((r) => r[id] ?? 0);
    return { incomes, series, disposable, elig, step };
  }

  // 소득이 한 단계 늘었는데 '근로소득 + 혜택' 합계가 줄어드는 지점
  function findCliffs(sim, minDrop = 1000) {
    const cliffs = [];
    for (let i = 1; i < sim.incomes.length; i++) {
      const drop = sim.disposable[i - 1] - sim.disposable[i];
      if (drop >= minDrop) {
        const lost = [...sim.elig[i - 1]].filter((n) => !sim.elig[i].has(n)).sort();
        cliffs.push({ index: i, income: sim.incomes[i], drop, lost });
      }
    }
    return cliffs;
  }

  return { medianIncome, normalize, derive, evaluate, simulate, findCliffs, counted, localProgramsFor, conditionsMet };
}
