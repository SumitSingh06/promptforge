// Word-level diff (longest common subsequence) used for the Before/After prompt view.
// Returns [{ type: "same" | "add" | "del", text }]

export function wordDiff(before, after, maxWords = 500) {
  const a = String(before).split(/\s+/).filter(Boolean).slice(0, maxWords);
  const b = String(after).split(/\s+/).filter(Boolean).slice(0, maxWords);
  const n = a.length, m = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += " " + text; // merge neighbouring words
    else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}
