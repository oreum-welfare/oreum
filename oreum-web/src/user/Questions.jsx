import { useEffect, useState } from "react";
import { ManwonInput, Option, Seg, Stepper } from "../ui/index.jsx";
import { ORDINAL, PRESETS, iga, manwon, short } from "./data.js";

const TOTAL = 5;
const STEPS = ["사는 곳", "가족", "해당하는 것", "재산", "소득"];
const GS = "경상북도 경산시";
const QUICK = [0, 100, 200, 300, 400];

// 시작 화면 + 질문 5개 (한 화면에 하나). editing이면 소개 없이 바로 질문부터 (startStep: 특정 질문부터)
export default function Questions({ regions, initial, initialIncome, editing, startStep, example, onFinish, onPreset, onCancel }) {
  const [step, setStep] = useState(editing ? startStep || 1 : 0);
  const [hh, setHh] = useState(initial);
  const [income, setIncome] = useState(initialIncome);
  // 재산: null(아직 안 고름) · false(거의 없음) · true(있음). 수정 중이면 지금 값으로 미리 고름
  const assetSum = initial.housingAsset + initial.financialAsset + initial.debt;
  const [hasAsset, setHasAsset] = useState(assetSum > 0 ? true : editing ? false : null);
  const set = (k, v) => setHh((h) => {
    const n = { ...h, [k]: v };
    if (k === "spouse" && !v) { n.spouse65 = false; n.dualEarner = false; }
    if (k === "spouse" && v) n.singleParent = false;
    if (k === "singleParent" && v) { n.spouse = false; n.spouse65 = false; n.dualEarner = false; }
    if (k === "newborn" && v && n.infants === 0) n.infants = 1;
    if (k === "infants" && v === 0) n.newborn = false;
    return n;
  });
  const kids = hh.infants + hh.elem + hh.middle + hh.high;
  const next = () => (step < TOTAL ? setStep(step + 1) : onFinish(hh, income));
  const noAsset = () => { setHasAsset(false); setHh((h) => ({ ...h, housingAsset: 0, financialAsset: 0, debt: 0 })); setStep(step + 1); };
  const askResidence = hh.region === GS && hh.thirdChild7to18; // 거주 기간은 경산 다자녀 지원(3년 이상 거주)에만 쓰인다
  // 첫 질문에서 뒤로: 처음 계산이면 시작 화면, 수정 중이면 결과 화면으로
  const back = () => (step > 1 || (step === 1 && !editing) ? setStep(step - 1) : onCancel());

  if (step === 0) {
    return (
      <div className="screen">
        <div className="screen-body col wide">
          <div className="start-grid">
          <div className="start-main">
          <section className="hero">
            <span className="badge intro" style={{ "--d": "0ms" }}>오름 · 복지 절벽 시뮬레이터</span>
            <h1><span className="intro" style={{ "--d": "120ms" }}>소득이 오르면,</span><br /><span className="intro" style={{ "--d": "260ms" }}>받는 복지는 <em>어떻게 바뀔까요?</em></span></h1>
            <p className="intro" style={{ "--d": "420ms" }}>몇 가지만 알려 주시면 지금 받을 수 있는 복지와, 소득이 늘 때 혜택이 한꺼번에 끊기는 <b>복지 절벽</b>이 어디에 있는지 계산해 드려요.</p>
          </section>
          <button type="button" className="btn primary desk-cta intro" style={{ "--d": "560ms" }} onClick={() => setStep(1)}>내 상황 계산하기</button>
          <p className="privacy intro" style={{ "--d": "640ms" }}>입력한 내용은 서버로 보내지 않고, 이 기기 안에서만 계산해요.</p>
          </div>
          <div className="start-side">
          {example && (
            <div className="example intro" style={{ "--d": "520ms" }}>
              <CliffLine />
              <p className="label">예시 · {example.who}</p>
              <b>월급이 1만 원 오르자</b><br />
              <span>생활비가 <b className="bad"><CountUp value={example.drop} delay={1500} /> 원</b> 줄었어요</span>
              {example.lost.length > 0 && <p className="note" style={{ marginTop: 6 }}>{example.lost[0]}{iga(example.lost[0])} 끊겨서</p>}
            </div>
          )}
          <div className="presets intro" style={{ "--d": "700ms" }}>
            <p className="label">예시 가구로 먼저 보기</p>
            {PRESETS.map((p) => (
              <button type="button" className="preset" key={p.key} onClick={() => onPreset(p)}>
                <b style={{ fontWeight: 600 }}>{p.title}</b><span>{p.sub} ›</span>
              </button>
            ))}
          </div>
          </div>
          </div>
        </div>
        <div className="bottom mobile-bottom"><div className="col"><button type="button" className="btn primary" onClick={() => setStep(1)}>내 상황 계산하기</button></div></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="col" style={{ paddingTop: 4 }}>
        <button type="button" className="back" onClick={back} aria-label="이전">‹</button>
        {/* 단계 탭: 지난 단계는 눌러서 돌아갈 수 있음 */}
        <nav className="steps" aria-label={`질문 ${step} / ${TOTAL}`}>
          {STEPS.map((name, i) => {
            const n = i + 1, state = n === step ? "on" : n < step ? "done" : "";
            return (
              <button type="button" key={name} className={`step ${state}`} disabled={n > step} aria-current={n === step ? "step" : undefined} onClick={() => setStep(n)}>
                <span className="num">{n}</span><span className="name">{name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="screen-body col">
        {step === 1 && <>
          <h1 className="title">어디에 사세요?</h1>
          <p className="desc">사는 곳에 따라 주거급여와 지자체 혜택이 달라져요</p>
          <div className="options">
            {regions.map((r) => <Option key={r} on={hh.region === r} onClick={() => set("region", r)} sub={r}>{short(r)}</Option>)}
          </div>
          <p className="note">지금은 대구 북구와 경산시만 계산할 수 있어요</p>
        </>}

        {step === 2 && <>
          <h1 className="title">가족은 어떻게 되세요?</h1>
          <p className="desc">함께 사는 가족 기준이에요</p>
          <div className="field"><span>본인 나이</span><Stepper label="본인 나이" value={hh.age} min={19} max={100} suffix="세" onChange={(v) => set("age", v)} /></div>
          <div className="field"><span>배우자</span><Seg label="배우자" options={[[false, "없음"], [true, "있음"]]} value={hh.spouse} onChange={(v) => set("spouse", v)} /></div>
          {hh.spouse && <>
            <div className="field"><span>배우자도 65세 이상</span><Seg label="배우자 65세 이상" options={[[false, "아니요"], [true, "네"]]} value={hh.spouse65} onChange={(v) => set("spouse65", v)} /></div>
            <div className="field"><span className="field-name">맞벌이<small>배우자 연 소득 300만 원 이상</small></span><Seg label="맞벌이" options={[[false, "아니요"], [true, "네"]]} value={hh.dualEarner} onChange={(v) => set("dualEarner", v)} /></div>
          </>}
          <p className="group-title">자녀</p>
          {[["infants", "영유아", "0~6세"], ["elem", "초등학생", ""], ["middle", "중학생", ""], ["high", "고등학생", ""]].map(([k, label, sub]) => (
            <div className="field" key={k}><span className="field-name">{label}{sub && <small>{sub}</small>}</span><Stepper label={label} value={hh[k]} max={5} suffix="명" onChange={(v) => set(k, v)} /></div>
          ))}
        </>}

        {step === 3 && <>
          <h1 className="title">해당하는 게 있나요?</h1>
          <p className="desc">없으면 그냥 넘어가도 돼요. 여러 개 고를 수 있어요</p>
          <div className="options">
            <Option on={hh.singleParent} onClick={() => set("singleParent", !hh.singleParent)} sub={hh.spouse ? "고르면 '배우자 있음'이 해제돼요" : null}>한부모 가구예요</Option>
            <Option on={hh.disabled} onClick={() => set("disabled", !hh.disabled)}>장애가 있는 가족이 있어요</Option>
            <Option on={hh.severeDisabled} onClick={() => set("severeDisabled", !hh.severeDisabled)}>본인이 심한 장애예요</Option>
            <Option on={hh.newborn} onClick={() => set("newborn", !hh.newborn)}>올해 아이가 태어났어요</Option>
            {hh.newborn && <>
              <div className="field" style={{ paddingTop: 8 }}><span>몇째 아이인가요?</span><Seg label="출생 순위" options={[[1, "첫째"], [2, "둘째"], [3, "셋째"], [4, "넷째+"]]} value={hh.birthOrder} onChange={(v) => set("birthOrder", v)} /></div>
              {hh.birthOrder > kids && <p className="warn">자녀가 {kids}명으로 입력돼 있어요. {ORDINAL[hh.birthOrder]}라면 이전 화면에서 형제자매도 넣어 주세요.</p>}
            </>}
            <Option on={hh.thirdChild7to18} onClick={() => set("thirdChild7to18", !hh.thirdChild7to18)} sub="7~18세 셋째 이상">자녀가 셋 이상이에요</Option>
          </div>
          {askResidence && <div className="field"><span className="field-name">경산시에 산 기간<small>3년 이상이면 다자녀가정 지원 대상</small></span><Stepper label="거주 기간" value={Math.floor(hh.residenceMonths / 12)} max={50} suffix="년" onChange={(v) => set("residenceMonths", v * 12)} /></div>}
        </>}

        {step === 4 && <>
          <h1 className="title">재산이 있나요?</h1>
          <p className="desc">재산이 많으면 일부가 소득으로 계산돼 받는 복지가 줄 수 있어요</p>
          <div className="options">
            <Option on={hasAsset === false} onClick={noAsset} sub="바로 다음으로 넘어가요">거의 없어요</Option>
            <Option on={hasAsset === true} onClick={() => setHasAsset(true)} sub="대략적인 금액이면 충분해요">있어요</Option>
          </div>
          {hasAsset && <div style={{ marginTop: 8 }}>
            {[["housingAsset", "주택·전세보증금"], ["financialAsset", "예금·적금"], ["debt", "대출 등 부채"]].map(([k, label]) => (
              <div className="field" key={k}><span>{label}</span>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                  <ManwonInput aria-label={`${label} (만 원)`} value={hh[k]} onChange={(v) => set(k, v)}
                    style={{ width: 110, textAlign: "right", border: 0, borderBottom: "1px solid var(--line)", fontSize: 17, fontWeight: 600, padding: "4px 0", outline: "none" }} />만 원</span>
              </div>
            ))}
            <p className="note">토지·자동차는 아직 반영하지 않아요</p>
          </div>}
        </>}

        {step === 5 && <>
          <h1 className="title">한 달에 얼마 버세요?</h1>
          <p className="desc">직업과 상관없이 가족 모두가 일해서 버는 돈(월급·사업·아르바이트)을 더한 금액, 세금 떼기 전이에요</p>
          <label className="money">
            <input type="number" inputMode="numeric" min="0" step="1" value={Math.round(income / 10000)} aria-label="한 달 소득 (만 원)"
              onChange={(e) => setIncome(Math.max(0, Math.floor(Number(e.target.value) || 0)) * 10000)} />
            <span>만 원</span>
          </label>
          <div className="chips">
            {QUICK.map((q) => <button type="button" key={q} className={`chip ${income === q * 10000 ? "on" : ""}`} onClick={() => setIncome(q * 10000)}>{q ? `${q}만 원` : "소득 없음"}</button>)}
          </div>
          <p className="note">자영업·프리랜서는 매출이 아니라 경비를 뺀 소득을 넣어 주세요</p>
          <p className="privacy">입력한 내용은 서버로 보내지 않고, 이 기기 안에서만 계산해요.</p>
        </>}
      </div>

      <div className="bottom"><div className="col">
        <button type="button" className="btn primary" onClick={next} disabled={step === 4 && hasAsset === null}>{step === TOTAL ? "결과 보기" : "다음"}</button>
      </div></div>
    </div>
  );
}

// 시작 화면 그림: 소득이 오르면 생활비도 오르다가 혜택이 끊기는 곳에서 뚝 떨어지고 다시 오른다 (그려지는 애니메이션)
function CliffLine() {
  return (
    <svg className="cliff-line" viewBox="0 0 320 96" aria-hidden="true">
      <path className="cl-base" d="M8 88H312" />
      <path className="cl-path" pathLength="1" d="M8 78 L60 66 L112 52 L164 36 L164 64 L216 52 L268 38 L312 26" />
      <circle className="cl-dot" cx="164" cy="64" r="6" />
      <circle className="cl-ring" cx="164" cy="64" r="6" />
    </svg>
  );
}

// 숫자가 0에서 목표값까지 올라가는 표시. 움직임 줄이기 설정이면 바로 목표값
function CountUp({ value, delay = 0, duration = 900 }) {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [v, setV] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setV(value); return; }
    let raf, start;
    const t = setTimeout(() => {
      const tick = (now) => {
        start ??= now;
        const k = Math.min(1, (now - start) / duration);
        setV(Math.round(value * (1 - (1 - k) ** 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [value, delay, duration, reduce]);
  return manwon(v);
}
