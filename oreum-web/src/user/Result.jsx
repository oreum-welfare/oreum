import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Sheet } from "../ui/index.jsx";
import { applyInfo } from "./apply.js";
import Chart from "./Chart.jsx";
import { LEVEL_LABEL, STEP, about, iga, levelOf, manwon, short, sourceKeys, won } from "./data.js";

// 결과 화면: 숫자 하나 → 조심할 곳 한 줄 → 다시 좋아지는 곳 → 그래프 → 비교 → 자세히(시트)
export default function Result({ data, hh, income, r, includeInkind, setIncludeInkind, setCompare, adoptCompare, onEdit, onRestart }) {
  const [sheet, setSheet] = useState(null);
  const close = useCallback(() => setSheet(null), []);
  const { inc, total, benefits, cliff, curLoss, cmp, diff, maxIncome } = r;
  const hasAssets = hh.housingAsset + hh.financialAsset + hh.debt > 0;
  const soonLost = new Set(cliff?.lost || []);
  const pct = maxIncome ? (cmp / maxIncome) * 100 : 0;

  return (
    <div className="screen">
      <div className="screen-body col wide">
        {/* 휴대폰: 한 줄로 (요약 → 그래프 → 자세히). PC: 왼쪽 그래프·비교, 오른쪽 요약·자세히 */}
        <div className="r-grid">
        <div className="r-main">
        {/* 1. 지금 받는 복지 */}
        <section className="result-head">
          <p className="label">{inc > 0 ? `지금 월 ${manwon(inc)} 원을 벌면` : "지금 근로소득이 없으면"}</p>
          {total > 0
            ? <><p className="big">월 {manwon(total)} 원</p><p className="desc" style={{ margin: 0 }}>복지 혜택을 받을 수 있어요</p></>
            : <><p className="big" style={{ fontSize: 30 }}>받을 수 있는 복지가 없어요</p><p className="desc" style={{ margin: 0 }}>이 소득에서는 계산되는 혜택이 없어요</p></>}
          {!hasAssets && total > 0 && <p className="asset-hint">재산 0원으로 계산했어요 · <button type="button" className="link-btn" onClick={() => onEdit(4)}>재산 넣기</button></p>}
          {r.capped && <p className="notice">입력한 소득(월 {manwon(income)} 원)이 너무 커서, 계산할 수 있는 가장 큰 소득(월 {manwon(maxIncome)} 원) 기준으로 보여 드려요.</p>}
        </section>

        {/* 2. 조심할 곳 / 3. 다시 좋아지는 곳 */}
        {curLoss ? (
          <>
            <div className="alert">
              <p className="alert-title"><span className="icon" aria-hidden="true">⚠️</span>지금은 생활비가 줄어든 구간이에요</p>
              <p>월 {manwon(curLoss.beforeIncome)} 원일 때보다 생활비가 {manwon(curLoss.shortfall)} 원 적어요</p>
            </div>
            {curLoss.recover != null
              ? <p className="recover">월급이 {manwon(curLoss.recover)} 원이 되면 생활비가 {manwon(curLoss.beforeIncome)} 원 벌 때만큼 돌아와요</p>
              : <p className="note">계산 범위 안에서는 회복되지 않아요</p>}
            <p className="reassure"><button type="button" className="link-btn" onClick={() => setSheet("path")}>줄어드는 동안 도움이 되는 제도 보기 ›</button></p>
          </>
        ) : cliff ? (
          <>
            <div className="alert">
              <p className="alert-title"><span className="icon" aria-hidden="true">⚠️</span>월급 {manwon(cliff.income)} 원부터 생활비가 줄어요</p>
              <p>{cliff.lost[0]}{iga(cliff.lost[0])} 끊겨 {cliff.vsNow != null ? `약 ${about(cliff.vsNow)} 원 줄어요` : `바로 전(${manwon(cliff.before)} 원)보다 ${manwon(cliff.drop)} 원 줄어요`}</p>
            </div>
            {cliff.recover != null
              ? <p className="recover">월급이 {manwon(cliff.recover)} 원이 되면 생활비가 {manwon(cliff.before)} 원 벌 때만큼 돌아와요</p>
              : <p className="note">계산 범위 안에서는 다시 회복되지 않아요</p>}
            <p className="reassure"><button type="button" className="link-btn" onClick={() => setSheet("path")}>줄어드는 동안 도움이 되는 제도 보기 ›</button></p>
          </>
        ) : (
          <div className="alert calm">
            <p className="alert-title">앞으로 생활비가 줄어드는 구간은 없어요</p>
            <p>소득이 늘수록 생활비도 계속 늘어나요</p>
          </div>
        )}

        <div className="desk-actions">
          <button type="button" className="btn primary" onClick={() => setSheet("path")}>넘는 방법 보기</button>
          <button type="button" className="btn ghost" onClick={onEdit}>정보 수정</button>
        </div>
        </div>

        <div className="r-chart">
        {/* 4. 그래프 */}
        <Chart sim={r.sim} inc={inc} cmp={cmp} cliffs={r.cliffs}
          focus={curLoss ? { income: curLoss.cliff.income, recover: curLoss.recover } : cliff ? { income: cliff.income, recover: cliff.recover } : null} />

        {/* 5. 비교 */}
        <section className="compare" aria-label="소득을 바꿔 보기">
          <div className="compare-top"><span className="label">소득을 바꿔 보면</span><b>월 {manwon(cmp)} 원</b></div>
          <input className="range" type="range" min="0" max={maxIncome} step={STEP} value={cmp} style={{ "--p": `${pct}%` }}
            aria-label="비교할 월 근로소득" aria-valuetext={`월 ${manwon(cmp)} 원`} onChange={(e) => setCompare(Number(e.target.value))} />
          {cmp === inc
            ? <p className="compare-result">슬라이더를 움직이면 생활비가 어떻게 바뀌는지 보여 드려요</p>
            : <>
                <p className="compare-result">생활비 <b className={diff.disp >= 0 ? "up" : "bad"}>{diff.disp >= 0 ? "+" : "−"}{manwon(Math.abs(diff.disp))} 원</b> · 지금과 비교
                  {diff.lost.length > 0 && <><br />{diff.lost.slice(0, 2).join(", ")}{diff.lost.length > 2 ? ` 외 ${diff.lost.length - 2}개` : ""} 끊김</>}
                  {diff.gained.length > 0 && <><br />{diff.gained.slice(0, 2).join(", ")} 새로 받음</>}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn ghost small" onClick={() => setCompare(inc)}>내 소득으로</button>
                  <button type="button" className="btn ghost small" onClick={adoptCompare}>이 소득으로 다시 계산</button>
                </div>
              </>}
        </section>
        </div>

        <div className="r-more">
        {/* 6. 자세히 */}
        <nav className="rows" aria-label="자세히 보기">
          <button type="button" className="row" onClick={() => setSheet("benefits")}><span>받는 혜택 {benefits.length}가지</span><span className="chev">월 {manwon(total)} 원</span></button>
          {cliff && <button type="button" className="row" onClick={() => setSheet("cliff")}><span>왜 줄어드나요?</span><span className="chev">{cliff.lost[0]}</span></button>}
          <button type="button" className="row" onClick={() => setSheet("path")}><span>줄어드는 구간 넘는 방법</span><span className="chev">{pathCount(r.programs, r.gains)}가지</span></button>
          <button type="button" className="row" onClick={() => setSheet("region")}><span>다른 지역이라면?</span><span className="chev" /></button>
          <button type="button" className="row" onClick={() => setSheet("basis")}><span>계산 기준</span><span className="chev" /></button>
        </nav>

        {/* 6. 상담 연결: 결과 링크 복사 (입력값이 주소에 저장돼 있어 같은 화면이 열림) */}
        <ShareBox />
        </div>
        </div>

        <footer className="footer">
          <p style={{ margin: "0 0 8px" }}>{short(hh.region)} · {hh.age}세{hh.spouse ? " · 배우자" : ""}{hh.infants + hh.elem + hh.middle + hh.high ? ` · 자녀 ${hh.infants + hh.elem + hh.middle + hh.high}명` : ""}{hh.singleParent ? " · 한부모" : ""}</p>
          <p style={{ margin: "0 0 12px" }}>2026년 기준 참고용이에요. 실제 수급은 읍면동 행정복지센터에서 결정돼요.</p>
          <button type="button" className="link-btn" onClick={onRestart} style={{ fontSize: 13 }}>처음부터 다시</button>
          <span style={{ margin: "0 8px" }}>·</span>
          <Link to="/admin" style={{ fontSize: 13 }}>관리자 화면</Link>
        </footer>
      </div>

      <div className="bottom mobile-bottom"><div className="col">
        <button type="button" className="btn ghost" onClick={onEdit}>정보 수정</button>
        <button type="button" className="btn primary" onClick={() => setSheet("path")}>넘는 방법 보기</button>
      </div></div>

      {sheet === "benefits" && <BenefitsSheet {...{ data, benefits, total, inc, soonLost, hasAssets, includeInkind, setIncludeInkind, close }} />}
      {sheet === "cliff" && cliff && <CliffSheet cliff={cliff} cliffs={r.cliffs} m={r.m} close={close} />}
      {sheet === "path" && <PathSheet programs={r.programs} cliff={cliff} curLoss={curLoss} gains={r.gains} close={close} />}
      {sheet === "region" && <RegionSheet regions={r.regions} hh={hh} close={close} />}
      {sheet === "basis" && <BasisSheet data={data} benefits={benefits} hasAssets={hasAssets} close={close} />}
    </div>
  );
}

