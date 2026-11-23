import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { won } from "../../lib/format.js";
import { ROLE_LABEL, STATUS, TRANSITIONS, canReview, computable, decide } from "../../lib/permissions.js";
import { loadOverlay, mergePrograms, resetOverlay, saveOverlay, supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { PageHead } from "../adminUi.jsx";
import { SignIn, useSession } from "../session.jsx";

const FIELD_LABEL = {
  age: "나이", household_size: "가구원 수", income_recognized_pct_median: "소득인정액 (중위소득 %)",
  income_recognized_won: "소득인정액 (원)", total_income_annual: "연간 총소득", assets: "재산",
  recipient_status: "수급 자격", basic_pension_recipient: "기초연금 수급", residence_region: "거주 지역",
  residence_months: "거주 기간 (개월)", child_count: "자녀 수", child_age: "자녀 나이", child_birth_order: "자녀 출생 순위",
  newborn: "신생아", school_enrolled: "초·중·고 재학", disabled: "장애인", single_parent: "한부모",
  senior_in_household: "노인 가구원", nhis_premium: "건강보험료", third_child_7to18: "셋째 이상 자녀(7~18세)", other: "기타 (문장)",
};
const OP_LABEL = { "<=": "이하", "<": "미만", ">=": "이상", ">": "초과", "==": "", in: "중 하나", not_in: "아님", between: "사이" };
const STATUS_CLASS = { "검토 대기": "s-warn", 승인: "s-ok", 반려: "s-bad", 중지: "s-bad" };
const KIND_LABEL = { cash: "현금", inkind: "감면·현물", access: "자격·융자" };
const ACTION_LABEL = { 승인: "승인", 반려: "반려", 중지: "계산에서 빼기(중지)", "검토 대기": "다시 검토" };

// 지자체 제도 검토: 담당자는 자기 지자체 제도만 보고, 원문과 대조해 승인·반려한다. 승인한 제도만 계산기에 들어간다.
export default function LocalPrograms() {
  const { mode, user, ready, signOut } = useSession();
  const { data } = useJson("/data/rules.json");
  const { data: draftFile } = useJson("/data/local_drafts.json");
  const [programs, setPrograms] = useState(null);
  const [status, setStatus] = useState("검토 대기");
  const [pickedId, setPickedId] = useState(null);
  const [msg, setMsg] = useState("");

  // 목록 불러오기: 데모는 기본 제도 + AI 초안 + 이 브라우저의 결정, Supabase는 DB (RLS가 권한에 맞는 행만 돌려준다)
  useEffect(() => {
    if (!user || !data) return;
    (async () => {
      if (mode === "supabase") {
        try {
          const sb = await supabaseClient();
          const [{ data: rows, error }, { data: events }] = await Promise.all([
            sb.from("local_programs").select("*").order("region"),
            sb.from("program_events").select("*").order("at"), // 결정 이력 (RLS: 담당 지역 것만)
          ]);
          if (error) throw error;
          const history = {};
          for (const e of events || []) (history[e.program_id] ||= []).push({ at: e.at, by: e.actor_name || "", from: e.from_status, to: e.to_status, reason: e.reason || "" });
          setPrograms(rows.map((p) => ({ ...p, history: history[p.id] || [] })));
        } catch {
          setPrograms([]);
          setMsg("제도 목록을 불러오지 못했어요.");
        }
      } else if (draftFile) {
        setPrograms(mergePrograms(data.local_programs, draftFile.drafts, loadOverlay()));
      }
    })();
  }, [mode, user, data, draftFile]);

  const mine = useMemo(() => (programs || []).filter((p) => canReview(user, p)), [programs, user]);
  const shown = mine.filter((p) => p.status === status);
  const picked = mine.find((p) => p.id === pickedId) || shown[0] || null;
  const facts = data?.local_program_spec?.facts || [];

  if (!ready) return <p className="hint">불러오는 중…</p>;
  if (!user) {
    return (
      <div className="page">
        <PageHead title="지자체 제도 검토" desc="AI가 원문에서 만든 지자체 제도 초안을 담당자가 원문과 대조해 승인합니다. 승인한 제도만 계산기에 들어갑니다." />
        <SignIn />
      </div>
    );
  }

  const apply = async (to, opts) => {
    setMsg("");
    const res = decide(user, picked, to, { ...opts, facts });
    if (res.error) { setMsg(res.error); return; }
    if (mode === "supabase") {
      const p = res.program;
      try {
        const sb = await supabaseClient();
        // 승인자·승인일은 DB 트리거가 채운다
        const { error } = await sb.from("local_programs").update({
          status: p.status, amount: p.amount, apply_checks: p.apply_checks ?? [], reason: p.reason ?? null,
        }).eq("id", p.id);
        if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return; }
      } catch {
        setMsg("서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); return;
      }
    } else {
      const overlay = loadOverlay();
      overlay[res.program.id] = res.program;
      if (!saveOverlay(overlay)) { setMsg("이 브라우저에 저장할 수 없어요."); return; }
    }
    setPrograms((all) => all.map((p) => (p.id === res.program.id ? res.program : p)));
    setMsg(to === "승인" ? `승인했어요. ${mode === "supabase" ? "계산기에 바로 반영돼요." : "이 브라우저의 계산기에 반영돼요 (데모)."}` : `'${to}'(으)로 바꿨어요.`);
  };

  const counts = Object.fromEntries(STATUS.map((s) => [s, mine.filter((p) => p.status === s).length]));
  return (
    <div className="page">
      <PageHead title="지자체 제도 검토" desc="AI 초안을 원문과 대조해 승인하면 계산기에 들어갑니다. 계산할 수 없는 조건(기타 문장 등)이 있으면 승인할 수 없어요.">
        <div className="who">
          <b>{user.name}</b>
          <span className="pill brand">{ROLE_LABEL[user.role]}{user.region ? ` · ${user.region}` : user.sido ? ` · ${user.sido}` : " · 전체 지역"}</span>
          <button type="button" className="btn sm ghost" onClick={signOut}>로그아웃</button>
        </div>
      </PageHead>
      {mode === "demo" && (
        <p className="notice">데모 모드: 결정은 이 브라우저에만 저장되고, 권한 검사도 화면에서만 해요 (보안 아님).
          실제 운영은 Supabase 로그인과 DB 행 단위 보안으로 강제해요 · <button type="button" className="link-btn" onClick={() => { resetOverlay(); setPrograms(mergePrograms(data.local_programs, draftFile.drafts, {})); setMsg("데모 결정을 모두 지웠어요."); }}>데모 결정 초기화</button></p>
      )}
      <div className="status-tabs" role="tablist">
        {STATUS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn sm ${status === s ? "on" : ""}`} onClick={() => { setStatus(s); setPickedId(null); }}>
            {s} {counts[s]}
          </button>
        ))}
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
      {!programs ? <p className="hint">불러오는 중…</p> : mine.length === 0 ? <p className="empty">검토할 수 있는 제도가 없어요.</p> : (
        <div className="lp-cols">
          <ul className="lp-list" aria-label={`${status} 제도`}>
            {shown.length === 0 && <li className="hint">이 상태의 제도가 없어요.</li>}
            {shown.map((p) => {
              const c = computable(p, facts);
              return (
                <li key={p.id}>
                  <button type="button" className={`lp-item ${picked?.id === p.id ? "on" : ""}`} onClick={() => setPickedId(p.id)}>
                    <b>{p.name}</b>
                    <small>{user.role === "admin" ? `${p.region || p.sido} · ` : ""}{p.origin?.type === "ai" ? `AI 초안 (${p.origin.prompt} 프롬프트)` : "기존 규칙"}{c.ok ? "" : " · 계산 불가 조건 있음"}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked && <Detail key={picked.id} p={picked} facts={facts} onAct={apply} />}
        </div>
      )}
      <p className="hint" style={{ marginTop: 16 }}>승인된 제도는 <Link to="/">계산기</Link>에서 그 지역을 고르면 '지자체' 혜택으로 계산돼요.</p>
    </div>
  );
}

function Detail({ p, facts, onAct }) {
  const [monthly, setMonthly] = useState(p.amount?.monthly ?? 0);
  const [reason, setReason] = useState("");
  const [later, setLater] = useState(() => new Set(p.apply_checks || []));
  const pending = p.status === "검토 대기";
  const c = computable({ ...p, amount: { ...p.amount, monthly }, apply_checks: [...later] }, facts);
  const toggle = (i) => setLater((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const editableAmount = p.status === "검토 대기" && p.amount?.type === "fixed" && !p.amount.param;
  const next = TRANSITIONS[p.status] || [];
  return (
    <section className="card lp-detail">
      <div className="card-head">
        <h2 className="card-title">{p.name}</h2>
        <span className={`pill ${STATUS_CLASS[p.status]}`}>{p.status}</span>
      </div>
      <p className="hint">{p.region || p.sido} · {KIND_LABEL[p.kind] || p.kind} · 출처: {p.source || "—"}</p>
      {p.origin?.type === "ai" && (
        <p className={p.origin.judgeable ? "hint" : "warn"}>
          AI(GPT-5, {p.origin.prompt} 프롬프트) 판단: 판정 {p.origin.judgeable ? "가능" : "불가"}{p.origin.not_judgeable_reason ? ` — ${p.origin.not_judgeable_reason}` : ""}
        </p>
      )}
      <h3 className="card-title">조건</h3>
      <ul className="cond-list">
        {(p.conditions || []).map((x, i) => {
          const known = facts.includes(x.field);
          const atApply = later.has(i);
          return (
            <li key={i} className="cond">
              <div className="cond-head">
                <span className="cond-field">{FIELD_LABEL[x.field] || x.field}</span>
                {x.group && <span className="pill s-group">하나 이상: {x.group}</span>}
                <span className={`pill ${known ? "s-ok" : atApply ? "s-warn" : "s-bad"}`}>{known ? "계산 가능" : atApply ? "신청할 때 확인" : "계산 불가"}</span>
              </div>
              {!known && x.field === "other" && pending && (
                <label className="check-later"><input type="checkbox" checked={atApply} onChange={() => toggle(i)} /> 신청할 때 확인하는 조건으로 두기 (계산에서 빼고 결과에 안내)</label>
              )}
              <div className="cond-value"><b>{x.value}</b> {OP_LABEL[x.op] ?? x.op}</div>
              {x.evidence && <div className="cond-ev">“{x.evidence}”</div>}
            </li>
          );
        })}
      </ul>
      <h3 className="card-title">금액</h3>
      {editableAmount ? (
        <label className="field"><span>월 금액 (원) <small className="hint">{p.amount_text || ""}</small></span>
          <input type="number" min="0" step="1000" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
      ) : <p>{p.amount?.type === "fixed" ? `월 ${won(p.amount.param ? 0 : p.amount.monthly || 0)}` : `계산식 (${p.amount?.type})`} · {p.note}</p>}
      {p.text && <details className="lp-text"><summary>복지로 원문 보기</summary><pre>{p.text}</pre></details>}
      {!c.ok && p.status === "검토 대기" && (
        <p className="warn">{c.unknown.length > 0
          ? <>계산할 수 없는 조건이 {c.unknown.length}개 있어요. 원문을 보고 신청 단계에서 확인할 조건이면 '신청할 때 확인'으로 두고, 자격의 핵심이라 계산 없이는 의미가 없으면 반려해 주세요.</>
          : <>계산하는 조건이 하나도 없어요. 거주 지역만으로는 모든 주민이 받는 것으로 계산되므로 승인할 수 없어요.</>}</p>
      )}
      {next.length > 0 && (
        <div className="lp-actions">
          {next.some((t) => t === "반려" || t === "중지") && (
            <label className="field"><span>사유 (반려·중지 시 필수)</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 원문의 소득 기준이 조건에 빠짐" /></label>
          )}
          <div className="lp-buttons">
            {next.map((t) => (
              <button key={t} type="button" className={`btn ${t === "승인" ? "primary" : ""}`}
                disabled={t === "승인" && !c.ok} title={t === "승인" && !c.ok ? "계산할 수 없는 조건이 있어요" : ""}
                onClick={() => onAct(t, { reason, monthly: editableAmount ? monthly : undefined, applyChecks: pending ? [...later] : undefined })}>{ACTION_LABEL[t]}</button>
            ))}
          </div>
        </div>
      )}
      {(p.history || []).length > 0 && (
        <>
          <h3 className="card-title">이력</h3>
          <ul className="lp-history">
            {p.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace("T", " ")} · {h.by} · {h.from} → {h.to}{h.reason ? ` (${h.reason})` : ""}</li>)}
          </ul>
        </>
      )}
      {p.approved_at && <p className="hint">승인: {p.approved_by} · {p.approved_at}</p>}
    </section>
  );
}
