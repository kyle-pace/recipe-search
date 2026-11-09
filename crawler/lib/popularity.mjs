// Reads Amplitude's event segmentation answer (scripts/popularity.mjs) into
// { recipe_key: opens }.
/** One count per recipe_key: each group's series summed over the window. */
export function totals(data) {
  const opens = {};
  const labels = data?.seriesLabels || [];
  (data?.series || []).forEach((series, n) => {
    const label = labels[n];
    const k = Array.isArray(label) ? label[label.length - 1] : label;
    if (typeof k !== 'string' || !k.includes(':') || k === '(none)') return;
    const total = (Array.isArray(series) ? series : [series]).reduce((a, b) => a + (Number(b) || 0), 0);
    if (total > 0) opens[k] = (opens[k] || 0) + total;
  });
  return opens;
}