function BenefitsSheet({ data, benefits, total, inc, soonLost, hasAssets, includeInkind, setIncludeInkind, close }) {
  const [open, setOpen] = useState(null);
  return (
    <Sheet title={`받는 혜택 ${benefits.length}가지`} sub={`월 ${manwon(inc)} 원을 벌 때 · 눌러서 근거 보기`} onClose={close}>
      <div className="sum"><span>혜택 합계</span><b>{won(total)}</b></div>
      <div className="sum" style={{ marginTop: 0 }}><span>월급 + 혜택 (생활비)</span><b>{won(inc + total)}</b></div>
      {!benefits.length && <p className="note">이 소득에서 받을 수 있는 혜택이 없어요.</p>}
      <ul className="list">
        {benefits.map((b) => {
          const lv = levelOf(data, b.id, hasAssets);
          return (
            <li className="item" key={b.id}>
              <button type="button" className="item-btn" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                <span className="item-name">{b.name}{soonLost.has(b.name) && <span className="tag red">곧 끊김</span>}{lv !== "ok" && <span className="tag gray">{LEVEL_LABEL[lv]}</span>}
                  <small>{b.level} · {b.kind === "cash" ? "현금" : b.kind === "inkind" ? "감면·현물" : "자격·융자"}</small></span>
                <span className="item-amt">{b.kind === "access" ? "자격" : won(b.monthly)}</span>
              </button>
              {open === b.id && <div className="item-detail"><p>{b.note}</p><Apply id={b.id} soon={soonLost.has(b.name)} /><Evidence data={data} id={b.id} hasAssets={hasAssets} /></div>}
            </li>
          );
        })}
      </ul>
      <p className="membership">내 실제 소득·재산으로 정확히 확인하려면 <a href="https://www.bokjiro.go.kr/ssis-tbu/index.do" target="_blank" rel="noopener noreferrer">복지로</a>의 <b>맞춤형급여안내(복지멤버십)</b>에 가입해 보세요. 동의하면 받을 수 있는 복지를 정부가 직접 알려 줘요.</p>
      <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 15 }}>
        <input type="checkbox" checked={includeInkind} onChange={(e) => setIncludeInkind(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--brand-strong)" }} />
        의료급여·통신비 같은 감면·현물도 금액으로 계산
      </label>
    </Sheet>
  );
}

