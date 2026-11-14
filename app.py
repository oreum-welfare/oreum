"""복지 절벽 시뮬레이터 - Streamlit 앱 (프로토타입 v0.1)

실행: streamlit run app.py
"""
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from rules import (ASSUMPTIONS, KIND_LABEL, REGIONS, RULE_TABLE, Household, evaluate,
                   find_cliffs, median_income, simulate)

st.set_page_config(page_title="복지 절벽 시뮬레이터", page_icon="📉", layout="wide")

PALETTE = ["#4C6EF5", "#12B886", "#FAB005", "#FA5252", "#7950F2", "#15AABF",
           "#82C91E", "#E64980", "#FD7E14", "#868E96", "#20C997", "#BE4BDB"]


def won(x: float) -> str:
    return f"{x:,.0f}원"


# ---------------------------------------------------------------------------
# 사이드바: 가구 정보
# ---------------------------------------------------------------------------
with st.sidebar:
    st.header("🏠 가구 정보")
    region = st.selectbox("거주 지역", list(REGIONS), index=1)
    age = st.number_input("본인 나이", min_value=19, max_value=100, value=40)
    spouse = st.checkbox("배우자 있음")
    spouse_65 = st.checkbox("배우자도 65세 이상", disabled=not spouse) and spouse
    dual = st.checkbox("맞벌이 (배우자 연 총급여 300만 원 이상)", disabled=not spouse) and spouse

    st.subheader("👶 자녀")
    c1, c2 = st.columns(2)
    infants = c1.number_input("영유아(0~6세)", 0, 5, 0)
    elem = c2.number_input("초등학생", 0, 5, 0)
    middle = c1.number_input("중학생", 0, 5, 0)
    high = c2.number_input("고등학생", 0, 5, 0)
    newborn = st.checkbox("올해 태어난 아이 있음")
    birth_order = 1
    if newborn:
        birth_order = st.selectbox("태어난 아이의 출생 순위", [1, 2, 3, 4],
                                   format_func=lambda x: f"{x}째" if x < 4 else "넷째 이상")
        if infants == 0:
            infants = 1
            st.caption("영유아 1명으로 자동 반영했습니다.")

    st.subheader("기타")
    disabled = st.checkbox("장애인 가구원 있음")
    single_parent = st.checkbox("한부모 가구")
    third = st.checkbox("셋째 이상 자녀(7~18세) 있음")
    residence = st.number_input("현 거주지 거주 기간(개월)", 0, 600, 60)

    st.divider()
    include_inkind = st.toggle("감면·현물 혜택도 금액으로 환산해 포함", value=True,
                               help="의료급여, 에너지바우처, 통신비 감면 등을 월 금액으로 환산해 합계에 넣습니다.")

hh = Household(region=region, age=int(age), spouse=spouse, spouse_65=spouse_65, dual_earner=dual,
               infants=int(infants), elem=int(elem), middle=int(middle), high=int(high),
               newborn=newborn, birth_order=birth_order, disabled=disabled,
               single_parent=single_parent, third_child_7to18=third, residence_months=int(residence))

m = median_income(hh.size)
max_income = int(round(m * 1.0, -4))

# ---------------------------------------------------------------------------
# 헤더
# ---------------------------------------------------------------------------
st.title("📉 복지 절벽 시뮬레이터")
st.markdown("**소득이 조금 늘 때, 어떤 복지 혜택이 언제 한꺼번에 사라지는지** 보여줍니다. "
            "복지로 선정기준 원문을 판정 규칙으로 바꿔 계산합니다.")
st.warning("⚠️ 프로토타입입니다. '임시' 표시 금액이 포함되어 있으며, 실제 수급 여부는 행정복지센터 조사로 결정됩니다.",
           icon="🧪")

tab_sim, tab_region, tab_rules, tab_about = st.tabs(
    ["📈 시뮬레이터", "🗺️ 지역 비교", "📋 판정 규칙", "ℹ️ 가정과 한계"])

