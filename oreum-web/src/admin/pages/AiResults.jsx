import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { Link } from "react-router-dom";
import { useJson } from "../../lib/useJson.js";
import { PageHead } from "../adminUi.jsx";

const pct = (x) => `${Math.round(x * 100)}%`;
const hits = (s, k) => Math.round(s.summary[k] * s.summary.services); // 비율 → 건수
// 채점기의 오류 이름 → 화면에 보일 짧은 이름
const ERROR_LABEL = {
  "조건 누락·오류": "조건 누락", "금액": "금액 추출 오류", "판정 가능 여부": "판정 오류",
  "근거 인용": "근거 불일치", "정답에 없는 조건": "불필요한 조건",
};
const ERROR_SHORT = { "조건 누락·오류": "조건 누락", "금액": "금액", "판정 가능 여부": "판정", "근거 인용": "근거", "정답에 없는 조건": "불필요한 조건" };
const STORE_KEY = "oreum-review-v1"; // AI 검수 화면의 검수 기록 (이 브라우저)
const reviewed = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const PROMPTS = ["1차", "2차", "3차"];
const TRAIN = "#c4cad2", UNSEEN = "#4ba468";

// 단계별 정확도: 프롬프트(1·2·3차)마다 '학습 데이터'와 '신규 서비스 검증'을 나란히 (서로 다른 집단이라 색으로 나눔)
function AccuracyChart({ stages }) {
  const pick = (p, unseen) => stages.find((s) => s.prompt === p && !!s.unseen === unseen);
  const series = (unseen) => PROMPTS.map((p) => { const s = pick(p, unseen); return s ? Math.round(s.summary.service_accuracy * 100) : null; });
  const meta = (unseen, i) => pick(PROMPTS[i], unseen);
  const data = {
    labels: PROMPTS.map((p) => `${p} 프롬프트`),
    datasets: [
      { label: "학습 데이터", data: series(false), backgroundColor: TRAIN, borderRadius: 6, maxBarThickness: 56 },
      { label: "신규 서비스 검증", data: series(true), backgroundColor: UNSEEN, borderRadius: 6, maxBarThickness: 56 },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: {
      y: { min: 0, max: 100, ticks: { stepSize: 25, callback: (v) => `${v}%`, color: "#8b95a1" }, grid: { color: "#f2f4f6" } },
      x: { grid: { display: false }, ticks: { color: "#4e5968", font: { size: 12 } } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (item) => {
        const s = meta(item.datasetIndex === 1, item.dataIndex);
        return s ? ` ${item.dataset.label} ${item.raw}% (${hits(s, "service_accuracy")}/${s.summary.services}건 · ${s.set.replace("처음 보는 ", "")})` : "";
      } } },
    },
  };
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, d) => chart.getDatasetMeta(d).data.forEach((bar, i) => {
        if (ds.data[i] == null) return;
        ctx.save();
        ctx.fillStyle = d === 1 ? "#2f8a4c" : "#4e5968"; ctx.font = "700 13px Pretendard, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(`${ds.data[i]}%`, bar.x, bar.y - 6);
        ctx.restore();
      }));
    },
  };
  return <div className="chart-box short"><Bar data={data} options={options} plugins={[valueLabels]} /></div>;
}

