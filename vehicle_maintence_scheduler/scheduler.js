

function solveKnapsack(tasks, capacity) {
  if (!Number.isFinite(capacity) || capacity < 0) {
    throw new Error(`Invalid capacity: ${capacity}`);
  }
  if (!Array.isArray(tasks)) {
    throw new Error('tasks must be an array');
  }

  const cap = Math.floor(capacity);
  const n = tasks.length;

 
  const dp = new Array(cap + 1).fill(0);
 
  const keep = Array.from({ length: n }, () => new Uint8Array(cap + 1));

  for (let i = 0; i < n; i++) {
    const d = tasks[i].Duration;
    const v = tasks[i].Impact;

   
    if (!Number.isFinite(d) || !Number.isFinite(v) || d < 0) continue;

    
    for (let w = cap; w >= d; w--) {
      const candidate = dp[w - d] + v;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        keep[i][w] = 1;
      }
    }
  }

  
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
