import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { won } from "../../lib/format.js";
import { useJson } from "../../lib/useJson.js";
import { PageHead } from "../adminUi.jsx";

const FIELD_LABEL = {
  age: "나이", household_size: "가구원 수", income_recognized_pct_median: "소득인정액 (중위소득 %)",
  income_recognized_won: "소득인정액 (원)", total_income_annual: "연간 총소득", assets: "재산",
  recipient_status: "수급 자격", basic_pension_recipient: "기초연금 수급", residence_region: "거주 지역",
  residence_months: "거주 기간 (개월)", child_count: "자녀 수", child_age: "자녀 나이", child_birth_order: "자녀 출생 순위",
  newborn: "신생아", school_enrolled: "초·중·고 재학", disabled: "장애인", single_parent: "한부모",
  senior_in_household: "노인 가구원", nhis_premium: "건강보험료", other: "기타 (문장)",
};
const OP_LABEL = { "<=": "이하", "<": "미만", ">=": "이상", ">": "초과", "==": "=", in: "중 하나", between: "사이" };
const STORE_KEY = "oreum-review-v1";
const norm = (s) => (s || "").replace(/[\s·•\-"'「」『』()[\]<>]/g, "");
const condKey = (c) => `${c.field} ${c.op} ${c.value}`;

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ }
}

// 채점 결과를 AI 조건별 상태로 바꾼다
function conditionStatus(svc) {
  const correct = new Set();
  for (const d of svc.eval.details) if (d.result === "정답" && d.ai) d.ai.split(" | ").forEach((k) => correct.add(k));
  const extras = new Set(svc.eval.extras);
  return svc.ai.conditions.map((c) => {
    const k = condKey(c);
    const grounded = !!norm(c.evidence) && c.evidence.split(/\s\/\s|…|\.\.\./).every((p) => !norm(p) || norm(svc.text).includes(norm(p)));
    let status = "ok-optional";
    if (c.field === "other") status = "other";
    else if (correct.has(k)) status = "ok";
    else if (extras.has(k)) status = "extra";
    return { ...c, key: k, status, grounded };
  });
}

const STATUS_LABEL = {
  ok: ["정답과 일치", "s-ok"], "ok-optional": ["허용 (선택 조건)", "s-ok"],
  extra: ["정답에 없음", "s-bad"], other: ["기타 · 사람 확인", "s-warn"],
};

// 원문에서 근거 인용 위치를 칠한다. 여러 조건이 같은(또는 겹치는) 문장을 인용하면 한 칸으로 합치고,
// 그 칸은 인용한 조건 중 어느 것에 마우스를 올려도 강조된다. 여러 구절을 ' / '·'…'로 이은 인용은 구절마다 찾는다.
function Highlighted({ text, evidences, active }) {
  const found = [];
  evidences.forEach((ev, i) => {
    if (!ev) return;
    for (const part of ev.split(/\s\/\s|…|\.\.\./).map((x) => x.trim()).filter(Boolean)) {
      let at = text.indexOf(part);
      let len = part.length;
      if (at < 0) { const head = part.slice(0, 18); at = text.indexOf(head); len = head.length; }
      if (at >= 0) found.push({ s: at, e: at + len, is: new Set([i]) });
    }
  });
  found.sort((a, b) => a.s - b.s || b.e - a.e);
  const ranges = [];
  for (const r of found) {
    const last = ranges[ranges.length - 1];
    if (last && r.s < last.e) { last.e = Math.max(last.e, r.e); r.is.forEach((x) => last.is.add(x)); } // 겹치면 합침
    else ranges.push({ ...r, is: new Set(r.is) });
  }
  const out = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.s > pos) out.push(text.slice(pos, r.s));
    out.push(<mark key={r.s} className={r.is.has(active) ? "ev active" : "ev"}>{text.slice(r.s, r.e)}</mark>);
    pos = r.e;
  }
  out.push(text.slice(pos));
  return <pre className="source-text">{out}</pre>;
}

function RunCompare({ runs }) {
  if (!runs?.v1 || !runs?.v2) return null;
  const rows = [
    ["서비스 정확도", "service_accuracy"], ["판정 가능 여부 일치", "judgeable_agreement"],
    ["조건 재현율", "condition_recall"], ["근거 인용 일치", "evidence_grounding"],
  ];
  return (
    <div className="stats">
      {rows.map(([label, k]) => (
        <div className="stat" key={k}>
          <div className="label">{label}</div>
          <div className="value"><small>{Math.round(runs.v1[k] * 100)}% →</small> {Math.round(runs.v2[k] * 100)}<small>%</small></div>
        </div>
      ))}
    </div>
  );
}

