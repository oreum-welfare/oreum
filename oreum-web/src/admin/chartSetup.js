// 관리자 화면 차트(chart.js) 공통 설정
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);
Chart.defaults.font.family = "Pretendard, -apple-system, 'Malgun Gothic', sans-serif";
Chart.defaults.color = "#8b95a1";
Chart.defaults.borderColor = "#f2f4f6";
