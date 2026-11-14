import { Chart, registerables } from "chart.js";

Chart.register(...registerables);
Chart.defaults.font.family = "Pretendard, -apple-system, 'Malgun Gothic', sans-serif";
Chart.defaults.color = "#868E96";

// 절벽(빨간 점선)·현재 소득(진한 실선) 세로선. 선 위치는 ref 객체(opts.ref.current)에서 읽는다.
export const vlinePlugin = {
  id: "vlines",
  afterDatasetsDraw(chart, _args, opts) {
    const lines = opts?.ref?.current || {};
    const { ctx, chartArea, scales } = chart;
    const draw = (idx, color, dash, width) => {
      const x = scales.x.getPixelForValue(idx);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.restore();
    };
    (lines.cliffs || []).forEach((i) => draw(i, "#FA5252", [5, 4], 1.5));
    if (lines.current != null) draw(lines.current, "#1F2430", [], 2);
  },
};

// 시뮬레이터 그래프 표식: 손해 구간 띠, 다른 절벽(옅은 점선), ①지금 ②다음 절벽 ③회복 번호 원
export const markerPlugin = {
  id: "markers",
  beforeDatasetsDraw(chart, _args, opts) {
    const m = opts?.ref?.current;
    if (!m) return;
    const { ctx, chartArea, scales } = chart;
    const fill = (from, to, color) => {
      const a = scales.x.getPixelForValue(Math.min(from, to)), b = scales.x.getPixelForValue(Math.max(from, to));
      ctx.fillStyle = color;
      ctx.fillRect(a, chartArea.top, Math.max(2, b - a), chartArea.bottom - chartArea.top);
    };
    ctx.save();
    if (m.compare != null && m.compare !== m.current) fill(m.current, m.compare, "rgba(59, 91, 219, 0.07)"); // 내 소득 ↔ 비교 소득
    if (m.band) fill(m.band[0], m.band[1], "rgba(250, 82, 82, 0.08)"); // 손해 구간
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    const m = opts?.ref?.current || {};
    const { ctx, chartArea, scales } = chart;
    const data = chart.data.datasets[0]?.data || [];
    const xAt = (i) => scales.x.getPixelForValue(i);
    const yAt = (i) => scales.y.getPixelForValue(data[i] ?? 0);
    ctx.save();
    (m.others || []).forEach((i) => {
      ctx.strokeStyle = "rgba(250, 82, 82, 0.35)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(xAt(i), chartArea.top); ctx.lineTo(xAt(i), chartArea.bottom); ctx.stroke();
    });
    ctx.setLineDash([]);
    // 번호 원은 그래프 위쪽에 두고, 가까우면 아래로 엇갈려 겹치지 않게 한다
    const pins = [[m.current, "#1F2430", "1"], [m.cliff, "#FA5252", "2"], [m.recover, "#2B8A3E", "3"]]
      .filter(([i]) => i != null && i >= 0 && i < data.length)
      .map(([i, color, label]) => ({ i, color, label, x: xAt(i) }))
      .sort((p, q) => p.x - q.x);
    let lastX = -Infinity, row = 0;
    for (const p of pins) {
      row = p.x - lastX < 24 ? row + 1 : 0;
      lastX = p.x;
      p.py = chartArea.top + 4 + row * 24;
    }
    for (const p of pins) {
      const y = yAt(p.i);
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.py); ctx.lineTo(p.x, chartArea.bottom); ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // 비교 소득: 파란 마름모 + 점선 (슬라이더를 따라 움직임)
    if (m.compare != null && m.compare !== m.current && m.compare < data.length) {
      const x = xAt(m.compare), y = yAt(m.compare);
      ctx.strokeStyle = "#3B5BDB"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3B5BDB"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const p of pins) {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.py, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "600 11px Pretendard, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.label, p.x, p.py + 0.5);
    }
    ctx.restore();
  },
};
