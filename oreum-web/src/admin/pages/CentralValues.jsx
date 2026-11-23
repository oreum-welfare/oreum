import { useEffect, useMemo, useState } from "react";
import { KEY_LABEL, diffLeaves, getPath, inForce, sameShape, todayKST } from "../../lib/central.js";
import { ROLE_LABEL, STATUS, TRANSITIONS, canReviewCentral, decideCentral } from "../../lib/permissions.js";
import { loadCentralOverlay, mergeCentral, resetCentralOverlay, saveCentralOverlay, supabaseClient } from "../../lib/programs.js";
import { useJson } from "../../lib/useJson.js";
import { ConfirmModal, PageHead } from "../adminUi.jsx";
import { SignIn, useSession } from "../session.jsx";

const STATUS_CLASS = { "검토 대기": "s-warn", 승인: "s-ok", 반려: "s-bad", 중지: "s-bad" };
const ACTION_LABEL = { 승인: "승인 (시행일부터 반영)", 반려: "반려", 중지: "계산에서 빼기(중지)", "검토 대기": "다시 검토" };
const num = (v) => (typeof v === "number" ? v.toLocaleString("ko-KR") : String(v));
// 칸 이름을 읽기 쉽게: elem → 초등학생, "1급지(서울).3" → 1급지(서울) · 3인 가구
const WORD = { elem: "초등학생", middle: "중학생", high: "고등학생", min: "최소", max: "최대", rate: "비율" };
const pathLabel = (p, key) => (p ? p.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).map((k) => WORD[k] || (/^\d+$/.test(k) ? `${k}인 가구` : k)).join(" · ") : KEY_LABEL[key] || key);
const dotDate = (s) => String(s || "").replace(/-/g, ".");
const ymd = (s) => (/^\d{8}$/.test(String(s)) ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6)}` : s);

// 중앙 기준값 검토: 새 고시를 AI가 읽어 제안한 값을 시스템 관리자가 원문과 대조해 승인한다.
// 승인한 값은 시행일이 되면 계산기에 자동으로 들어간다 (그 전까지는 지금 값).
export default function CentralValues() {
  const { mode, user, ready, signOut } = useSession();
  const { data: rules } = useJson("/data/rules.json");
  const { data: draftFile } = useJson("/data/central_drafts.json");
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("검토 대기");
  const [pickedId, setPickedId] = useState(null);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const today = todayKST();

  useEffect(() => {
    if (!canReviewCentral(user)) return;
    (async () => {
      if (mode === "supabase") {
        try {
          const sb = await supabaseClient();
          const [{ data, error }, { data: events }] = await Promise.all([
            sb.from("central_values").select("*").order("effective_from", { ascending: false }),
            sb.from("central_events").select("*").order("at"),
          ]);
          if (error) throw error;
          const history = {};
          for (const e of events || []) (history[e.value_id] ||= []).push({ at: e.at, by: e.actor_name || "", from: e.from_status, to: e.to_status, reason: e.reason || "" });
          setRows(data.map((r) => ({ ...r, history: history[r.id] || [] })));
        } catch {
          setRows([]);
          setMsg("기준값 목록을 불러오지 못했어요.");
        }
      } else if (draftFile) {
        setRows(mergeCentral(draftFile.drafts, loadCentralOverlay()));
      }
    })();
  }, [mode, user, draftFile]);

  const shown = (rows || []).filter((r) => r.status === status && (!q.trim() || `${KEY_LABEL[r.key] || r.key} ${r.notice?.name || ""}`.includes(q.trim())));
  const picked = (rows || []).find((r) => r.id === pickedId) || shown[0] || null;
  const live = useMemo(() => inForce(rows || [], today), [rows, today]);

  if (!ready) return <p className="hint">불러오는 중…</p>;
  const head = <PageHead title="중앙 기준값" desc="새 고시(기준 중위소득·기준임대료 등)를 AI가 읽어 바뀐 값을 제안합니다. 원문과 대조해 승인하면 시행일부터 계산기에 자동으로 반영돼요." />;
  if (!user) return <div className="page">{head}<SignIn /></div>;
  if (!canReviewCentral(user)) {
    return (
      <div className="page">{head}
        <p className="empty">중앙 기준값은 전국 계산에 영향을 주므로 <b>시스템 관리자</b>만 검토·승인할 수 있어요. 지금 계정: {user.name} ({ROLE_LABEL[user.role]})
          · <button type="button" className="link-btn" onClick={signOut}>다른 계정으로 로그인</button></p>
      </div>
    );
  }

  const apply = async (row, to, opts) => {
    setMsg("");
    const res = decideCentral(user, row, to, { ...opts, sameShape });
    if (res.error) { setMsg(res.error); return; }
    if (mode === "supabase") {
      try {
        const sb = await supabaseClient();
        const { error } = await sb.from("central_values").update({ status: res.row.status, value: res.row.value, effective_from: res.row.effective_from, reason: res.row.reason ?? null }).eq("id", row.id);
        if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return; }
      } catch {
        setMsg("서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); return;
      }
    } else {
      const overlay = loadCentralOverlay();
      overlay[row.id] = res.row;
      if (!saveCentralOverlay(overlay)) { setMsg("이 브라우저에 저장할 수 없어요."); return; }
    }
    setRows((all) => all.map((r) => (r.id === row.id ? res.row : r)));
    setMsg(to === "승인"
      ? `승인했어요. ${res.row.effective_from > today ? `${res.row.effective_from}부터` : "지금부터"} 계산기에 반영돼요${mode === "demo" ? " (데모: 이 브라우저만)" : ""}.`
      : `'${to}'(으)로 바꿨어요.`);
  };

  // 직접 입력: 감시 고시 밖의 값을 근거와 함께 '검토 대기'로 올린다 (승인은 위와 같은 절차)
  const submitManual = async (row) => {
    setMsg("");
    if (mode === "supabase") {
      try {
        const sb = await supabaseClient();
        const { error } = await sb.from("central_values").insert(row);
        if (error) { setMsg(`저장하지 못했어요: ${error.message}`); return false; }
      } catch {
        setMsg("서버에 연결하지 못했어요."); return false;
      }
    } else {
      const overlay = loadCentralOverlay();
      overlay[row.id] = row;
      if (!saveCentralOverlay(overlay)) { setMsg("이 브라우저에 저장할 수 없어요."); return false; }
    }
    setRows((all) => [row, ...(all || [])]);
    setStatus("검토 대기");
    setPickedId(row.id);
    setMsg("'검토 대기'로 올렸어요. 근거와 값을 다시 확인한 뒤 승인해 주세요 (가능하면 다른 관리자가).");
    setManualOpen(false);
    return true;
  };

  const counts = Object.fromEntries(STATUS.map((s) => [s, (rows || []).filter((r) => r.status === s).length]));
  return (
    <div className="page">
      <PageHead title="중앙 기준값" desc="새 고시(기준 중위소득·기준임대료 등)를 AI가 읽어 바뀐 값을 제안합니다. 원문과 대조해 승인하면 시행일부터 계산기에 자동으로 반영돼요.">
        <div className="who">
          <b>{user.name}</b>
          <span className="pill brand">{ROLE_LABEL[user.role]}</span>
          <button type="button" className="btn sm ghost" onClick={signOut}>로그아웃</button>
        </div>
      </PageHead>
      {mode === "demo" && (
        <p className="notice">데모 모드: 결정은 이 브라우저에만 저장돼요 · <button type="button" className="link-btn" onClick={() => { resetCentralOverlay(); setRows(mergeCentral(draftFile?.drafts || [], {})); setMsg("데모 결정을 모두 지웠어요."); }}>데모 결정 초기화</button></p>
      )}
      <section className="card lp-summary">
        <div className="lp-summary-head"><h2 className="card-title">기준값 검토 현황</h2>
          <button type="button" className="btn primary" onClick={() => setManualOpen((o) => !o)} aria-expanded={manualOpen}>{manualOpen ? "직접 등록 닫기" : "+ 직접 기준값 등록"}</button></div>
        <div className="lp-stats" role="tablist" aria-label="상태별 보기">
          {STATUS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={`lp-stat ${s === "검토 대기" ? "main" : ""} ${status === s ? "on" : ""}`} onClick={() => { setStatus(s); setPickedId(null); }}>
              <span>{s}</span><b>{counts[s]}건</b>
            </button>
          ))}
        </div>
      </section>
      {msg && <p className="notice" role="status">{msg}</p>}
      {rules && manualOpen && <ManualEntry rules={rules} user={user} today={today} onSubmit={submitManual} />}
      {!rows || !rules ? <p className="hint">불러오는 중…</p> : rows.length === 0 ? <p className="empty">아직 제안된 기준값이 없어요. 새 고시가 올라오면 매일 확인에서 자동으로 들어와요.</p> : (
        <div className="lp-cols">
          <aside className="card lp-side">
            <div className="lp-side-head">
              <b>{status} 기준값 <span className="hint">{shown.length}개</span></b>
              <input type="search" placeholder="기준값·고시 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="기준값 검색" />
            </div>
            <ul className="lp-list" aria-label={`${status} 기준값`}>
              {shown.length === 0 && <li className="hint">{q.trim() ? "검색 결과가 없어요." : "이 상태의 기준값이 없어요."}</li>}
              {shown.map((r) => {
                const n = diffLeaves(getPath(rules, r.key), r.value).length;
                const upcoming = r.status === "승인" && r.effective_from > today;
                const on = picked?.id === r.id;
                return (
                  <li key={r.id}>
                    <button type="button" className={`lp-item ${on ? "on" : ""}`} onClick={() => setPickedId(r.id)} aria-current={on ? "true" : undefined}>
                      <span className="lp-item-top"><b className="lp-name">{KEY_LABEL[r.key] || r.key}</b>{on && <span className="pill s-done">선택됨</span>}</span>
                      <small>시행 {dotDate(r.effective_from)}</small>
                      <span className="lp-badges">
                        <span className="pill s-group">변경 항목 {n}개</span>
                        {upcoming && <span className="pill s-warn">시행 예정</span>}
                        {live[r.key]?.id === r.id && <span className="pill s-ok">시행 중</span>}
                        <span className={`pill ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          {picked && <Detail key={picked.id} r={picked} current={getPath(rules, picked.key)} today={today} onAct={apply} />}
        </div>
      )}
    </div>
  );
}

