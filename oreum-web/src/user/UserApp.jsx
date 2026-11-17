import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createEngine } from "../lib/engine.js";
import { decodeState, encodeState } from "../lib/urlState.js";
import { useJson } from "../lib/useJson.js";
import { calculate } from "./calc.js";
import { DEFAULT_HH, PRESETS, STEP } from "./data.js";
import Logo from "../ui/Logo.jsx";
import Questions from "./Questions.jsx";
import Result from "./Result.jsx";

// 사용자 화면: 주소(쿼리)에 입력값이 있으면 결과, 없으면 시작·질문. 새로고침·공유해도 같은 화면.
export default function UserApp() {
  const { data, error } = useJson("/data/rules.json");
  const engine = useMemo(() => (data ? createEngine(data) : null), [data]);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false); // false 또는 수정을 시작할 질문 번호
  const [home, setHome] = useState(0); // 로고를 누를 때마다 올려 질문 화면을 시작 화면부터 다시 그린다
  const started = params.has("r");
  const st = useMemo(() => decodeState(params, DEFAULT_HH), [params]);
  const save = (next, push = false) => setParams(encodeState({ ...st, ...next }, DEFAULT_HH), { replace: !push });

  useEffect(() => { window.scrollTo(0, 0); }, [started, editing]);

  const r = useMemo(() => (engine && started ? calculate({ engine, data, ...st }) : null), [engine, data, started, st]);

  // 시작 화면 예시: 첫 번째 예시 가구의 가장 큰 절벽
  const example = useMemo(() => {
    if (!engine) return null;
    const p = PRESETS[0], h = { ...DEFAULT_HH, ...p.hh };
    const m = engine.medianIncome(engine.derive(h).size);
    const sim = engine.simulate(h, Math.round((m * 2) / STEP) * STEP, STEP, true);
    const top = engine.findCliffs(sim).sort((a, b) => b.drop - a.drop)[0];
    return top ? { who: p.title, drop: top.drop, lost: top.lost } : null;
  }, [engine]);

  if (error) return <main className="col"><p className="desc" style={{ marginTop: 40 }}>데이터를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p></main>;
  if (!engine) return <main className="col"><p className="label" style={{ marginTop: 40 }}>불러오는 중…</p></main>;

  const finish = (hh, income) => { setEditing(false); save({ hh, income, compare: null, includeInkind: true, preset: null }, true); };
  const preset = (p) => save({ hh: { ...DEFAULT_HH, ...p.hh }, income: p.income, compare: null, includeInkind: true, preset: p.key }, true);
  const restart = () => { setEditing(false); setParams(new URLSearchParams()); };
  const goHome = (e) => { e.preventDefault(); if (started) restart(); else setEditing(false); setHome((n) => n + 1); window.scrollTo(0, 0); };

  const showQuestions = !started || editing;
  return (
    <>
      <header className="topbar"><div className="col wide">
        <Link to="/" className="wordmark" onClick={goHome} aria-label="오름 처음 화면"><Logo height={26} /></Link>
        {started && !editing && <button type="button" className="top-action" onClick={() => setEditing(1)}>수정</button>}
      </div></header>
      <main>
        {showQuestions ? (
          <Questions key={editing ? `edit-${editing}` : `new-${home}`} regions={Object.keys(data.regions)}
            initial={started ? st.hh : { ...DEFAULT_HH, age: 35 }} initialIncome={started ? st.income : 2000000}
            editing={Boolean(editing)} startStep={editing || 1} example={example} onFinish={finish} onPreset={preset} onCancel={() => setEditing(false)} />
        ) : (
          <Result data={data} hh={st.hh} income={st.income} r={r} includeInkind={st.includeInkind}
            setIncludeInkind={(v) => save({ includeInkind: v })}
            setCompare={(v) => save({ compare: v })}
            adoptCompare={() => save({ income: r.cmp, compare: null }, true)}
            onEdit={(step) => setEditing(typeof step === "number" ? step : 1)} onRestart={restart} />
        )}
      </main>
    </>
  );
}