# ---------------------------------------------------------------------------
# 탭 1: 시뮬레이터
# ---------------------------------------------------------------------------
with tab_sim:
    income = st.slider("월 근로소득 (가구 합계)", 0, max_income,
                       value=int(round(m * 0.35, -4)), step=10_000, format="%d원")

    benefits = evaluate(hh, income)
    df, elig = simulate(hh, max_income, include_inkind=include_inkind)
    cliffs = find_cliffs(df, elig)
    counted = [b for b in benefits if b.kind == "cash" or (include_inkind and b.kind == "inkind")]
    total = sum(b.monthly for b in counted)

    k1, k2, k3, k4 = st.columns(4)
    k1.metric("월 근로소득", won(income))
    k2.metric("받는 혜택 합계 (월)", won(total))
    k3.metric("근로소득 + 혜택", won(income + total))
    k4.metric("기준중위소득 대비", f"{income / m:.0%}", help=f"{hh.size}인 가구 중위소득 {won(m)}")

    # 다음 절벽
    nxt = next((c for c in cliffs if c["income"] > income), None)
    if nxt:
        gap = nxt["income"] - income
        lost = ", ".join(nxt["lost"]) if nxt["lost"] else "혜택 금액 감소"
        st.error(f"**다음 절벽:** 월 소득이 **{won(nxt['income'])}**(지금보다 +{won(gap)})이 되면 "
                 f"근로소득+혜택이 **{won(nxt['drop'])} 줄어듭니다.**  \n사라지는 혜택: **{lost}**", icon="🧗")
    else:
        st.success("이 소득 이후 범위에서는 절벽이 발견되지 않았습니다.", icon="✅")

    # 그래프
    fig = go.Figure()
    bcols = [c for c in df.columns if c not in ("income", "benefit_total", "disposable")]
    fig.add_trace(go.Scatter(x=df["income"], y=df["income"], name="근로소득", stackgroup="one",
                             line=dict(width=0), fillcolor="rgba(173,181,189,0.45)",
                             hovertemplate="%{y:,.0f}원"))
    for i, col in enumerate(bcols):
        fig.add_trace(go.Scatter(x=df["income"], y=df[col], name=col, stackgroup="one",
                                 line=dict(width=0, color=PALETTE[i % len(PALETTE)]),
                                 hovertemplate="%{y:,.0f}원"))
    fig.add_trace(go.Scatter(x=df["income"], y=df["disposable"], name="근로소득 + 혜택",
                             line=dict(color="#212529", width=2.5), hovertemplate="%{y:,.0f}원"))
    for c in cliffs:
        fig.add_vline(x=c["income"], line=dict(color="#FA5252", width=1, dash="dot"))
    fig.add_vline(x=income, line=dict(color="#4C6EF5", width=2),
                  annotation_text="현재", annotation_position="top left")
    for pct in (0.32, 0.40, 0.48, 0.50):
        fig.add_vline(x=m * pct / (1 - 0.30), line=dict(color="#ADB5BD", width=1, dash="dash"),
                      annotation_text=f"중위 {pct:.0%}", annotation_position="bottom right",
                      annotation_font_size=10)
    fig.update_layout(height=480, hovermode="x unified", margin=dict(l=10, r=10, t=30, b=10),
                      xaxis_title="월 근로소득 (원)", yaxis_title="월 금액 (원)",
                      legend=dict(orientation="h", y=-0.2), xaxis_tickformat=",", yaxis_tickformat=",")
    st.plotly_chart(fig, width="stretch")
    st.caption("빨간 점선 = 절벽(소득이 늘었는데 합계가 줄어드는 지점). 회색 점선 = 소득인정액 기준선 "
               "(근로소득공제 30% 가정으로 근로소득 위치로 환산).")

    c_left, c_right = st.columns([3, 2])
    with c_left:
        st.subheader("지금 받는 혜택")
        if benefits:
            st.dataframe(pd.DataFrame([{
                "혜택": b.name, "구분": b.level, "종류": KIND_LABEL[b.kind],
                "월 환산액": won(b.monthly) if b.kind != "access" else "-", "근거": b.note,
            } for b in benefits]), hide_index=True, width="stretch")
        else:
            st.info("이 소득에서 받을 수 있는 혜택이 없습니다.")
    with c_right:
        st.subheader("절벽 목록")
        if cliffs:
            st.dataframe(pd.DataFrame([{
                "월 소득": won(c["income"]), "감소액": won(c["drop"]),
                "사라지는 혜택": ", ".join(c["lost"]) or "-",
            } for c in cliffs]), hide_index=True, width="stretch")
        else:
            st.info("절벽이 없습니다.")

    with st.expander("🪜 절벽을 넘어가는 자립 경로 (사례관리자 참고)", expanded=bool(nxt)):
        st.markdown(
            "이 도구의 목적은 소득을 줄이는 것이 아니라, **절벽을 손해 없이 넘어갈 경로를 설계**하는 것입니다.\n\n"
            "- **자산형성 지원:** 희망저축계좌·청년내일저축계좌 등은 근로소득 일부를 적립하고 정부 지원금을 매칭합니다.\n"
            "- **근로소득공제:** 수급자의 근로소득 일부는 소득인정액에서 공제됩니다.\n"
            "- **자활사업:** 자활근로 참여 기간에는 별도 기준이 적용될 수 있습니다.\n"
            "- **이행 급여·유예 제도:** 탈수급 후 일정 기간 일부 급여가 유지되는 제도가 있는지 확인하세요.\n\n"
            "_세부 조건은 제도별로 다르므로 담당 기관 확인이 필요합니다._")

