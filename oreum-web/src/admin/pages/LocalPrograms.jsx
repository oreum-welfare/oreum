import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { won } from "../../lib/format.js";
import { ROLE_LABEL, STATUS, TRANSITIONS, canReview, computable, decide } from "../../lib/permissions.js";
import { FORMULA_VARS, SAMPLE_FACTS, evalFormula, validateFormula } from "../../lib/formula.js";
import { goneInfo, loadOverlay, newerVersionOf, mergePrograms, resetOverlay, saveOverlay, supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { ConfirmModal, PageHead } from "../adminUi.jsx";
import { RegionPicker, SignIn, useSession } from "../session.jsx";

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
  const { data: goneFile } = useJson("/data/source_gone.json"); // 매일 변경 확인: 복지로 목록에서 사라진 제도 (없으면 빈 목록)
  const goneMap = goneFile || {};
  const [programs, setPrograms] = useState(null);
  const [status, setStatus] = useState("검토 대기");
  const [pickedId, setPickedId] = useState(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(null); // 직접 등록: { from?: 새 버전을 만들 기존 제도 }
  const [q, setQ] = useState("");

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
  const shown = mine.filter((p) => p.status === status && (!q.trim() || `${p.name} ${p.region || ""}`.includes(q.trim())));
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
    // 새 버전을 승인하면 이전 버전은 자동으로 계산에서 뺀다 (같은 제도가 두 번 계산되지 않게)
    const old = to === "승인" && res.program.origin?.replaces && programs.find((p) => p.id === res.program.origin.replaces);
    if (old && old.status === "승인") {
      const r2 = decide(user, old, "중지", { reason: `새 버전(${res.program.name}) 승인`, facts });
      if (!r2.error && await save(r2.program)) setPrograms((all) => all.map((p) => (p.id === old.id ? r2.program : p)));
    }
    setMsg(to === "승인" ? `승인했어요. ${mode === "supabase" ? "계산기에 바로 반영돼요." : "이 브라우저의 계산기에 반영돼요 (데모)."}` : `'${to}'(으)로 바꿨어요.`);
  };

  // 결정 하나 저장 (새 버전 승인 때 이전 버전 중지에도 쓴다)
  async function save(prog) {
    if (mode === "supabase") {
      try {
        const sb = await supabaseClient();
        const { error } = await sb.from("local_programs").update({ status: prog.status, amount: prog.amount, apply_checks: prog.apply_checks ?? [], reason: prog.reason ?? null }).eq("id", prog.id);
        return !error;
      } catch { return false; }
    }
    const overlay = loadOverlay();
    overlay[prog.id] = prog;
    return saveOverlay(overlay);
  }

  // 직접 등록·새 버전: '검토 대기'로 넣는다 (DB: 담당 지역만 넣을 수 있음)
  const create = async (prog) => {
    setMsg("");
    if (mode === "supabase") {
      const cols = ["id", "name", "region", "sido", "kind", "conditions", "apply_checks", "amount", "amount_text", "note", "source", "origin", "text", "status"];
      try {
        const sb = await supabaseClient();
        const { error } = await sb.from("local_programs").insert(Object.fromEntries(cols.map((c) => [c, prog[c] ?? null])));
        if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return; }
      } catch {
        setMsg("서버에 연결하지 못했어요."); return;
      }
    } else {
      const overlay = loadOverlay();
      overlay[prog.id] = prog;
      if (!saveOverlay(overlay)) { setMsg("이 브라우저에 저장할 수 없어요."); return; }
    }
    setPrograms((all) => [prog, ...(all || [])]);
    setForm(null);
    setStatus("검토 대기");
    setPickedId(prog.id);
    setMsg(`'${prog.name}'을(를) 검토 대기로 올렸어요. 예시 계산과 조건을 다시 확인한 뒤 승인해 주세요.${prog.origin?.replaces ? " 승인하면 이전 버전은 자동으로 계산에서 빠져요." : ""}`);
  };

  const counts = Object.fromEntries(STATUS.map((s) => [s, mine.filter((p) => p.status === s).length]));
  // 승인돼 계산 중인데 원문(복지로 목록)에서 사라진 제도: 자동으로 빼지 않고 담당자에게 확인을 요청한다
  const goneApproved = mine.filter((p) => p.status === "승인" && goneInfo(p, goneMap));
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
      <section className="card lp-summary">
        <div className="lp-summary-head"><h2 className="card-title">제도 검토 현황</h2>
          <button type="button" className="btn primary" onClick={() => setForm({})}>+ 제도 직접 등록</button></div>
        <div className="lp-stats" role="tablist" aria-label="상태별 보기">
          {STATUS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={`lp-stat ${s === "검토 대기" ? "main" : ""} ${status === s ? "on" : ""}`} onClick={() => { setStatus(s); setPickedId(null); }}>
              <span>{s}</span><b>{counts[s]}</b>
            </button>
          ))}
        </div>
      </section>
      {form && data && <ProgramForm user={user} rules={data} facts={facts} from={form.from} onCancel={() => setForm(null)} onSubmit={create} />}
      {goneApproved.length > 0 && (
        <div className="warn" role="alert">
          <b>폐지 의심 {goneApproved.length}건</b> · 계산 중인 제도가 복지로 목록에서 3일 넘게 보이지 않아요. 원문을 확인하고, 폐지됐으면 '계산에서 빼기(중지)'를 눌러 주세요.
          <div className="lp-gone-list">
            {goneApproved.map((p) => (
              <button key={p.id} type="button" className="btn sm" onClick={() => { setStatus("승인"); setPickedId(p.id); }}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {!programs ? <p className="hint">불러오는 중…</p> : mine.length === 0 ? <p className="empty">검토할 수 있는 제도가 없어요.</p> : (
        <div className="lp-cols">
          <aside className="card lp-side">
            <div className="lp-side-head">
              <b>{status} 제도 <span className="hint">{shown.length}개</span></b>
              <input type="search" placeholder="제도명·지역 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="제도 검색" />
            </div>
            <ul className="lp-list" aria-label={`${status} 제도`}>
              {shown.length === 0 && <li className="hint">{q.trim() ? "검색 결과가 없어요." : "이 상태의 제도가 없어요."}</li>}
              {shown.map((p) => {
                const c = computable(p, facts);
                const gone = goneInfo(p, goneMap);
                const newer = p.status === "검토 대기" && newerVersionOf(p, mine);
                const checks = (p.conditions || []).filter((x) => !facts.includes(x.field)).length;
                const on = picked?.id === p.id;
                return (
                  <li key={p.id}>
                    <button type="button" className={`lp-item ${on ? "on" : ""}`} onClick={() => setPickedId(p.id)} aria-current={on ? "true" : undefined}>
                      <span className="lp-item-top"><b className="lp-name">{p.name}</b>{on && <span className="pill s-done">선택됨</span>}</span>
                      <small>{p.region || p.sido} · {p.origin?.type === "ai" ? `AI 초안 ${p.origin.prompt}` : p.origin?.type === "manual" ? `직접 등록${p.origin.replaces ? " · 새 버전" : ""}` : "기존 규칙"}</small>
                      <span className="lp-badges">
                        <span className={`pill ${c.ok ? "s-ok" : "s-bad"}`}>{c.ok ? "계산 가능" : "계산 불가"}</span>
                        {checks > 0 && <span className="pill s-group">확인 조건 {checks}개</span>}
                        {gone && <span className="pill s-warn">폐지 의심</span>}
                        {newer && <span className="pill s-warn">새 버전 있음</span>}
                        <span className={`pill ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          {picked && <Detail key={picked.id} p={picked} facts={facts} gone={goneInfo(picked, goneMap)} newer={newerVersionOf(picked, mine)} onPick={setPickedId} onAct={apply} onNewVersion={() => setForm({ from: picked })}
            prev={shown[shown.findIndex((x) => x.id === picked.id) - 1]} next={shown[shown.findIndex((x) => x.id === picked.id) + 1]} />}
        </div>
      )}
      <p className="hint" style={{ marginTop: 16 }}>승인된 제도는 <Link to="/">계산기</Link>에서 그 지역을 고르면 '지자체' 혜택으로 계산돼요.</p>
    </div>
  );
}

// 원문에서 조건의 근거 문장을 칠한다 (마우스를 올린 조건의 근거는 진하게)
function SourceText({ text, evidences, active }) {
  const found = [];
  evidences.forEach((ev, i) => {
    if (!ev) return;
    for (const part of ev.split(/\s\/\s|…|\.\.\./).map((x) => x.trim()).filter(Boolean)) {
      let at = text.indexOf(part), len = part.length;
      if (at < 0) { const head = part.slice(0, 16); at = text.indexOf(head); len = head.length; }
      if (at >= 0) found.push({ s: at, e: at + len, i });
    }
  });
  found.sort((a, b) => a.s - b.s);
  const out = []; let pos = 0;
  for (const r of found) {
    if (r.s < pos) continue;
    if (r.s > pos) out.push(text.slice(pos, r.s));
    out.push(<mark key={r.s} className={`ev ${r.i === active ? "active" : ""}`}>{text.slice(r.s, r.e)}</mark>);
    pos = r.e;
  }
  out.push(text.slice(pos));
  return <pre className="lp-source-text">{out}</pre>;
}

// 금액 설명을 항목별로 나눈다 (예: "0~12개월 20만 원, 13~24개월 10만 원" → 두 줄)
const amountParts = (t) => String(t || "").split(/\s*(?:,(?!\d{3})|[;·\n])\s*|\s+\/\s+/).map((x) => x.trim()).filter(Boolean);

function Detail({ p, facts, gone, newer, onPick, onAct, onNewVersion, prev, next: nextItem }) {
  const [hover, setHover] = useState(null);
  const [ask, setAsk] = useState(null); // 반려·중지 사유 창
  const [monthly, setMonthly] = useState(p.amount?.monthly ?? 0);
  const [reason, setReason] = useState("");
  const [later, setLater] = useState(() => new Set(p.apply_checks || []));
  const pending = p.status === "검토 대기";
  const outdated = pending && newer; // 같은 서비스의 더 새 버전이 있으면 이 초안은 승인하지 않는다
  const isFormula = p.amount?.type === "formula";
  const [formula, setFormula] = useState(isFormula ? p.amount : null);
  const c = computable({ ...p, amount: isFormula ? formula : { ...p.amount, monthly }, apply_checks: [...later] }, facts);
  const toggle = (i) => setLater((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const editableAmount = p.status === "검토 대기" && p.amount?.type === "fixed" && !p.amount.param;
  const next = TRANSITIONS[p.status] || [];
  const unknownCount = (p.conditions || []).filter((x, i) => !facts.includes(x.field) && !later.has(i)).length;
  const run = (t, why) => onAct(t, { reason: why ?? reason, monthly: editableAmount ? monthly : undefined, amount: isFormula && pending ? formula : undefined, applyChecks: pending ? [...later] : undefined });
  const parts = amountParts(p.amount_text);
  return (
    <section className="card lp-detail">
      <div className="lp-nav">
        <button type="button" className="btn sm" disabled={!prev} onClick={() => prev && onPick(prev.id)}>← 이전</button>
        <button type="button" className="btn sm" disabled={!nextItem} onClick={() => nextItem && onPick(nextItem.id)}>다음 →</button>
      </div>
      <div className="card-head">
        <h2 className="card-title lp-title">{p.name}</h2>
        <span className={`pill ${STATUS_CLASS[p.status]}`}>{p.status}</span>
      </div>
      <p className="hint">{p.region || p.sido} · {KIND_LABEL[p.kind] || p.kind} · 출처: {p.source || "—"}{p.origin?.collected_at ? ` · ${String(p.origin.collected_at).slice(0, 10)} 자동 수집` : ""}</p>
      {/* AI 판정을 가장 먼저: 무엇을 판단하지 못했는지 */}
      {p.origin?.type === "ai" && (
        <div className={`lp-ai ${p.origin.judgeable && unknownCount === 0 ? "ok" : "check"}`}>
          <b>AI 판정: {p.origin.judgeable && unknownCount === 0 ? "자동 계산 가능" : "담당자 확인 필요"}</b>
          <span>{p.origin.not_judgeable_reason || (unknownCount > 0 ? `계산할 수 없는 조건 ${unknownCount}개가 있어요. 원문과 비교해 '신청 시 확인'으로 둘지 정해 주세요.` : "모든 조건을 앱 입력으로 계산할 수 있어요. 원문과 맞는지만 확인해 주세요.")}</span>
          <small>{String(p.origin.model || "").startsWith("claude") ? "Claude" : "GPT-5"} · {p.origin.prompt} 프롬프트</small>
        </div>
      )}
      {outdated && (
        <p className="warn">이 제도의 더 새 버전 초안이 있어요 ({newer.status}). 원문이 바뀌기 전 내용이라 승인할 수 없어요. 반려하고 새 버전을 검토해 주세요 ·{" "}
          <button type="button" className="link-btn" onClick={() => onPick(newer.id)}>새 버전 보기</button></p>
      )}
      {gone && (
        <p className="warn">복지로 목록에서 {gone.since}부터 보이지 않아요 (3일 연속). 폐지됐거나, 이름·서비스 번호가 바뀌었을 수 있어요.
          {p.status === "승인" ? " 폐지가 맞으면 사유를 적고 '계산에서 빼기(중지)'를 눌러 주세요." : " 승인하기 전에 제도가 아직 있는지 확인해 주세요."}</p>
      )}
      <div className={`lp-compare ${p.text ? "two" : ""}`}>
      <div>
      <h3 className="card-title">조건 검토 <small className="hint">마우스를 올리면 원문의 근거가 진해져요</small></h3>
      <ul className="cond-list">
        {(p.conditions || []).map((x, i) => {
          const known = facts.includes(x.field);
          const atApply = later.has(i);
          const kind = known ? ["자동 계산 가능", "s-ok"] : atApply ? ["신청 시 확인", "s-warn"] : ["수동 확인 필요", "s-bad"];
          return (
            <li key={i} className={`cond lp-cond ${known ? "k-auto" : atApply ? "k-apply" : "k-manual"}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className="cond-head">
                <span className="cond-type">조건 유형</span><span className="cond-field">{FIELD_LABEL[x.field] || x.field}</span>
                {x.group && <span className="pill s-group">하나 이상: {x.group}</span>}
                <span className={`pill ${kind[1]} lp-kind`}>{kind[0]}</span>
              </div>
              <div className="cond-value"><b>{x.value}</b> {OP_LABEL[x.op] ?? x.op}</div>
              {!known && atApply && <p className="hint" style={{ margin: 0 }}>계산에서 빼고, 결과 화면에 '신청할 때 확인'으로 안내해요.</p>}
              {!known && x.field === "other" && pending && (
                <label className="check-later"><input type="checkbox" checked={atApply} onChange={() => toggle(i)} /> 신청할 때 확인하는 조건으로 두기</label>
              )}
              {x.evidence && <div className="cond-ev">원문: “{x.evidence}”</div>}
            </li>
          );
        })}
      </ul>
      <h3 className="card-title">지원 금액</h3>
      {isFormula ? <FormulaReview amount={formula} editable={pending} onChange={setFormula} /> : editableAmount ? (
        <label className="field"><span>월 금액 (원) <small className="hint">{p.amount_text || ""}</small></span>
          <input type="number" min="0" step="1000" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
      ) : <p>{p.amount?.type === "fixed" ? `월 ${won(p.amount.param ? 0 : p.amount.monthly || 0)}` : `계산식 (${p.amount?.type})`} · {p.note}</p>}
      {parts.length > 1 && <ul className="lp-amount-parts">{parts.map((t) => <li key={t}>{t}</li>)}</ul>}
      </div>
      {p.text && (
        <div className="lp-source">
          <h3 className="card-title">복지로 원문 <small className="hint">AI 추출 조건과 나란히 비교</small></h3>
          <SourceText text={p.text} evidences={(p.conditions || []).map((x) => x.evidence)} active={hover} />
        </div>
      )}
      </div>
      {!c.ok && p.status === "검토 대기" && (
        <div className="lp-warn">
          <b>추가 확인이 필요한 조건이 있습니다.</b>
          <span>{c.unknown.length > 0
            ? `계산할 수 없는 조건 ${c.unknown.length}개가 포함되어 있습니다. 원문과 비교해 '신청 시 확인'으로 두거나, 자격의 핵심이면 반려해 주세요.`
            : "계산하는 조건이 하나도 없어요. 거주 지역만으로는 모든 주민이 받는 것으로 계산되므로 승인할 수 없어요."}</span>
        </div>
      )}
      {p.origin?.replaces && p.status === "검토 대기" && <p className="hint">기존 제도의 새 버전이에요. 승인하면 이전 버전은 자동으로 계산에서 빠져요.</p>}
      {p.status === "승인" && onNewVersion && (
        <p className="hint">조례 개정 등으로 조건·금액이 바뀌었나요? <button type="button" className="link-btn" onClick={onNewVersion}>새 버전 만들기</button> (승인 전까지는 지금 버전으로 계산)</p>
      )}
      {next.length > 0 && (
        <div className="lp-actions">
          <div className="lp-buttons">
            {next.map((t) => (
              <button key={t} type="button" className={`btn lg ${t === "승인" ? "primary" : t === "반려" || t === "중지" ? "outline-danger" : ""}`}
                disabled={t === "승인" && (!c.ok || outdated)} title={t === "승인" && outdated ? "더 새 버전 초안이 있어요" : t === "승인" && !c.ok ? "계산할 수 없는 조건이 있어요" : ""}
                onClick={() => (t === "반려" || t === "중지" ? (setReason(""), setAsk(t)) : run(t))}>{ACTION_LABEL[t]}</button>
            ))}
          </div>
          {next.includes("반려") && <p className="hint" style={{ margin: 0 }}>반려·중지는 사유를 적어야 해요.</p>}
        </div>
      )}
      {ask && (
        <ConfirmModal title={ask === "반려" ? "이 제도를 반려할까요?" : "계산에서 뺄까요?"} target={p.name}
          body={ask === "반려" ? "반려한 초안은 계산기에 들어가지 않아요. 사유는 검토 이력에 남아요." : "중지하면 계산기에서 바로 빠져요. 사유는 검토 이력에 남아요."}
          confirmLabel={ACTION_LABEL[ask]} confirmDisabled={!reason.trim()}
          onCancel={() => setAsk(null)} onConfirm={() => { const t = ask; setAsk(null); run(t, reason.trim()); }}>
          <label className="field"><span>사유 (필수)</span><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 원문의 소득 기준이 조건에 빠짐" /></label>
        </ConfirmModal>
      )}
      {(p.history || []).length > 0 && (
        <>
          <h3 className="card-title">검토 이력</h3>
          <ul className="lp-history">
            {p.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace("T", " ")} · {h.by} · {h.from} → {h.to}{h.reason ? ` (${h.reason})` : ""}</li>)}
          </ul>
        </>
      )}
      {p.approved_at && <p className="hint">승인: {p.approved_by} · {p.approved_at}</p>}
    </section>
  );
}

// AI가 만든 계산식 확인: 쉬운 설명 + 식·표 + 예시 계산. 담당자는 식을 몰라도 예시가 원문과 맞는지 보면 된다
function FormulaReview({ amount, editable, onChange }) {
  const [tablesText, setTablesText] = useState(() => JSON.stringify(amount?.tables || {}, null, 1));
  const [tablesErr, setTablesErr] = useState("");
  const v = validateFormula(amount);
  const sizes = [1, 2, 4], incomes = [0, 500000, 1000000, 2000000];
  const ex = (size, inc) => evalFormula(amount, { ...SAMPLE_FACTS, household_size: size, income_recognized_won: inc, child_count: size >= 3 ? size - 2 : 0 });
  const setTables = (text) => {
    setTablesText(text);
    try { onChange({ ...amount, tables: JSON.parse(text || "{}") }); setTablesErr(""); } catch { setTablesErr("표 JSON 형식이 맞지 않아요"); }
  };
  return (
    <div className="formula">
      <p><b>설명:</b> {amount?.explanation || "—"} <small className="hint">({amount?.unit === "annual" ? "연 금액 → 12로 나눠 월 금액" : "월 금액"})</small></p>
      <label className="field"><span>계산식</span>
        <textarea rows={2} value={amount?.expr || ""} readOnly={!editable} onChange={(e) => onChange({ ...amount, expr: e.target.value })} spellCheck={false} /></label>
      <label className="field"><span>표 (lookup에서 쓰는 값)</span>
        <textarea rows={4} value={tablesText} readOnly={!editable} onChange={(e) => setTables(e.target.value)} spellCheck={false} /></label>
      {tablesErr && <p className="warn">{tablesErr}</p>}
      {v.ok ? (
        <>
          <p className="hint">예시 계산 (월 금액, 다른 조건은 기본값) — 원문과 맞는지 확인해 주세요</p>
          <table className="cv-table">
            <thead><tr><th>가구원 수 \ 소득인정액</th>{incomes.map((i) => <th key={i}>{(i / 10000).toLocaleString("ko-KR")}만 원</th>)}</tr></thead>
            <tbody>{sizes.map((s) => <tr key={s}><td>{s}인</td>{incomes.map((i) => { const m = ex(s, i); return <td key={i}>{m == null ? "오류" : `${Math.round(m).toLocaleString("ko-KR")}원`}</td>; })}</tr>)}</tbody>
          </table>
        </>
      ) : <p className="warn">계산식을 쓸 수 없어요: {v.error}</p>}
      <details className="hint"><summary>계산식 문법</summary>
        <p>변수: {Object.entries(FORMULA_VARS).map(([k, l]) => `${k}(${l})`).join(", ")}</p>
        <p>함수: min, max, round, floor, ceil, if(조건, 참, 거짓), lookup("표 이름", 키) · 연산: + - * / 비교 &amp;&amp; ||</p>
      </details>
    </div>
  );
}

// 지자체 제도 직접 등록·새 버전: 조건(항목·비교·값·하나 이상 묶음)과 금액(고정 또는 계산식)을 입력 → '검토 대기'
const OPS = [["<=", "이하"], ["<", "미만"], [">=", "이상"], [">", "초과"], ["==", "같음"], ["in", "중 하나"], ["between", "사이 (최소,최대)"]];
function ProgramForm({ user, rules, facts, from, onCancel, onSubmit }) {
  const [name, setName] = useState(from?.name || "");
  const [kind, setKind] = useState(from?.kind || "cash");
  const [area, setArea] = useState({ region: from?.region || user.region || null, sido: from?.sido || user.sido || rules.regions[user.region]?.sido || "" });
  const [conds, setConds] = useState(() => (from?.conditions || []).filter((c) => c.field !== "other" && c.field !== "residence_region").map((c) => ({ ...c }))
    .concat(from ? [] : [{ field: "income_recognized_pct_median", op: "<=", value: "50", group: "" }]));
  const [amountType, setAmountType] = useState(from?.amount?.type === "formula" ? "formula" : "fixed");
  const [monthly, setMonthly] = useState(from?.amount?.type === "fixed" ? from.amount.monthly || 0 : 0);
  const [formula, setFormula] = useState(from?.amount?.type === "formula" ? from.amount : { type: "formula", expr: "", tables: {}, unit: "monthly", explanation: "" });
  const [note, setNote] = useState(from?.note || "");
  const [source, setSource] = useState(from?.source || "");
  const [text, setText] = useState(from?.text || "");
  const fieldNames = [...facts.filter((f) => f !== "residence_region"), "other"];
  const setCond = (i, k, v) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const region = from ? from.region : user.role === "admin" ? area.region : user.region;
  const sido = from ? from.sido : region ? rules.regions[region]?.sido : user.role === "admin" ? area.sido : user.sido;
  const amount = amountType === "formula" ? formula : { type: "fixed", monthly: Math.max(0, Math.round(Number(monthly) || 0)) };
  const regionCond = region ? { field: "residence_region", op: "in", value: region, group: "", evidence: "담당자 직접 입력" } : null;
  const prog = {
    id: `manual_${Date.now().toString(36)}`, name: name.trim(), region: region || null, sido: sido || null, kind,
    conditions: [...(regionCond ? [regionCond] : []), ...conds.filter((c) => c.field && String(c.value).trim() !== "").map((c) => ({ ...c, value: String(c.value).trim(), evidence: c.evidence || "담당자 직접 입력" }))],
    apply_checks: [], amount, amount_text: amountType === "fixed" ? `월 ${Number(monthly || 0).toLocaleString("ko-KR")}원` : formula.explanation || "",
    note: note.trim(), source: source.trim(), text: text.trim(), status: "검토 대기", history: [],
    origin: { type: "manual", by: user.name, ...(from ? { replaces: from.id } : {}) },
  };
  const c = computable(prog, facts);
  const ok = prog.name && (prog.region || prog.sido) && c.ok && prog.source;
  return (
    <section className="card lp-form">
      <div className="card-head"><h2 className="card-title">{from ? `새 버전 만들기: ${from.name}` : "새 제도 직접 등록"}</h2>
        <button type="button" className="btn sm ghost" onClick={onCancel}>닫기</button></div>
      <p className="hint">입력한 제도는 '검토 대기'로 들어가고, 승인해야 계산기에 들어가요.{from ? " 승인 전까지는 지금 버전으로 계산해요." : ""}</p>
      <div className="cv-form">
        <label className="field"><span>제도 이름</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 저소득 노인 난방비 지원" /></label>
        {user.role === "admin" && !from && <div className="field"><span>지역</span><RegionPicker regions={rules.regions} value={area.region} sido={area.sido} onChange={setArea} allowSido /></div>}
        <label className="field"><span>종류</span><select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <div className="field"><span>조건 (모두 충족 · '묶음' 이름이 같은 조건끼리는 하나 이상 충족) — 거주 지역 조건은 자동으로 붙어요</span>
          {conds.map((cd, i) => (
            <div key={i} className="acc-edit">
              <select value={cd.field} onChange={(e) => setCond(i, "field", e.target.value)} aria-label="항목">{fieldNames.map((f) => <option key={f} value={f}>{FIELD_LABEL[f] || f}</option>)}</select>
              <select value={cd.op} onChange={(e) => setCond(i, "op", e.target.value)} aria-label="비교">{OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
              <input value={cd.value} onChange={(e) => setCond(i, "value", e.target.value)} placeholder="값 (예: 65 / 생계,의료 / true)" aria-label="값" />
              <input value={cd.group || ""} onChange={(e) => setCond(i, "group", e.target.value)} placeholder="묶음 (선택)" aria-label="묶음" style={{ width: 110 }} />
              <button type="button" className="btn sm ghost" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}>빼기</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setConds((cs) => [...cs, { field: "age", op: ">=", value: "", group: "" }])}>+ 조건 더하기</button>
        </div>
        <div className="field"><span>금액</span>
          <div className="acc-edit">
            <label className="check-later"><input type="radio" checked={amountType === "fixed"} onChange={() => setAmountType("fixed")} /> 고정 월 금액</label>
            <label className="check-later"><input type="radio" checked={amountType === "formula"} onChange={() => setAmountType("formula")} /> 계산식 (가구원 수·소득 등에 따라 달라짐)</label>
          </div>
          {amountType === "fixed"
            ? <input type="number" min="0" step="1000" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label="월 금액" />
            : <>
                <input value={formula.explanation || ""} onChange={(e) => setFormula((f) => ({ ...f, explanation: e.target.value }))} placeholder="쉬운 설명 (예: 가구원 수별 기준액에서 소득인정액을 뺀 만큼)" />
                <select value={formula.unit || "monthly"} onChange={(e) => setFormula((f) => ({ ...f, unit: e.target.value }))}><option value="monthly">결과가 월 금액</option><option value="annual">결과가 연 금액 (12로 나눔)</option></select>
                <FormulaReview amount={formula} editable onChange={setFormula} />
              </>}
        </div>
        <label className="field"><span>근거 (조례·공고 이름과 조항)</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="예: ○○시 노인복지 조례 제5조" /></label>
        <label className="field"><span>결과 화면 안내 (선택)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="field"><span>원문 (선택, 붙여 넣기)</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
        {!c.ok && <p className="warn">{c.unknown.length ? `계산할 수 없는 조건이 있어요: ${c.unknown.map((x) => FIELD_LABEL[x.field] || x.field).join(", ")}` : !c.meaningful ? "거주 지역 말고 조건이 하나 이상 필요해요 (예: 소득인정액, 나이)" : "금액을 확인해 주세요 (계산식은 오류를 고쳐 주세요)"}</p>}
        <button type="button" className="btn primary" disabled={!ok} onClick={() => onSubmit(prog)}>검토 대기로 올리기</button>
      </div>
    </section>
  );
}
