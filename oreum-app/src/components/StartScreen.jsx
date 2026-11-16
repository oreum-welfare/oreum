import { useState } from "react";
import { man, won } from "../lib/format.js";
import { Icon, Segmented, Stepper } from "./ui.jsx";

const STEPS = ["사는 곳", "가족", "해당하는 것", "소득"];
const CHIPS = [
  ["singleParent", "한부모 가구"], ["disabled", "장애인 가구원이 있어요"], ["severeDisabled", "본인이 심한 장애예요"],
  ["newborn", "올해 아이가 태어났어요"], ["thirdChild7to18", "셋째 이상 자녀(7~18세)가 있어요"],
];
const QUICK = [0, 100, 200, 300, 400];

// 처음 들어왔을 때 보이는 시작 화면: 질문을 한 단계씩 묻고 결과로 넘어간다
export default function StartScreen({ regions, short, defaults, presets, example, onFinish, onPreset }) {
  const [step, setStep] = useState(0);
  const [hh, setHh] = useState({ ...defaults, age: 35 });
  const [income, setIncome] = useState(2000000);
  const set = (k, v) => setHh((h) => {
    const n = { ...h, [k]: v };
    if (k === "spouse" && !v) { n.spouse65 = false; n.dualEarner = false; }
    if (k === "spouse" && v) n.singleParent = false; // 배우자가 있으면 한부모 가구가 아님
    if (k === "singleParent" && v) { n.spouse = false; n.spouse65 = false; n.dualEarner = false; }
    if (k === "newborn" && v && n.infants === 0) n.infants = 1;
    if (k === "infants" && v === 0) n.newborn = false; // 영유아가 없으면 올해 출산 아님
    return n;
  });
  const last = step === STEPS.length - 1;
  const kids = hh.infants + hh.elem + hh.middle + hh.high;

  return (
    <main className="page start">
      <section className="start-intro">
        <span className="eyebrow">오름 · 복지 절벽 시뮬레이터</span>
        <h1>소득이 오르면,<br />받는 복지는 <em>어떻게 바뀔까요?</em></h1>
        <p>몇 가지만 알려 주시면 지금 받을 수 있는 복지와, 소득이 늘 때 혜택이 한꺼번에 끊기는 <b>복지 절벽</b>이 어디에 있는지 계산해 드려요.</p>
        {example && (
          <div className="start-example">
            <span className="ex-badge">예시</span>
            <div><b>월 {man(example.from)} 원 → {man(example.to)} 원</b>
              <span>1만 원 더 벌었더니 한 달에 쓸 수 있는 돈이 <b className="bad">{won(example.drop)}</b> 줄었어요 ({example.lost.join(", ")} 종료)</span></div>
          </div>
        )}
      </section>

      <section className="card wizard" aria-label="우리 가구 정보 입력">
        <div className="progress" aria-label={`${STEPS.length}단계 중 ${step + 1}단계`}>
          {STEPS.map((s, i) => (
            <button type="button" key={s} className={i === step ? "on" : i < step ? "done" : ""} onClick={() => i < step && setStep(i)} disabled={i > step}>
              <span>{i < step ? "✓" : i + 1}</span>{s}
            </button>
          ))}
        </div>

        <div className="wizard-body">
          {step === 0 && <>
            <h2>어디에 사세요?</h2>
            <p className="hint">사는 곳에 따라 주거급여와 지자체 혜택이 달라져요.</p>
            <div className="region-pick">
              {regions.map((r) => (
                <button type="button" key={r} className={hh.region === r ? "on" : ""} onClick={() => set("region", r)}>
                  <Icon name="map" size={20} /><b>{short(r)}</b><span>{r}</span>
                </button>
              ))}
            </div>
            <p className="field-note">지금은 대구 북구·경산시만 계산해요. 다른 지역은 공공데이터 API와 AI로 넓혀 갈 예정이에요.</p>
          </>}

          {step === 1 && <>
            <h2>가족은 어떻게 되세요?</h2>
            <p className="hint">함께 사는 가족 기준이에요.</p>
            <div className="row big"><span>본인 나이</span><Stepper label="본인 나이" value={hh.age} min={19} max={100} suffix="세" onChange={(v) => set("age", v)} /></div>
            <div className="row big"><span>배우자</span><Segmented label="배우자" options={[[false, "없음"], [true, "있음"]]} value={hh.spouse} onChange={(v) => set("spouse", v)} /></div>
            {hh.spouse && (
              <div className="chips sub-chips">
                <button type="button" className={`chip ${hh.spouse65 ? "on" : ""}`} aria-pressed={hh.spouse65} onClick={() => set("spouse65", !hh.spouse65)}>배우자 65세 이상</button>
                <button type="button" className={`chip ${hh.dualEarner ? "on" : ""}`} aria-pressed={hh.dualEarner} onClick={() => set("dualEarner", !hh.dualEarner)}>맞벌이</button>
              </div>
            )}
            <div className="kid-grid">
              {[["infants", "영유아 (0~6세)"], ["elem", "초등학생"], ["middle", "중학생"], ["high", "고등학생"]].map(([k, label]) => (
                <div className="kid" key={k}><span>{label}</span><Stepper label={label} value={hh[k]} max={5} onChange={(v) => set(k, v)} /></div>
              ))}
            </div>
            <p className="field-note">가구원 {Math.min(1 + (hh.spouse ? 1 : 0) + kids, 6)}명 (본인{hh.spouse ? " · 배우자" : ""}{kids ? ` · 자녀 ${kids}명` : ""})</p>
          </>}

          {step === 2 && <>
            <h2>해당하는 게 있나요?</h2>
            <p className="hint">없으면 그냥 넘어가셔도 돼요. 여러 개 고를 수 있어요.</p>
            <div className="chips big-chips">
              {CHIPS.map(([k, label]) => (
                <button key={k} type="button" className={`chip ${hh[k] ? "on" : ""}`} aria-pressed={hh[k]} onClick={() => set(k, !hh[k])}>{hh[k] && "✓ "}{label}</button>
              ))}
            </div>
            {hh.newborn && (
              <div className="row big"><span>몇째 아이인가요?</span>
                <Segmented label="출생 순위" options={[[1, "첫째"], [2, "둘째"], [3, "셋째"], [4, "넷째+"]]} value={hh.birthOrder} onChange={(v) => set("birthOrder", v)} />
                {hh.birthOrder > kids && <p className="field-note warn-note">자녀가 {kids}명으로 입력돼 있어요. {{ 1: "첫째", 2: "둘째", 3: "셋째", 4: "넷째 이상" }[hh.birthOrder]}라면 '이전'으로 돌아가 가족 칸에 형제자매도 넣어 주세요.</p>}
              </div>
            )}
            <p className="field-note">재산·거주 기간은 결과 화면에서 '정보 수정'으로 더 정확하게 넣을 수 있어요.</p>
          </>}

          {step === 3 && <>
            <h2>한 달에 얼마 버세요?</h2>
            <p className="hint">가족 모두의 근로소득을 더한 금액이에요 (세금 떼기 전).</p>
            <label className="income-big">
              <input type="number" inputMode="numeric" min="0" step="1" value={Math.round(income / 10000)}
                onChange={(e) => setIncome(Math.max(0, Math.floor(Number(e.target.value) || 0)) * 10000)} aria-label="월 근로소득 (만 원)" />
              <span>만 원</span>
            </label>
            <div className="chips">
              {QUICK.map((q) => <button type="button" key={q} className={`chip ${income === q * 10000 ? "on" : ""}`} onClick={() => setIncome(q * 10000)}>{q ? `${q}만 원` : "소득 없음"}</button>)}
            </div>
            <p className="field-note">결과 화면에서 소득을 움직이며 바로 비교할 수 있어요.</p>
          </>}
        </div>

        <div className="wizard-foot">
          {step > 0 ? <button type="button" className="btn" onClick={() => setStep(step - 1)}>이전</button> : <span />}
          <button type="button" className="btn primary big" onClick={() => (last ? onFinish(hh, income) : setStep(step + 1))}>
            {last ? "결과 보기" : "다음"}
          </button>
        </div>
        <p className="privacy"><Icon name="lock" size={14} />입력값은 서버로 보내지 않고 이 기기 안에서만 계산해요</p>
      </section>

      <section className="start-presets">
          <span className="hint">입력 없이 예시 가구로 바로 보기</span>
          <div className="preset-grid">
            {presets.map((p) => (
              <button type="button" key={p.key} onClick={() => onPreset(p)}><b>{p.title}</b><span>{p.sub}</span></button>
            ))}
          </div>
        </section>
    </main>
  );
}