export default function Review() {
  const { data, error } = useJson("/data/review.json");
  const [store, setStore] = useState(loadStore);
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  useEffect(() => { saveStore(store); }, [store]);
  useEffect(() => { if (data && !sel) setSel(data.services[0].id); }, [data, sel]);

  const svc = useMemo(() => data?.services.find((s) => s.id === sel), [data, sel]);
  const conds = useMemo(() => (svc ? conditionStatus(svc) : []), [svc]);

  if (error) return <main className="page"><p className="empty">검수 데이터를 불러오지 못했습니다: {String(error.message)}</p></main>;
  if (!data || !svc) return <main className="page"><p className="empty">불러오는 중…</p></main>;

  const rec = store[svc.id] || { conditions: {}, done: false };
  const setRec = (fn) => setStore((s) => ({ ...s, [svc.id]: fn(s[svc.id] || { conditions: {}, done: false }) }));
  const decide = (i, decision) => setRec((r) => ({ ...r, done: false, conditions: { ...r.conditions, [i]: decision } }));
  const missing = svc.eval.details.filter((d) => d.result !== "정답");
  const flags = [
    !svc.ai.judgeable && "판정 불가로 표시됨",
    conds.some((c) => c.field === "other") && `'기타' 조건 ${conds.filter((c) => c.field === "other").length}개`,
    conds.some((c) => !c.grounded) && "근거 문장이 원문과 다름",
    !svc.eval.amount_ok && "금액이 정답과 다름",
    missing.length > 0 && `놓친 조건 ${missing.length}개`,
  ].filter(Boolean);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ai_folder: data.ai_folder, reviews: store }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "oreum-review.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doneCount = data.services.filter((s) => store[s.id]?.done).length;

  return (
    <>
      <main className="page">
        <PageHead title={<>AI가 만든 규칙, <em>사람이 확인해요</em></>}
          desc="복지로 원문을 GPT-5가 판정 규칙으로 바꿨어요. 원문과 나란히 보며 조건마다 승인·수정·삭제하고, 결과를 JSON으로 내보내요. 승인된 규칙만 규칙 파일(rules.json)에 반영하는 구조이고, 지금은 이 반영을 사람이 직접 해요.">
          <span className="pill brand">학습용 서비스 13건</span>
        </PageHead>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">이 화면의 13건: 1차 → 2차 정확도 (사람이 만든 정답과 비교)</h2>
            <span className="hint">모델 {svc.meta.model || "-"}</span>
          </div>
          <RunCompare runs={data.runs} />
          <p className="hint">2차는 1차 오류를 분석해 프롬프트를 고친 결과입니다. 같은 13건으로 고치고 다시 쟀기 때문에 실제보다 높게 나옵니다. 처음 보는 서비스로 잰 점수(2차 36% → 3차 81%)는 <Link to="/admin/ai">AI 성능</Link> 페이지에 있습니다.</p>
        </section>

        <div className="review-layout">
          <aside className="card review-list">
            <div className="card-head">
              <h2 className="card-title">서비스 ({doneCount}/{data.services.length} 검수 완료)</h2>
            </div>
            <ul>
              {data.services.map((s) => (
                <li key={s.id}>
                  <button className={s.id === sel ? "active" : ""} onClick={() => { setSel(s.id); setActive(null); setEditing(null); }}>
                    <span className="rv-name">{s.name}</span>
                    <span className="rv-sub">{s.provider}</span>
                    <span className="rv-badges">
                      <span className={`pill ${s.eval.service_ok ? "s-ok" : "s-warn"}`}>{s.eval.service_ok ? "AI 정답" : "차이 있음"}</span>
                      {store[s.id]?.done && <span className="pill s-done">검수 완료</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn" onClick={exportJson}>검수 결과 내보내기 (JSON)</button>
            <p className="hint">검수 내용은 이 브라우저에만 저장됩니다.</p>
          </aside>

          <section className="review-main">
            <div className="card">
              <div className="card-head">
                <h2 className="card-title">{svc.name} <span className="hint">· {svc.provider}</span></h2>
                <span className="hint">{svc.source}</span>
              </div>
              {flags.length > 0
                ? <div className="rv-check warn"><b>먼저 확인할 것</b> {flags.join(" · ")}</div>
                : <div className="rv-check ok"><b>자동 점검 통과</b> 빠르게 확인한 뒤 승인할 수 있어요.</div>}
            </div>

            <div className="review-cols">
              <div className="card">
                <h3 className="card-title">복지로 원문</h3>
                <p className="hint">노란색 = AI가 근거로 인용한 문장. 오른쪽 조건에 마우스를 올리면 해당 근거가 진하게 표시됩니다.</p>
                <Highlighted text={svc.text} evidences={conds.map((c) => c.evidence)} active={active} />
              </div>

              <div className="card">
                <h3 className="card-title">AI가 만든 판정 규칙</h3>
                <div className="rv-judge">
                  판정 가능: <b>{svc.ai.judgeable ? "예" : "아니요"}</b>
                  <span className={`pill ${svc.eval.judgeable_ok ? "s-ok" : "s-bad"}`}>{svc.eval.judgeable_ok ? "정답과 일치" : "정답과 다름"}</span>
                  {!svc.ai.judgeable && <p className="hint">사유: {svc.ai.not_judgeable_reason}</p>}
                </div>
                <ul className="cond-list">
                  {conds.map((c, i) => {
                    const d = rec.conditions[i];
                    const [label, cls] = STATUS_LABEL[c.status];
                    return (
                      <li key={i} className={`cond ${d?.type === "reject" ? "rejected" : ""}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                        <div className="cond-head">
                          <span className="cond-field">{FIELD_LABEL[c.field] || c.field}</span>
                          {c.group && <span className="pill s-group">그룹: {c.group}</span>}
                          <span className={`pill ${cls}`}>{label}</span>
                          {!c.grounded && <span className="pill s-bad">근거 불일치</span>}
                        </div>
                        {editing === i ? (
                          <div className="cond-edit">
                            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="고친 값" />
                            <button className="btn sm" disabled={!draft.trim()} title={draft.trim() ? "" : "값을 입력해야 저장할 수 있어요"}
                              onClick={() => { if (!draft.trim()) return; decide(i, { type: "edit", value: draft.trim() }); setEditing(null); }}>저장</button>
                            <button className="btn sm ghost" onClick={() => setEditing(null)}>취소</button>
                          </div>
                        ) : (
                          <div className="cond-value">{OP_LABEL[c.op] && c.field !== "other" ? <><b>{d?.type === "edit" ? d.value : c.value}</b> {OP_LABEL[c.op]}</> : <b>{d?.type === "edit" ? d.value : c.value}</b>}
                            {d?.type === "edit" && <span className="pill s-done">수정됨 (원래: {c.value})</span>}</div>
                        )}
                        <div className="cond-ev">“{c.evidence}”</div>
                        <div className="cond-actions">
                          <button className={`btn sm ${d?.type === "approve" ? "on" : ""}`} onClick={() => decide(i, { type: "approve" })}>승인</button>
                          <button className={`btn sm ${d?.type === "edit" ? "on" : ""}`} onClick={() => { setEditing(i); setDraft(d?.value ?? c.value); }}>수정</button>
                          <button className={`btn sm ${d?.type === "reject" ? "on danger" : ""}`} onClick={() => decide(i, { type: "reject" })}>삭제</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {missing.length > 0 && (
                  <div className="warn">
                    <b>AI가 놓친 조건 (정답지 기준)</b>
                    <ul>{missing.map((m) => <li key={m.gold}>{m.gold} — {m.result}{m.ai ? ` (AI: ${m.ai})` : ""}</li>)}</ul>
                  </div>
                )}
                <div className="rv-benefit">
                  <b>지원 금액</b>: {svc.ai.benefit.monthly_amount_won ? `월 ${won(svc.ai.benefit.monthly_amount_won)}` : "0원 (계산식이거나 원문에 금액 없음)"}
                  <span className={`pill ${svc.eval.amount_ok ? "s-ok" : "s-bad"}`}>{svc.eval.amount_ok ? "정답과 일치" : "정답과 다름"}</span>
                  <p className="hint">AI 설명: {svc.ai.benefit.amount_text} · 정답 메모: {svc.gold.benefit.note}</p>
                </div>
                <div className="rv-finish">
                  <label className="field"><span>검수 메모</span>
                    <textarea rows="2" value={rec.note || ""} onChange={(e) => setRec((r) => ({ ...r, note: e.target.value }))} placeholder="예: 근로장려금 소득 기준을 가구 유형별 숫자 조건으로 다시 입력" />
                  </label>
                  <button className={`btn ${rec.done ? "on" : "primary"}`} onClick={() => setRec((r) => ({ ...r, done: !r.done }))}>
                    {rec.done ? "검수 완료됨 (다시 열기)" : "이 서비스 검수 완료"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
