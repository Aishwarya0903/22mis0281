/**
 * 0/1 knapsack scheduler.
 *
 *   tasks:    Array<{ TaskID, Duration, Impact }>
 *   capacity: integer hours budget (sum of MechanicHours across depots)
 *
 * Returns { selected, totalDuration, totalImpact, capacity, skipped }.
 *
 * Implementation notes:
 *   - Classic O(n * W) DP. With ~50 tasks and W in the low hundreds, this
 *     is comfortably fast (well under a millisecond on commodity hardware).
 *   - Durations are assumed to be non-negative integers. The API in the
 *     spec sends integer Duration values, so no rounding is needed.
 *   - Ties on impact are broken in favour of *fewer* tasks (i.e. higher
 *     impact-per-hour), so the planner doesn't burn the mechanics' day on
 *     work that could have been skipped.
 */

function solveKnapsack(tasks, capacity) {
  if (!Number.isFinite(capacity) || capacity < 0) {
    throw new Error(`Invalid capacity: ${capacity}`);
  }
  if (!Array.isArray(tasks)) {
    throw new Error('tasks must be an array');
  }

  const cap = Math.floor(capacity);
  const n = tasks.length;

  // dp[w] = best impact achievable using a subset of tasks considered so
  // far, with total duration exactly <= w. We rebuild incrementally.
  const dp = new Array(cap + 1).fill(0);
  // keep[i][w] = was task i chosen when filling capacity w?
  const keep = Array.from({ length: n }, () => new Uint8Array(cap + 1));

  for (let i = 0; i < n; i++) {
    const d = tasks[i].Duration;
    const v = tasks[i].Impact;

    // Guard against bad data — skip rather than crash.
    if (!Number.isFinite(d) || !Number.isFinite(v) || d < 0) continue;

    // Iterate w from high to low so each task is considered once (0/1).
    for (let w = cap; w >= d; w--) {
      const candidate = dp[w - d] + v;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        keep[i][w] = 1;
      }
    }
  }

  // Backtrack to recover the actual chosen set.
  const selected = [];
  let w = cap;
  for (let i = n - 1; i >= 0; i--) {
    if (keep[i][w]) {
      selected.push(tasks[i]);
      w -= tasks[i].Duration;
    }
  }
  selected.reverse();

  const totalDuration = selected.reduce((acc, t) => acc + t.Duration, 0);
  const totalImpact   = selected.reduce((acc, t) => acc + t.Impact, 0);
  const chosenIds     = new Set(selected.map(t => t.TaskID));
  const skipped       = tasks.filter(t => !chosenIds.has(t.TaskID));

  return {
    selected,
    skipped,
    totalDuration,
    totalImpact,
    capacity: cap,
    utilisationPct: cap > 0 ? +(totalDuration * 100 / cap).toFixed(2) : 0,
  };
}

function sumMechanicHours(depots) {
  return depots.reduce((acc, d) => acc + Number(d.MechanicHours || 0), 0);
}

module.exports = { solveKnapsack, sumMechanicHours };
