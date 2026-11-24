// 오름 - 복지 절벽 판정 엔진 (JavaScript, 웹 화면용)
// rules.py(파이썬, 분석용)와 같은 계산을 한다. 계산 로직을 바꾸면 두 파일을 함께 바꿀 것.
// 규칙·금액 값은 data/rules.json에서 읽는다.

export const KIND_LABEL = { cash: "현금", inkind: "감면·현물", access: "자격·융자" };

import { evalFormula } from "./formula.js";

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

  // explain=true면 혜택마다 '왜 이 금액?' 계산 단계(steps)를 붙인다 (결과 화면용. 그래프 계산은 false라 빠르다)
  function evaluate(hh, earned, explain = false) {
    hh = normalize(hh);
    const d = derive(hh);
    const size = d.size;
    const m = medianIncome(size);
    const region = data.regions[hh.region];
    const out = [];
    const add = (id, name, level, kind, monthly, note, steps) => out.push(explain && steps ? { id, name, level, kind, monthly, note, steps: steps() } : { id, name, level, kind, monthly, note });
    // 단계 한 줄: [설명, 금액(원) 또는 글, 표시]  표시: "=" 결과, "-" 빼기, "+" 더하기, "x" 곱하기, "ok"/"no" 조건
    const S = (label, value, mark = "") => ({ label, value, mark });
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
        add("basic_pension", "기초연금", "중앙", "cash", bp, "소득인정액이 선정기준액 이하", () => [
          S("월급에서 근로소득 공제 뺀 금액 × 70%", 0.7 * Math.max(0, earned - P.basic_pension_earned_deduction)),
          S(`(근로소득 공제 월 ${won(P.basic_pension_earned_deduction)}원)`, ""),
          S("재산의 소득환산액 (기초연금 방식)", asset.pension, "+"),
          S("기초연금 소득인정액", evalIncome, "="),
          S(`선정기준액 (${couple ? "부부" : "단독"} 가구)`, line, "ok"),
          S("기준연금액", P.basic_pension_amount),
          ...(d.seniors === 2 ? [S(`부부가 함께 받으면 각각 ${Math.round(P.basic_pension_couple_cut * 100)}% 감액 × 2명`, "", "x")] : []),
          S("기초연금", bp, "="),
        ]);
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
    const riSteps = () => [
      S("월급 (근로·사업소득)", earned),
      ...(flat ? [S(hh.age <= (yd?.age_max ?? 0) ? "청년 추가 공제" : "노인·장애인 추가 공제", flat, "-")] : []),
      S(`근로소득 공제 ${Math.round(P.earned_deduction_rate * 100)}%`, evalEarned * P.earned_deduction_rate, "-"),
      ...(asset.basic ? [S("재산의 소득환산액", asset.basic, "+")] : []),
      ...(bp ? [S("기초연금 (소득으로 봄)", bp, "+")] : []),
      ...(dpBasic ? [S("장애인연금 기초급여 (소득으로 봄)", dpBasic, "+")] : []),
      S("소득인정액", ri, "="),
    ];

    const sLine = saengLine(size);
    const saeng = Math.max(0, sLine - ri);
    if (saeng > 0) add("saeng", "생계급여", "중앙", "cash", saeng, "중위 32% − 소득인정액 (기초연금은 소득으로 차감됨)", () => [
      S(`생계급여 선정기준 (기준 중위소득 32%, ${size}인)`, sLine),
      S("소득인정액", ri, "-"),
      S("생계급여", saeng, "="),
      { sub: "소득인정액은 이렇게 계산했어요", rows: riSteps() },
    ]);

    // 의료급여: 일반 근로소득공제 30%는 생계·주거·교육급여에만 적용. 의료급여는 유형별 공제(34세 이하·65세 이상·장애인 등)만 (2026 사업안내)
    const riMedical = (flat ? evalEarned * (1 - P.earned_deduction_rate) : earned) + asset.basic + bp + dpBasic;
    const medical = riMedical <= 0.4 * m;
    if (medical) add("medical", "의료급여", "중앙", "inkind", P.medical_value_per_person * size, "소득인정액 ≤ 중위 40%, 건강보험 전환 시 본인부담 추정 1인당 월 46,450원", () => [
      S("소득인정액 (의료급여 방식: 일반 30% 공제 없음)", riMedical),
      S(`의료급여 선정기준 (기준 중위소득 40%, ${size}인)`, 0.4 * m, "ok"),
      S("의료비 본인부담을 덜어 주는 가치 (1인당 추정)", P.medical_value_per_person),
      S(`× ${size}명`, "", "x"),
      S("의료급여 가치 (월, 추정)", P.medical_value_per_person * size, "="),
    ]);

    // 주거급여: 기준선 이하여도 자기부담분이 기준임대료보다 크면 지급액이 0원 → 수급자로 보지 않는다
    let jugeoElig = false;
    if (ri <= jugeoLine(size)) {
      const rent = rentFor(region.rent_grade, size);
      const deduct = ri <= sLine ? 0 : P.jugeo_self_share * (ri - sLine);
      const jugeo = Math.max(0, rent - deduct);
      if (jugeo > 0) {
        jugeoElig = true;
        add("jugeo", "주거급여", "중앙", "cash", jugeo, `소득인정액 ≤ 중위 48%, ${region.rent_grade} 기준임대료 (임차 가정)`, () => [
          S("소득인정액", ri),
          S(`주거급여 선정기준 (기준 중위소득 48%, ${size}인)`, jugeoLine(size), "ok"),
          S(`기준임대료 (${region.rent_grade}, ${size}인)`, rent),
          deduct ? S(`자기부담: (소득인정액 − 생계급여 기준 ${won(Math.round(sLine))}원) × ${Math.round(P.jugeo_self_share * 100)}%`, deduct, "-")
            : S("소득인정액이 생계급여 기준 이하라 자기부담 없음", 0, "-"),
          S("주거급여 (월세를 낸다고 가정)", jugeo, "="),
          { sub: "소득인정액은 이렇게 계산했어요", rows: riSteps() },
        ]);
      }
    }

    const eduElig = ri <= 0.5 * m && d.schoolKids > 0;
    if (eduElig) {
      const edu = (hh.elem * P.edu_annual.elem + hh.middle * P.edu_annual.middle + hh.high * P.edu_annual.high) / 12;
      add("edu", "교육급여", "중앙", "cash", edu, "소득인정액 ≤ 중위 50%, 정액", () => [
        S("소득인정액", ri),
        S(`교육급여 선정기준 (기준 중위소득 50%, ${size}인)`, 0.5 * m, "ok"),
        ...(hh.elem ? [S(`초등학생 ${hh.elem}명 × 연 ${won(P.edu_annual.elem)}원`, hh.elem * P.edu_annual.elem)] : []),
        ...(hh.middle ? [S(`중학생 ${hh.middle}명 × 연 ${won(P.edu_annual.middle)}원`, hh.middle * P.edu_annual.middle, "+")] : []),
        ...(hh.high ? [S(`고등학생 ${hh.high}명 × 연 ${won(P.edu_annual.high)}원`, hh.high * P.edu_annual.high, "+")] : []),
        S("÷ 12개월", "", "x"),
        S("교육급여 (월 환산)", edu, "="),
        { sub: "소득인정액은 이렇게 계산했어요", rows: riSteps() },
      ]);
    }

    const recipient = saeng > 0 || medical || jugeoElig || eduElig;
    const nearPoor = !recipient && ri <= 0.5 * m; // 차상위 근사

    const trait = d.seniors > 0 || hh.infants > 0 || d.disabled || hh.singleParent || d.children >= 2;
    if (recipient && trait) {
      add("energy", "에너지바우처", "중앙", "inkind", P.energy_annual[Math.min(size, 4)] / 12,
        "기초수급자 + 노인·영유아·장애인·한부모·다자녀 등", () => [
          S("기초생활 수급자 + 노인·영유아·장애인·한부모·다자녀 가구", "", "ok"),
          S(`${Math.min(size, 4)}인${size >= 4 ? " 이상" : ""} 가구 연 지원액`, P.energy_annual[Math.min(size, 4)]),
          S("÷ 12개월", "", "x"),
          S("에너지바우처 (월 환산)", P.energy_annual[Math.min(size, 4)] / 12, "="),
        ]);
    }

    if (saeng > 0 || medical) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.saeng_medical, "생계·의료급여 수급자 (월 최대)", () => [
        S("생계·의료급여 수급자", "", "ok"), S("월 최대 감면액", P.telecom_monthly.saeng_medical, "=")]);
    } else if (recipient || nearPoor) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.housing_edu_nearpoor, "주거·교육급여 수급자, 차상위 (월 최대)", () => [
        S("주거·교육급여 수급자 또는 차상위", "", "ok"), S("월 최대 감면액", P.telecom_monthly.housing_edu_nearpoor, "=")]);
    } else if (bp > 0 || d.disabled) {
      add("telecom", "이동통신요금 감면", "중앙", "inkind", P.telecom_monthly.pension_disabled, "기초연금 수급자, 장애인 (월 최대)", () => [
        S("기초연금 수급자 또는 장애인", "", "ok"), S("월 최대 감면액", P.telecom_monthly.pension_disabled, "=")]);
    }

    // 문화누리카드: 6세 이상 기초수급자·차상위, 1인당 연 15만 원 (영유아 제외)
    if (P.munhwa && (recipient || nearPoor)) {
      const n = 1 + (hh.spouse ? 1 : 0) + hh.elem + hh.middle + hh.high;
      add("munhwa", "문화누리카드", "중앙", "inkind", (P.munhwa.annual_per_person * n) / 12,
        `기초수급자·차상위, 6세 이상 ${n}명 × 연 ${P.munhwa.annual_per_person.toLocaleString("ko-KR")}원`, () => [
          S("기초생활 수급자 또는 차상위", "", "ok"),
          S(`6세 이상 ${n}명 × 연 ${won(P.munhwa.annual_per_person)}원`, P.munhwa.annual_per_person * n),
          S("÷ 12개월", "", "x"),
          S("문화누리카드 (월 환산)", (P.munhwa.annual_per_person * n) / 12, "="),
        ]);
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
    if (e > 0) add("eitc", "근로장려금", "중앙", "cash", e / 12, "연 지급액을 월로 환산 (전년도 소득 기준 지급)", () => {
      const [a, b2, c2, mx] = P.eitc[typ];
      const band = annual < a ? `점증 구간: 최대액 × 연소득 ÷ ${won(a)}원` : annual <= b2 ? "평탄 구간: 최대액 그대로" : `점감 구간: 최대액 × (${won(c2)}원 − 연소득) ÷ ${won(c2 - b2)}원`;
      return [
        S("연 근로소득 (월급 × 12)", annual),
        S(`가구 유형: ${typ === "single" ? "단독" : typ === "one" ? "홑벌이" : "맞벌이"} · 최대 연 ${won(mx)}원`, ""),
        S(band, eitc(annual, typ)),
        ...(asset.eitcFactor < 1 ? [S(`재산 요건 (재산 ${won(1.7e8)}원 이상이면 50%)`, "", "x")] : []),
        S("÷ 12개월", "", "x"),
        S("근로장려금 (월 환산)", e / 12, "="),
      ];
    });
    const c = ctc(annual, typ, d.children) * asset.eitcFactor;
    if (c > 0) add("ctc", "자녀장려금", "중앙", "cash", c / 12, "연 지급액을 월로 환산", () => [
      S("연 근로소득 (월급 × 12)", annual),
      S(`자녀 ${d.children}명 × 최대 연 ${won(P.ctc_max_per_child)}원`, P.ctc_max_per_child * d.children),
      ...(annual > P.ctc_full_until[typ] ? [S(`연소득이 ${won(P.ctc_full_until[typ])}원을 넘어 줄어든 금액`, ctc(annual, typ, d.children), "=")] : []),
      S("÷ 12개월", "", "x"),
      S("자녀장려금 (월 환산)", c / 12, "="),
    ]);

    // 한부모가족 아동양육비: 소득인정액(근로소득 30% 공제) ≤ 중위 65%, 18세 미만 자녀 1인당 월 23만 원
    if (P.sp_child && hh.singleParent && d.children > 0) {
      const riSp = earned * (1 - P.earned_deduction_rate) + asset.basic;
      if (riSp <= (P.sp_child.pct_median / 100) * m) {
        add("sp_child", "한부모 아동양육비", "중앙", "cash", P.sp_child.monthly_per_child * d.children,
          `한부모 + 소득인정액 ≤ 중위 ${P.sp_child.pct_median}%, 자녀 ${d.children}명 × 월 ${P.sp_child.monthly_per_child.toLocaleString("ko-KR")}원`, () => [
            S("소득인정액 (월급의 70% + 재산 환산)", riSp),
            S(`한부모 아동양육비 기준 (기준 중위소득 ${P.sp_child.pct_median}%, ${size}인)`, (P.sp_child.pct_median / 100) * m, "ok"),
            S(`자녀 ${d.children}명 × 월 ${won(P.sp_child.monthly_per_child)}원`, P.sp_child.monthly_per_child * d.children, "="),
          ]);
      }
    }

    // ---- 지자체 (rules.json local_programs 중 이 지역의 '승인' 제도만) ----
    const recipientStatus = [saeng > 0 && "생계", medical && "의료", jugeoElig && "주거", eduElig && "교육", nearPoor && "차상위"].filter(Boolean);
    const facts = {
      age: hh.age, household_size: size, income_recognized_pct_median: (ri / m) * 100, income_recognized_won: ri,
      total_income_annual: earned * 12, assets: hh.housingAsset + hh.financialAsset, recipient_status: recipientStatus,
      basic_pension_recipient: bp > 0, residence_months: hh.residenceMonths, child_count: d.children, newborn: hh.newborn,
      school_enrolled: d.schoolKids > 0, disabled: d.disabled, single_parent: hh.singleParent, senior_in_household: d.seniors > 0,
      third_child_7to18: hh.thirdChild7to18, child_birth_order: hh.birthOrder, senior_count: d.seniors,
      residence_region: [hh.region, region.sido, region.sigungu].filter(Boolean),
    };
    for (const prog of localProgramsFor(hh.region)) {
      const f = { ...facts };
      if (prog.facts?.nhis_premium_rate) f.nhis_premium = earned * P[prog.facts.nhis_premium_rate];
      const skip = new Set(prog.apply_checks || []); // 담당자가 '신청할 때 확인'으로 둔 조건 (계산에서 제외, 안내만)
      if (!conditionsMet(prog.conditions, f, skip)) continue;
      const amt = programAmount(prog.amount, hh, d, f);
      if (!amt) continue; // 계산식이 잘못되면 계산에서 뺀다 (관리자 화면에서 승인 전에 막지만 한 번 더)
      const { monthly, vars } = amt;
      const later = (prog.conditions || []).filter((_, i) => skip.has(i)).map((c) => c.value);
      add(prog.id, prog.name, "지자체", prog.kind, monthly, fillNote(prog.note, vars) + (later.length ? ` · 신청할 때 확인: ${later.join(", ")}` : ""), () => [
        S("조건 충족: " + (prog.conditions || []).filter((_, i) => !skip.has(i)).map(condText).join(" · "), "", "ok"),
        ...(prog.amount.type === "formula" ? [S(`계산식: ${prog.amount.expr}`, ""), ...(prog.amount.explanation ? [S(prog.amount.explanation, "")] : [])] : []),
        S(`${prog.name} (월)`, monthly, "="),
      ]);
    }
    return out;
  }

  // ---- 지자체 제도 (데이터) ----
  // '왜 이 금액?'에 쓰는 조건 문장 (예: "나이 65 이상", "거주 지역 경상북도 경산시")
  const FIELD_KO = { age: "나이", household_size: "가구원 수", income_recognized_pct_median: "소득인정액(기준 중위소득 %)", income_recognized_won: "소득인정액",
    total_income_annual: "연간 총소득", assets: "재산", recipient_status: "수급 자격", basic_pension_recipient: "기초연금 받음", residence_months: "거주 기간(개월)",
    child_count: "자녀 수", child_birth_order: "자녀 출생 순위", newborn: "신생아", school_enrolled: "초·중·고 재학", disabled: "장애인", single_parent: "한부모",
    senior_in_household: "65세 이상 가구원", nhis_premium: "건강보험료", third_child_7to18: "셋째 이상 자녀(7~18세)", residence_region: "거주 지역" };
  const OP_KO = { "<=": "이하", "<": "미만", ">=": "이상", ">": "초과", "==": "", in: "", not_in: "아님", between: "사이" };
  const condText = (c) => {
    const v = String(paramValue(c.value));
    if (v === "true" && c.op === "==") return FIELD_KO[c.field] || c.field;
    return [FIELD_KO[c.field] || c.field, /^\d+(\.\d+)?$/.test(v) ? won(v) : v, OP_KO[c.op] ?? c.op].filter(Boolean).join(" ");
  };
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
    if (Array.isArray(fact)) return c.op === "==" && fact.some((x) => list.includes(String(x))); // 거주 지역 등 이름 목록
    if (typeof fact === "boolean") return c.op === "==" && fact === (String(raw) === "true");
    const x = Number(fact);
    if (c.op === "between") return x >= Number(list[0]) && x <= Number(list[1]);
    const v = Number(raw);
    return c.op === "<=" ? x <= v : c.op === "<" ? x < v : c.op === ">=" ? x >= v : c.op === ">" ? x > v : c.op === "==" ? x === v : false;
  }
  // group이 빈 조건은 모두 충족, 같은 group끼리는 하나 이상 충족
  function conditionsMet(conds, facts, skip = new Set()) {
    const groups = {};
    for (const [i, c] of (conds || []).entries()) {
      if (skip.has(i)) continue;
      if (!c.group) { if (!conditionOk(c, facts)) return false; }
      else (groups[c.group] ||= []).push(c);
    }
    return Object.values(groups).every((g) => g.some((c) => conditionOk(c, facts)));
  }
  function programAmount(a, hh, d, facts = {}) {
    if (a.type === "formula") {
      // AI가 원문에서 만든 계산식 (formula.js: 허용한 변수·함수만, eval 없음)
      const monthly = evalFormula(a, facts);
      return monthly == null ? null : { monthly, vars: {} };
    }
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