export default function AiResults() {
  const { data, error } = useJson("/data/ai_results.json");
  const { data: review } = useJson("/data/review.json");
  const [stageKey, setStageKey] = useState(null);
  const [errType, setErrType] = useState(null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const done = useMemo(() => (data ? data.stages.filter((s) => s.status === "done") : []), [data]);

  if (error) return <main className="page"><div className="alert cliff"><h3>AI 결과를 불러오지 못했습니다</h3><p>{String(error.message)}</p></div></main>;
  if (!data) return <main className="page"><p className="empty">불러오는 중…</p></main>;

  const unseen = done.filter((s) => s.unseen);
  const latest = unseen[unseen.length - 1];
  const first = unseen[0];
  const groundingAll = done.every((s) => s.summary.evidence_grounding === 1 || s.key === "v1");
  const stage = done.find((s) => s.key === stageKey) || latest || done[done.length - 1];
  const inReview = new Set((review?.services || []).map((s) => s.id));
  const store = reviewed();

  // 오류 유형별 발생 (한 서비스가 여러 유형일 수 있어 비중은 '오류 발생 수' 기준)
  const errRows = Object.keys(ERROR_LABEL).map((t) => ({ t, n: stage.services.filter((x) => x.errors.includes(t)).length })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const errTotal = errRows.reduce((a, r) => a + r.n, 0);
  const needsReview = (x) => !x.ok && !store[x.id]?.done;
  const rows = stage.services.filter((x) => (filter === "all" || (filter === "ok" ? x.ok : filter === "bad" ? !x.ok : needsReview(x)))
    && (!errType || x.errors.includes(errType)));
  const count = { all: stage.services.length, ok: stage.services.filter((x) => x.ok).length, bad: stage.services.filter((x) => !x.ok).length, review: stage.services.filter(needsReview).length };
  const pickStage = (k) => { setStageKey(k); setErrType(null); setFilter("all"); setOpen(null); };

  return (
    <>
      <main className="page">
        <PageHead title={<>AI가 복지 기준을 <em>얼마나 정확히</em> 읽을까요?</>}
          desc={`복지로 원문을 AI(${data.model})가 판정 규칙으로 바꾸고, 팀이 만든 정답과 비교해요. 프롬프트를 고칠 때 보지 않은 '처음 보는 서비스'로 따로 시험해 실제 성능을 확인해요.`} />
        {latest && (
          <div className="stats">
            <div className="stat accent" title="조건·판정 가능 여부·금액·근거 인용이 모두 정답과 같은 서비스의 비율">
              <div className="label">처음 보는 서비스 정확도 (최신)</div><div className="value">{pct(latest.summary.service_accuracy)}</div>
              <div className="stat-sub"><b>{hits(latest, "service_accuracy")}건 / {latest.summary.services}건</b> 정답 · {latest.set.replace("처음 보는 ", "")}</div>
            </div>
            <div className="stat" title="같은 방식(처음 보는 서비스)으로 잰 이전 시험과 비교">
              <div className="label">이전 시험 대비</div><div className="value">{first && first !== latest ? `${pct(first.summary.service_accuracy)} → ${pct(latest.summary.service_accuracy)}` : "-"}</div>
              <div className="stat-sub">{first && first !== latest ? `${hits(first, "service_accuracy")}/${first.summary.services}건 → ${hits(latest, "service_accuracy")}/${latest.summary.services}건 정답` : ""}</div>
            </div>
            <div className="stat" title="앱 입력(나이·소득·가구 등)만으로 판정할 수 있는 서비스인지를 AI가 정답과 같게 가려낸 비율">
              <div className="label">판정 가능 여부 일치</div><div className="value">{pct(latest.summary.judgeable_agreement)}</div>
              <div className="stat-sub">{hits(latest, "judgeable_agreement")}/{latest.summary.services}건 · 앱 입력으로 판정할 수 있는 서비스인지 AI가 맞게 가려낸 비율</div>
            </div>
            <div className="stat" title="AI가 근거로 인용한 문장이 원문에 그대로 있는 비율 (지어낸 근거가 있는지 점검)">
              <div className="label">근거 인용이 원문에 있음</div><div className="value">{pct(latest.summary.evidence_grounding)}</div>
              <div className="stat-sub">AI가 인용한 근거 문장이 원문에 그대로 있는 비율{groundingAll ? " · 2차 이후 모든 시험 100%" : ""}</div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <div><h2 className="card-title">AI 서비스 정확도 변화</h2><p className="hint">프롬프트 개선 단계별 정확도 비교</p></div>
            <div className="legend-note"><span className="box seen" />학습 데이터 <span className="box unseen" />신규 서비스 검증</div>
          </div>
          <AccuracyChart stages={done} />
          {first && latest && first !== latest && (
            <div className="ai-key">
              <span>핵심 성과</span>
              <b>{pct(first.summary.service_accuracy)} → {pct(latest.summary.service_accuracy)}</b>
              <p>신규 서비스 검증 정확도 개선 ({first.prompt} → {latest.prompt} 프롬프트, 처음 보는 서비스로만 잰 점수)</p>
            </div>
          )}
          <p className="hint">학습 데이터(회색) = 프롬프트를 고칠 때 본 13건이라 실제보다 높게 나와요. 신규 서비스 검증(초록) = 고칠 때 보지 않은 서비스로 잰 점수예요. 서로 다른 서비스로 잰 점수라 막대끼리 오르내림을 비교하면 안 돼요.
            서비스 정확도 = 조건·판정 가능 여부·금액·근거 인용이 <b>모두</b> 맞은 서비스 비율.</p>
        </div>

        <div className="card">
          <div className="card-head">
            <div><h2 className="card-title">오류 유형별 분석</h2><p className="hint">AI가 잘못 판단하거나 추출한 항목의 유형별 발생 현황 · 유형을 누르면 아래 서비스 표가 걸러져요</p></div>
          </div>
          <div className="status-tabs" role="group" aria-label="시험 단계">
            {done.map((s) => <button key={s.key} type="button" className={`btn sm ${s.key === stage.key ? "on" : ""}`} onClick={() => pickStage(s.key)}>{s.prompt} · {s.unseen ? "신규 검증" : "학습"} {s.summary.services}건</button>)}
          </div>
          {errRows.length === 0 ? <p className="empty">이 시험에서는 오류가 없어요.</p> : (
            <div className="table-wrap"><table className="err-table">
              <thead><tr><th>오류 유형</th><th style={{ textAlign: "right" }}>발생 건수</th><th style={{ textAlign: "right" }}>비중</th></tr></thead>
              <tbody>{errRows.map((r, i) => (
                <tr key={r.t} className={`click ${errType === r.t ? "on" : ""}`} onClick={() => setErrType(errType === r.t ? null : r.t)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setErrType(errType === r.t ? null : r.t); } }} aria-pressed={errType === r.t}>
                  <td>{ERROR_LABEL[r.t]}</td><td className="num">{r.n}건</td>
                  <td className={`num ${i === 0 ? "top" : ""}`}>{Math.round((r.n / errTotal) * 100)}%</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="hint">한 서비스가 여러 유형에 해당할 수 있어요. 비중은 오류 발생 {errTotal}건 중 비율이에요.</p>

          <div className="svc-filter">
            <div className="status-tabs" role="group" aria-label="결과 필터">
              {[["all", "전체"], ["ok", "정답"], ["bad", "오답"], ["review", "검수 필요"]].map(([k, l]) => (
                <button key={k} type="button" className={`btn sm ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l} {count[k]}</button>
              ))}
            </div>
            {errType && <button type="button" className="link-btn" onClick={() => setErrType(null)}>‘{ERROR_LABEL[errType]}’ 거르기 해제 ✕</button>}
          </div>
          <div className="table-wrap"><table className="svc-table">
            <thead><tr><th>서비스명</th><th>결과</th><th>오류 유형</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <SvcRow key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} canReview={inReview.has(x.id)} />
              ))}
              {rows.length === 0 && <tr><td colSpan="3" className="note">조건에 맞는 서비스가 없어요.</td></tr>}
            </tbody>
          </table></div>
          <p className="hint">서비스명을 누르면 AI 추출 결과와 정답의 차이를 볼 수 있어요. 검수 필요 = 오답 중 AI 검수 화면에서 아직 검수 완료하지 않은 것.</p>
        </div>

        <div className="card">
          <h2 className="card-title">공정하게 재는 방법</h2>
          <ol className="fair">
            <li><b>정답을 먼저</b>시험용 서비스의 정답 규칙은 AI 결과를 보기 전에 팀이 작성합니다.</li>
            <li><b>고치지 않기</b>결과를 본 뒤에는 그 시험의 정답과 채점 기준을 바꾸지 않습니다.</li>
            <li><b>새 문제로 다시</b>프롬프트를 고치는 데 쓴 서비스는 다음 시험에 쓰지 않습니다. 2차는 경산, 3차는 대구 북구·영천 서비스로 시험했습니다.</li>
            <li><b>채점기도 검사</b>정답을 그대로 넣으면 100%, 일부러 실수 6개를 심으면 6개 모두 잡아내는지 확인했습니다.</li>
          </ol>
        </div>

        <div className="card">
          <h2 className="card-title">AI와 담당자가 함께 검증합니다</h2>
          <p className="hint">AI는 복지 기준을 분석하고, 담당자는 계산 가능 여부와 원문 근거를 최종 확인합니다. AI가 앱 입력으로 판정할 수 없는 서비스를 '받을 수 있음'으로 잘못 보여 주지 않도록, 사람이 승인한 규칙만 계산에 반영해요.</p>
          <div className="role-grid">
            <div className="role">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></svg>
              <b>AI 역할</b>
              <ul><li>복지 기준 추출</li><li>조건 및 금액 분석</li><li>원문 근거 연결</li></ul>
            </div>
            <div className="role">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 11l2 2 4-4" /></svg>
              <b>담당자 역할</b>
              <ul><li>조건의 정확성 검토</li><li>계산 가능 여부 확인</li><li>최종 승인 및 관리</li></ul>
            </div>
          </div>
          <Link className="btn primary role-cta" to="../review">AI 검수 화면에서 확인 →</Link>
          <p className="hint">결과 갱신일 {data.updated} · 자세한 실험 기록: GitHub 저장소 pipeline/RESULTS.md</p>
        </div>
      </main>
    </>
  );
}

// 서비스 한 줄: 누르면 AI 추출과 정답의 차이(누락·추가 조건)를 펼친다. 학습용 서비스는 AI 검수 화면으로 바로 이동
function SvcRow({ x, open, onToggle, canReview }) {
  return (
    <>
      <tr className="click" onClick={onToggle} tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <td><span className="svc-name">{x.name}</span> <span className="hint">{open ? "▴" : "▾"}</span></td>
        <td>{x.ok ? <span className="pill s-ok">정답</span> : <span className="pill s-wait">오답</span>}</td>
        <td className="note">{x.ok ? "-" : x.errors.map((e) => ERROR_SHORT[e] || e).join(" · ")}</td>
      </tr>
      {open && (
        <tr className="svc-detail"><td colSpan="3">
          {x.ok ? <p>AI 추출 결과가 정답 규칙과 모두 같아요.</p> : <>
            {x.missing.length > 0 && <p><b>AI가 놓친 조건 (정답에는 있음)</b><br />{x.missing.map((m) => <code key={m}>{m}</code>)}</p>}
            {x.extras.length > 0 && <p><b>AI가 더한 조건 (정답에는 없음)</b><br />{x.extras.map((m) => <code key={m}>{m}</code>)}</p>}
            {!x.missing.length && !x.extras.length && <p>조건은 맞고, {x.errors.map((e) => ERROR_LABEL[e] || e).join(" · ")}에서 정답과 달라요.</p>}
          </>}
          {canReview && <Link className="btn sm" to={`../review?s=${encodeURIComponent(x.id)}`}>원문과 AI 추출 결과 비교 →</Link>}
        </td></tr>
      )}
    </>
  );
}