// 값 모양 그대로 펼치기: [경로, 값]
function leaves(v, prefix = "") {
  if (v && typeof v === "object") return Object.keys(v).flatMap((k) => leaves(v[k], Array.isArray(v) ? `${prefix}[${k}]` : prefix ? `${prefix}.${k}` : k));
  return [[prefix, v]];
}
function setLeaf(v, path, x) {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!keys.length) return x;
  const copy = Array.isArray(v) ? [...v] : { ...v };
  copy[keys[0]] = setLeaf(v[keys[0]], keys.slice(1).join("."), x);
  return copy;
}

function Detail({ r, current, today, onAct }) {
  const [value, setValue] = useState(r.value);
  const [eff, setEff] = useState(r.effective_from);
  const [reason, setReason] = useState("");
  const [showSame, setShowSame] = useState(false);
  const [ask, setAsk] = useState(null); // 승인 확인 · 반려/중지 사유 창
  const pending = r.status === "검토 대기";
  const cur = Object.fromEntries(leaves(current));
  const all = leaves(value);
  const changed = all.filter(([p, v]) => cur[p] !== v);
  const list = showSame ? all : changed;
  const edited = JSON.stringify(value) !== JSON.stringify(r.value);
  const next = TRANSITIONS[r.status] || [];
  const n = r.notice || {};
  const delta = (p, v) => (typeof v === "number" && typeof cur[p] === "number" ? v - cur[p] : null);
  const ups = changed.filter(([p, v]) => delta(p, v) > 0).length, downs = changed.filter(([p, v]) => delta(p, v) < 0).length;
  const run = (t, why) => onAct(r, t, { reason: why ?? reason, value: pending ? value : undefined, effectiveFrom: pending ? eff : undefined });
  return (
    <section className="card lp-detail">
      <div className="card-head">
        <h2 className="card-title">{KEY_LABEL[r.key] || r.key}</h2>
        <span className={`pill ${STATUS_CLASS[r.status]}`}>{r.status}</span>
      </div>
      <p className="hint">
        {[n.name, n.number && `제${String(n.number).replace(/^제|호$/g, "")}호`, n.issued && `발령 ${ymd(n.issued)}`].filter(Boolean).join(" · ")} · <b>시행 {r.effective_from}</b>
        {n.serial && <> · <a href={`https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=${encodeURIComponent(n.serial)}`} target="_blank" rel="noreferrer">원문 보기 (국가법령정보센터)</a></>}
      </p>
      {pending && (
        <label className="field cv-eff"><span>시행일 <small className="hint">부칙에서 이 값의 시행일이 따로 정해져 있으면 원문대로 고쳐 주세요</small></span>
          <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
      )}
      <p className="hint">제안: {r.proposed_by || "—"} · 근거 {r.location || "—"}{r.evidence ? `: “${r.evidence}”` : ""}</p>
      {/* 선택한 기준값 변경 요약 */}
      <div className="cv-summary">
        <div><span>변경 항목</span><b>{changed.length}건</b></div>
        <div className="up"><span>인상 항목</span><b>{ups}건</b></div>
        <div className={downs ? "down" : ""}><span>인하 항목</span><b>{downs}건</b></div>
        <div><span>시행 예정일</span><b>{dotDate(eff)}</b></div>
      </div>
      {r.status === "승인" && <p className={r.effective_from > today ? "warn" : "hint"}>{r.effective_from > today ? `시행 예정: ${r.effective_from}이 되면 계산기에 자동으로 반영돼요. 그 전까지는 지금 값으로 계산해요.` : "시행 중인 값이에요."}</p>}

      <h3 className="card-title">값 비교 · 변경 사항 <small className="hint">현재 값 → 새 고시값{pending ? " · AI가 잘못 읽은 칸은 원문대로 고친 뒤 승인" : ""}</small></h3>
      <table className="cv-table cv-diff">
        <thead><tr><th>항목</th><th className="r">현재 값</th><th className="r">새 고시값</th><th className="r">변동</th></tr></thead>
        <tbody>
          {list.map(([p, v]) => {
            const d = delta(p, v);
            return (
              <tr key={p} className={d > 0 ? "up" : d < 0 ? "down" : cur[p] !== v ? "changed" : "same"}>
                <td>{pathLabel(p, r.key)}</td>
                <td className="r num">{num(cur[p])}</td>
                <td className="r num">{pending && typeof v === "number"
                  ? <input type="number" min="0" step="any" value={v} aria-label={`${pathLabel(p, r.key)} 새 값`} onChange={(e) => setValue((old) => setLeaf(old, p, e.target.value === "" ? 0 : Number(e.target.value)))} />
                  : <b>{num(v)}</b>}</td>
                <td className="r num delta">{d == null ? (cur[p] !== v ? "바뀜" : "-") : d === 0 ? "변동 없음" : `${d > 0 ? "+" : "−"}${num(Math.abs(Math.round(d * 1000) / 1000))}`}</td>
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={4} className="hint">지금 값과 같아요.</td></tr>}
        </tbody>
      </table>
      <button type="button" className="link-btn" onClick={() => setShowSame((s) => !s)}>{showSame ? "바뀐 칸만 보기" : `같은 칸까지 모두 보기 (${all.length}칸)`}</button>
      {(edited || eff !== r.effective_from) && <p className="warn">AI 제안에서 고친 {edited ? "칸" : ""}{edited && eff !== r.effective_from ? "과 " : ""}{eff !== r.effective_from ? "시행일" : ""}이 있어요. 승인하면 고친 내용이 저장돼요.</p>}

      {next.length > 0 && (
        <div className="lp-actions">
          <div className="lp-buttons">
            {next.map((t) => (
              <button key={t} type="button" className={`btn lg ${t === "승인" ? "primary" : t === "반려" || t === "중지" ? "outline-danger" : ""}`}
                onClick={() => { setReason(""); setAsk(t); }}>{ACTION_LABEL[t]}</button>
            ))}
          </div>
          <p className="hint" style={{ margin: 0 }}>승인하면 시행일부터 전국 계산에 반영돼요. 누르면 바뀌는 내용을 한 번 더 보여 드려요.</p>
        </div>
      )}
      {ask === "승인" && (
        <ConfirmModal title="이 기준값을 승인할까요?" target={`${KEY_LABEL[r.key] || r.key} · 시행 ${dotDate(eff)}`} confirmLabel="승인" confirmClass="primary"
          body={`${eff > today ? `${dotDate(eff)}부터` : "지금부터"} 계산기에 반영돼요. 이 값은 전국 모든 지역의 계산에 쓰여요.`}
          onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); run("승인"); }}>
          <ul className="cv-confirm">
            {changed.slice(0, 8).map(([p, v]) => <li key={p}><span>{pathLabel(p, r.key)}</span><b>{num(cur[p])} → {num(v)}</b></li>)}
            {changed.length > 8 && <li className="hint">외 {changed.length - 8}칸</li>}
          </ul>
        </ConfirmModal>
      )}
      {ask && ask !== "승인" && (
        <ConfirmModal title={ask === "반려" ? "이 제안을 반려할까요?" : ask === "중지" ? "계산에서 뺄까요?" : "다시 검토로 돌릴까요?"} target={KEY_LABEL[r.key] || r.key}
          confirmLabel={ACTION_LABEL[ask]} confirmDisabled={(ask === "반려" || ask === "중지") && !reason.trim()} confirmClass={ask === "반려" || ask === "중지" ? "danger-solid" : "primary"}
          body={ask === "반려" || ask === "중지" ? "사유는 검토 이력에 남아요." : undefined}
          onCancel={() => setAsk(null)} onConfirm={() => { const t = ask; setAsk(null); run(t, reason.trim()); }}>
          {(ask === "반려" || ask === "중지") && <label className="field"><span>사유 (필수)</span><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 별표의 4인 금액을 잘못 읽음" /></label>}
        </ConfirmModal>
      )}
      {(r.history || []).length > 0 && (
        <>
          <h3 className="card-title">검토 이력</h3>
          <ul className="lp-history">
            {r.history.map((h, i) => <li key={i}>{String(h.at).slice(0, 16).replace("T", " ")} · {h.by} · {h.from} → {h.to}{h.reason ? ` (${h.reason})` : ""}</li>)}
          </ul>
        </>
      )}
      {r.approved_at && <p className="hint">승인: {r.approved_by} · {r.approved_at}</p>}
    </section>
  );
}

// 직접 입력 폼: 값 고르기 → 지금 값을 바탕으로 숫자만 고치기 → 근거·시행일 → '검토 대기'
function ManualEntry({ rules, user, today, onSubmit }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState(null);
  const [eff, setEff] = useState(today);
  const [source, setSource] = useState("");
  const [evidence, setEvidence] = useState("");
  const current = key ? getPath(rules, key) : undefined;
  const pick = (k) => { setKey(k); setValue(k ? getPath(rules, k) : null); };
  const changed = key && value != null ? diffLeaves(current, value) : [];
  const ok = key && changed.length > 0 && sameShape(current, value) && /^\d{4}-\d{2}-\d{2}$/.test(eff) && source.trim() && evidence.trim();
  const submit = async () => {
    const row = {
      id: `manual_${key}_${Date.now().toString(36)}`, key, value, effective_from: eff,
      notice: { key: "manual", source: "직접 입력", name: source.trim() }, evidence: evidence.trim().slice(0, 500), location: "",
      proposed_by: `manual:${user.name}`, status: "검토 대기", history: [],
    };
    if (await onSubmit(row)) { pick(""); setSource(""); setEvidence(""); setEff(today); }
  };
  return (
    <section className="card">
      <h2 className="card-title">직접 기준값 등록</h2>
      <p className="hint">정부 고시 외 별도 기준으로 관리하는 값(에너지바우처·통신요금 감면·근로장려금 등)을 직접 등록해요. 등록하면 '검토 대기'로 들어가고, 승인해야 계산에 반영돼요.</p>
      <div className="cv-form">
        <label className="field"><span>기준값 종류</span>
          <select value={key} onChange={(e) => pick(e.target.value)}>
            <option value="">값 고르기</option>
            {Object.entries(KEY_LABEL).filter(([k]) => getPath(rules, k) !== undefined).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select></label>
        {key && value != null && (
          <table className="cv-table">
            <thead><tr><th>항목</th><th>지금 값</th><th>새 값</th></tr></thead>
            <tbody>
              {leaves(value).map(([p, v]) => {
                const cur = Object.fromEntries(leaves(current))[p];
                return (
                  <tr key={p} className={cur !== v ? "changed" : ""}>
                    <td>{p || key}</td><td>{num(cur)}</td>
                    <td>{typeof v === "number"
                      ? <input type="number" min="0" step="any" value={v} aria-label={`${p} 새 값`} onChange={(e) => setValue((old) => setLeaf(old, p, e.target.value === "" ? 0 : Number(e.target.value)))} />
                      : <span className="hint">{num(v)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <label className="field"><span>적용 시작일</span><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
        <label className="field"><span>근거 자료 이름 (예: 2027년 에너지바우처 사업 지침)</span><input value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <label className="field"><span>등록 사유 · 근거 문구 (원문에서 그대로)</span><textarea rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
        <button type="button" className="btn primary" disabled={!ok} onClick={submit}>{key && changed.length === 0 ? "바뀐 칸이 없어요" : "검토 대기로 올리기"}</button>
      </div>
    </section>
  );
}