# ---------------------------------------------------------------------------
# 탭 2: 지역 비교
# ---------------------------------------------------------------------------
with tab_region:
    st.markdown("**같은 가구가 다른 지역에 살면** 혜택이 어떻게 달라지는지 비교합니다. "
                "주거급여 기준임대료(급지)와 지자체 자체 혜택이 달라집니다.")
    fig2 = go.Figure()
    region_dfs = {}
    for i, rg in enumerate(REGIONS):
        h2 = Household(**{**hh.__dict__, "region": rg})
        d2, _ = simulate(h2, max_income, include_inkind=include_inkind)
        region_dfs[rg] = (h2, d2)
        fig2.add_trace(go.Scatter(x=d2["income"], y=d2["disposable"], name=rg,
                                  line=dict(width=2.5, color=PALETTE[i]), hovertemplate="%{y:,.0f}원"))
    fig2.add_vline(x=income, line=dict(color="#868E96", width=1.5),
                   annotation_text="현재 소득", annotation_position="top left")
    fig2.update_layout(height=420, hovermode="x unified", margin=dict(l=10, r=10, t=30, b=10),
                       xaxis_title="월 근로소득 (원)", yaxis_title="근로소득 + 혜택 (원)",
                       legend=dict(orientation="h", y=-0.2), xaxis_tickformat=",", yaxis_tickformat=",")
    st.plotly_chart(fig2, width="stretch")

    cols = st.columns(len(REGIONS))
    for col, (rg, (h2, _)) in zip(cols, region_dfs.items()):
        bs = evaluate(h2, income)
        with col:
            st.markdown(f"#### {rg}")
            st.caption(f"현재 소득 {won(income)} 기준")
            for b in bs:
                amt = won(b.monthly) if b.kind != "access" else "자격"
                tag = "🏛️" if b.level == "중앙" else "📍"
                st.markdown(f"{tag} {b.name} — **{amt}**")
            if not bs:
                st.write("받을 수 있는 혜택 없음")

    if hh.third_child_7to18 and hh.residence_months < 36:
        st.warning(f"📍 경산시 다자녀가정 지원은 **3년 이상 계속 거주**해야 받을 수 있습니다. "
                   f"현재 거주 기간 {hh.residence_months}개월 → {36 - hh.residence_months}개월 더 필요합니다.")

# ---------------------------------------------------------------------------
# 탭 3: 판정 규칙
# ---------------------------------------------------------------------------
with tab_rules:
    st.markdown("복지로 서비스 상세 페이지의 **지원대상·선정기준 원문**을 판정 규칙으로 변환한 결과입니다.")
    st.dataframe(pd.DataFrame(RULE_TABLE, columns=["서비스", "제공 주체", "판정 조건", "원문 확인", "금액"]),
                 hide_index=True, width="stretch")
    c1, c2, c3 = st.columns(3)
    c1.metric("검증한 서비스", "13건", help="중앙부처 8건 + 지자체 5건")
    c2.metric("자동 판정 가능", "11건 (85%)")
    c3.metric("복지로 등록 서비스", "중앙 461 · 지자체 대구 137 · 경북 289")

# ---------------------------------------------------------------------------
# 탭 4: 가정과 한계
# ---------------------------------------------------------------------------
with tab_about:
    st.subheader("프로토타입 가정")
    for a in ASSUMPTIONS:
        st.markdown(f"- {a}")
    st.subheader("데이터 출처")
    st.markdown("- 복지로 복지서비스 상세 (bokjiro.go.kr), 2026년 기준, 최종수정일 2026-06 ~ 2026-08\n"
                "- 한국사회보장정보원 중앙부처·지자체 복지서비스 정보 (공공데이터포털)")