// 결과 링크 복사: 상담할 때 사례관리자에게 보여 주거나 가족과 나누기
function ShareBox() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <section className="share">
      <div><b>상담할 때 이 결과를 보여 주세요</b><p>링크를 열면 같은 결과가 보여요. 입력한 내용은 링크 안에만 있어요.</p></div>
      <button type="button" className="btn small" onClick={copy} aria-live="polite">{done ? "복사했어요" : "링크 복사"}</button>
    </section>
  );
}

// 신청 안내: 어디서·어떻게, 문의처, 복지로 바로가기
function Apply({ id, soon }) {
  const a = applyInfo(id);
  return (
    <div className="apply">
      <p className="apply-title">신청하기{soon && <span> · 끊기기 전에 챙기세요</span>}</p>
      {a.how && <p>{a.how}</p>}
      {a.contact && <p className="apply-contact">문의 {a.contact}</p>}
      {a.link && <a className="apply-link" href={a.link} target="_blank" rel="noopener noreferrer">복지로에서 신청 방법 보기 ↗</a>}
    </div>
  );
}

function Evidence({ data, id, hasAssets }) {
  const src = data.benefit_sources?.[id];
  if (!src) return null;
  const rule = data.rule_table.find((x) => x.service === src.rule);
  return (
    <>
      {rule && <p><b>선정기준</b> {rule.condition}<br /><b>금액</b> {rule.amount}</p>}
      {sourceKeys(data, id, hasAssets).map((k) => <p key={k} style={{ color: "var(--text-3)", fontSize: 13 }}>{data.verification[k].status} · {data.verification[k].basis}</p>)}
    </>
  );
}

