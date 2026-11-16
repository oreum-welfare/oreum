import { Bar } from "react-chartjs-2";
import { Link } from "react-router-dom";
import { useJson } from "../lib/useJson.js";
import { PageHead } from "../components/ui.jsx";

const pct = (x) => `${Math.round(x * 100)}%`;
const ERROR_TYPES = ["판정 가능 여부", "조건 누락·오류", "정답에 없는 조건", "금액", "근거 인용"];

function stageLabel(s) {
  return `${s.prompt} 프롬프트 · ${s.set}`;
}

function AccuracyChart({ stages }) {
  const done = stages.filter((s) => s.status === "done");
  const data = {
    labels: done.map((s) => [`${s.prompt} 프롬프트`, s.set.replace(" (회귀 확인)", "")]),
    datasets: [{
      label: "서비스 정확도",
      data: done.map((s) => Math.round(s.summary.service_accuracy * 100)),
      backgroundColor: done.map((s) => (s.unseen ? "#254C3D" : "#D9E0E2")),
      borderRadius: 6, maxBarThickness: 64,
    }],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: {
          callback: (v) => `${v}%`,
          color: "#7E8A90",
        },
        grid: { color: "#E4E8E7" },
      },
      x: {
        grid: { display: false },
        ticks: {
          color: "#59666D",
          font: { size: 11 },
          maxRotation: 0,
          minRotation: 0,
          autoSkip: false,
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (item) => ` 서비스 정확도 ${item.raw}%` } },
    },
  };
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        ctx.save();
        ctx.fillStyle = "#26333C"; ctx.font = "700 13px Pretendard, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(`${chart.data.datasets[0].data[i]}%`, bar.x, bar.y - 6);
        ctx.restore();
      });
    },
  };
  return <div className="chart-box short"><Bar data={data} options={options} plugins={[valueLabels]} /></div>;
}

export default function AiResults() {
  const { data, error } = useJson("/data/ai_results.json");
  if (error) return <main className="page"><div className="alert cliff"><h3>AI 결과를 불러오지 못했습니다</h3><p>{String(error.message)}</p></div></main>;
  if (!data) return <main className="page"><p className="empty">불러오는 중…</p></main>;

  const done = data.stages.filter((s) => s.status === "done");
  const unseen = done.filter((s) => s.unseen);
  const latest = unseen[unseen.length - 1];
  const first = unseen[0];
  const errCount = (s, t) => s.services.filter((x) => x.errors.includes(t)).length;
  const groundingAll = done.every((s) => s.summary.evidence_grounding === 1 || s.key === "v1");

  return (
    <>
      <main className="page">
        <PageHead title={<>AI가 복지 기준을 <em>얼마나 정확히</em> 읽을까요?</>}
          desc={`복지로 원문을 AI(${data.model})가 판정 규칙으로 바꾸고, 팀이 만든 정답과 비교해요. 프롬프트를 고칠 때 보지 않은 '처음 보는 서비스'로 따로 시험해 실제 성능을 확인해요.`} />
        {latest && (
          <div className="stats">
            <div className="stat accent"><div className="label">처음 보는 서비스 정확도 (최신)</div><div className="value">{pct(latest.summary.service_accuracy)}</div><div className="stat-sub">{stageLabel(latest)}</div></div>
            <div className="stat"><div className="label">이전 시험 대비</div><div className="value">{first && first !== latest ? `${pct(first.summary.service_accuracy)} → ${pct(latest.summary.service_accuracy)}` : "-"}</div><div className="stat-sub">{first?.set} → {latest.set.replace("처음 보는 ", "")}</div></div>
            <div className="stat"><div className="label">판정 가능 여부 일치</div><div className="value">{pct(latest.summary.judgeable_agreement)}</div><div className="stat-sub">입력으로 판정할 수 없는 서비스 구분</div></div>
            <div className="stat"><div className="label">근거 인용이 원문에 있음</div><div className="value">{pct(latest.summary.evidence_grounding)}</div><div className="stat-sub">{groundingAll ? "2차 이후 모든 시험에서 100%" : "환각 점검"}</div></div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">단계별 서비스 정확도</h2>
            <div className="legend-note"><span className="box unseen" />처음 보는 서비스 <span className="box seen" />프롬프트를 고칠 때 쓴 서비스</div>
          </div>
          <AccuracyChart stages={data.stages} />
          <p className="hint">서비스 정확도 = 조건·판정 가능 여부·금액·근거 인용이 <b>모두</b> 맞은 서비스 비율 (조건 기준값은 정확히 일치해야 정답). 회색 막대는 같은 문제로 고치고 다시 잰 점수라 실제보다 높게 나옵니다.</p>
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
          <h2 className="card-title">틀린 서비스의 오류 유형</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>단계</th><th style={{ textAlign: "right" }}>틀린 서비스</th>{ERROR_TYPES.map((t) => <th key={t} style={{ textAlign: "right" }}>{t}</th>)}</tr></thead>
            <tbody>{done.map((s) => (
              <tr key={s.key}>
                <td>{stageLabel(s)} {s.unseen && <span className="tag central">처음 보는</span>}</td>
                <td className="num">{s.services.filter((x) => !x.ok).length} / {s.services.length}</td>
                {ERROR_TYPES.map((t) => <td key={t} className="num">{errCount(s, t) || "-"}</td>)}
              </tr>
            ))}</tbody>
          </table></div>
          <p className="hint">한 서비스가 여러 유형에 해당할 수 있습니다. 2차 프롬프트는 처음 보는 서비스에서 '판정 가능 여부'를 자주 틀렸고(임신·보훈·사망처럼 앱 입력에 없는 조건), 3차에서 이 기준을 보강했습니다.</p>
        </div>

        {latest && (
          <div className="card">
            <h2 className="card-title">최신 시험 결과: {latest.set}</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>서비스</th><th>결과</th><th>틀린 부분</th></tr></thead>
              <tbody>{latest.services.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.ok ? <span className="status ok">정답</span> : <span className="status est">오답</span>}</td>
                  <td className="note">{x.ok ? "" : [...x.errors, ...x.missing.map((m) => `누락: ${m}`), ...x.extras.map((e) => `추가: ${e}`)].join(" · ")}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}

        <div className="card">
          <h2 className="card-title">그래서 사람이 검수합니다</h2>
          <p>AI는 원문에 없는 조건이나 금액을 지어내는 경우가 거의 없고, 인용한 근거도 원문과 일치했습니다. 하지만 <b>앱 입력으로 판정할 수 없는 서비스를 가려내는 일</b>은 자주 틀렸습니다.
            이런 서비스를 '받을 수 있음'으로 보여 주면 잘못된 안내가 되므로, AI 결과는 검수 화면에서 사람이 승인한 것만 반영합니다.</p>
          <Link className="btn" to="/review">AI 검수 화면 보기 →</Link>
          <p className="hint">결과 갱신일 {data.updated} · 자세한 실험 기록: GitHub 저장소 pipeline/RESULTS.md</p>
        </div>
      </main>
    </>
  );
}
