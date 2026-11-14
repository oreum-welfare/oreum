import { Chart, registerables } from "chart.js";

Chart.register(...registerables);
Chart.defaults.font.family = "Pretendard, -apple-system, 'Malgun Gothic', sans-serif";

// 절벽(빨간 점선)·현재 소득(파란 실선) 세로선. 선 위치는 ref 객체(chart.options.plugins.vlines.ref.current)에서 읽는다.
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
    (lines.cliffs || []).forEach((i) => draw(i, "#e03131", [5, 4], 1.5));
    if (lines.current != null) draw(lines.current, "#3b5bdb", [], 2);
  },
};