function CliffSheet({ cliff, cliffs, m, close }) {
  const top = cliff.causes[0]?.reduction || 1;
  return (
    <Sheet title="왜 줄어드나요?" sub={`월급이 ${manwon(cliff.before)} 원 → ${manwon(cliff.income)} 원이 될 때`} onClose={close}>
      <p style={{ margin: "4px 0 12px", fontSize: 16 }}>월급은 1만 원 늘지만, 혜택이 더 크게 줄어 생활비가 <b className="bad">{manwon(cliff.drop)} 원</b> 줄어요.</p>
      {cliff.causes.length > 0 && <div className="bars">
        {cliff.causes.map((c) => (
          <div className="bar-row" key={c.id}><span>{c.name}</span><div className="bar"><i style={{ width: `${(c.reduction / top) * 100}%` }} /></div><b className="bad">−{manwon(c.reduction)}</b></div>
        ))}
      </div>}
      <p className="group-title" style={{ marginTop: 24 }}>이 가구의 모든 절벽</p>
      {cliffs.map((c) => (
        <div className="kv" key={c.index}><span>월 {manwon(c.income)} 원 (중위 {Math.round((c.income / m) * 100)}%)</span><b className="bad">−{manwon(c.drop)}</b></div>
      ))}
    </Sheet>
  );
}

// 넘는 방법: ① 이 가구의 소득 길(엔진 계산) ② 넘는 동안 버티기 ③ 길게 보는 자립 준비
const BRIDGE = ["hope1", "gsloan", "eitc"]; // 끊기기 전에 챙기거나, 넘은 뒤 메우는 것
const LONG = ["hope2", "youth", "jahwal"]; // 절벽과 직접 관계는 없지만 자립에 도움
// 근로·자녀장려금은 다시 늘어나는 소득에서도 계속 받을 때만 '넘는 동안 버티기'에 넣는다
const pathPrograms = (programs, gains) => programs.filter((p) => p.key !== "eitc" || gains.afterIncome == null || gains.creditAfter > 0);
const pathCount = (programs, gains) => pathPrograms(programs, gains).filter((p) => BRIDGE.includes(p.key) || LONG.includes(p.key)).length;

