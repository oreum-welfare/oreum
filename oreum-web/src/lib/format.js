export const won = (x) => `${Math.round(x).toLocaleString("ko-KR")}원`;
export const man = (x) => {
  const v = Math.round(x / 1000) / 10;
  return `${Number.isInteger(v) ? v.toLocaleString("ko-KR") : v.toFixed(1)}만`;
};
export const pct = (x) => `${Math.round(x)}%`;
