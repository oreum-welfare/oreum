// 혜택별 신청 안내 (어디서·어떻게·문의처·복지로 바로가기)
// 출처: 공공데이터포털 복지서비스 API로 받은 원문(pipeline/raw/api_WLF*.txt)의 [신청방법]·[문의처]
//  - 중앙 혜택은 API 원문에 신청방법 글이 없어 문의처와 복지로 상세 화면 링크로 안내한다
//  - 복지로 상세 주소(moveTWAT52011M.do?wlfareInfoId=)는 중앙 서비스(생계급여)로 열리는 것을 확인함
//  - 원문을 아직 받지 못한 혜택(id 없음)은 일반 안내(주소지 행정복지센터·129)만 보여 준다
const BOKJIRO = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=";

const APPLY = {
  saeng: { servId: "WLF00001132", contact: "보건복지상담센터 129" },
  jugeo: { servId: "WLF00003201", contact: "마이홈 1600-0777" },
  edu: { servId: "WLF00001089", contact: "한국장학재단 1599-2000" },
  basic_pension: { servId: "WLF00001164", contact: "국민연금공단 1355 · 보건복지상담센터 129" },
  energy: { servId: "WLF00000072", contact: "에너지바우처통합상담센터 1600-3190" },
  telecom: { servId: "WLF00003257", contact: "통신사 ARS 1523(휴대폰) · 과기정통부 1335" },
  eitc: { servId: "WLF00001148", how: "국세청 홈택스·손택스에서 신청", contact: "국세청 126" },
  ctc: { servId: "WLF00001148", how: "국세청 홈택스·손택스에서 신청", contact: "국세청 126" },
  gs_loan: { how: "읍면동 행정복지센터에 연중 신청 · 융자가 결정되면 신청인 계좌로 입금" },
  gs_multichild: { how: "주소지 읍면동 행정복지센터 방문 신청" },
  gs_clinic: { how: "별도 신청 없이 진료비에서 바로 감면" },
  gs_birth: { how: "출생신고 때(또는 신고 후 90일 이내) 읍면동 행정복지센터나 정부24 행복출산원스톱서비스로 신청" },
};

const GENERAL = { how: "주소지 읍면동 행정복지센터에 문의·신청", contact: "보건복지상담센터 129", general: true };

export function applyInfo(id) {
  const a = APPLY[id];
  if (!a) return GENERAL;
  return { ...a, link: a.servId ? BOKJIRO + a.servId : null };
}