function PathSheet({ programs, cliff, curLoss, gains, close }) {
  const shown = pathPrograms(programs, gains);
  const pick = (keys) => keys.map((k) => shown.find((p) => p.key === k)).filter(Boolean);
  const bridge = pick(BRIDGE), long = pick(LONG);
  const extra = (p) => {
    if (p.key === "eitc" && gains.creditAfter > 0) return `월 ${manwon(gains.afterIncome)} 원이 돼도 월 약 ${about(gains.creditAfter)} 원을 계속 받아요`;
    if (p.key === "gsloan") return "최대 1,200만 원 무이자 융자 · 탈수급 전에만 신청 가능";
    if (p.key === "hope1") return "탈수급할 때 모은 돈을 받아요";
    return null;
  };
  const Card = (p) => (
    <div className="card" key={p.key}>
      <h3>{p.title}</h3>
      {extra(p) && <p className="gain">{extra(p)}</p>}
      <p>{p.why}</p><p style={{ marginTop: 6 }}>{p.what}</p><p className="where">{p.where}</p>
    </div>
  );
  return (
    <Sheet title="줄어드는 구간 넘는 방법" sub="이 가구의 소득으로 계산했어요" onClose={close}>
      <p className="group-title" style={{ marginTop: 4 }}>1. 이 가구의 소득 길</p>
      <ol className="path">
        {curLoss ? <>
          <li className="bad"><b>지금</b> 월 {manwon(curLoss.beforeIncome)} 원일 때보다 생활비가 {manwon(curLoss.shortfall)} 원 적어요</li>
          {curLoss.recover != null
            ? <li className="up"><b>월 {manwon(curLoss.recover)} 원부터</b> 생활비가 {manwon(curLoss.beforeIncome)} 원 벌 때만큼 돌아와요. 소득이 오른다면 이 금액 이상을 목표로 하세요</li>
            : <li>계산 범위 안에서는 회복되지 않아요</li>}
        </> : cliff ? <>
          <li><b>월 {manwon(cliff.before)} 원까지</b> 소득이 늘수록 생활비도 늘어요</li>
          <li className="bad"><b>월 {manwon(cliff.income)} 원부터</b> {cliff.lost[0]}{iga(cliff.lost[0])} 끊겨 생활비가 줄어요</li>
          {cliff.recover != null
            ? <li className="up"><b>월 {manwon(cliff.recover)} 원부터</b> 생활비가 {manwon(cliff.before)} 원 벌 때만큼 돌아와요. 소득이 오른다면 이 금액 이상을 목표로 하세요</li>
            : <li>계산 범위 안에서는 다시 늘지 않아요</li>}
        </> : <li className="up">앞으로 생활비가 줄어드는 구간은 없어요</li>}
      </ol>
      {gains.deductionGain > 0 && <p className="notice">근로소득공제 덕분에 지금 매달 약 <b>{about(gains.deductionGain)} 원</b>을 더 받고 있어요. 신청하지 않아도 자동으로 적용돼요.</p>}

      {bridge.length > 0 && <>
        <p className="group-title">2. 넘는 동안 버티기</p>
        <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>끊기기 전에 챙기거나, 넘은 뒤 줄어든 생활비를 메워 줘요</p>
        {bridge.map(Card)}
      </>}
      {long.length > 0 && <>
        <p className="group-title">3. 길게 보는 자립 준비</p>
        <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>절벽을 막아 주지는 않지만, 자립에 도움이 돼요</p>
        {long.map(Card)}
      </>}
      <p className="note">세부 조건과 금액은 해마다 바뀌어요. 신청 전에 복지로나 행정복지센터에서 확인하세요.</p>
    </Sheet>
  );
}

function RegionSheet({ regions, hh, close }) {
  const here = regions.find((x) => x.region === hh.region);
  return (
    <Sheet title="다른 지역이라면?" sub="같은 가족·같은 소득일 때" onClose={close}>
      {regions.map((x) => (
        <div className="kv" key={x.region}>
          <span>{short(x.region)}{x.region === hh.region ? " (지금)" : ""}</span>
          <b>월 {manwon(x.total)} 원{x.region !== hh.region && here ? <span style={{ color: "var(--text-3)", fontWeight: 400 }}> ({x.total - here.total >= 0 ? "+" : "−"}{manwon(Math.abs(x.total - here.total))})</span> : null}</b>
        </div>
      ))}
      <p className="note">주거급여 기준임대료와 지자체 혜택이 지역마다 달라요.</p>
    </Sheet>
  );
}

function BasisSheet({ data, benefits, hasAssets, close }) {
  const levels = benefits.map((b) => levelOf(data, b.id, hasAssets));
  const cnt = (k) => levels.filter((l) => l === k).length;
  return (
    <Sheet title="계산 기준" sub="2026년 기준 · 참고용" onClose={close}>
      <div className="kv"><span>근거 확인</span><b>확인 {cnt("ok")} · 일부 추정 {cnt("part")} · 추정 {cnt("est")}</b></div>
      <p className="group-title">가정</p>
      <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 14 }}>{data.assumptions.map((a) => <li key={a} style={{ marginBottom: 6 }}>{a}</li>)}
        <li style={{ marginBottom: 6 }}>입력한 소득은 일해서 버는 소득(근로·사업소득)으로 보고 계산합니다. 자영업자의 근로·자녀장려금은 실제로 매출에 업종별 조정률을 곱해 계산하지만, 오름은 업종별 조정률을 반영하지 않습니다.</li></ul>
      <p className="membership">내 실제 소득·재산으로 정확히 확인하려면 <a href="https://www.bokjiro.go.kr/ssis-tbu/index.do" target="_blank" rel="noopener noreferrer">복지로</a>의 <b>맞춤형급여안내(복지멤버십)</b>에 가입해 보세요. 동의하면 받을 수 있는 복지를 정부가 직접 알려 줘요.</p>
      <p className="note">출처: 복지로(보건복지부), 한국사회보장정보원, 지자체 공고 · 실제 수급은 행정복지센터에서 결정돼요.</p>
    </Sheet>
  );
}
