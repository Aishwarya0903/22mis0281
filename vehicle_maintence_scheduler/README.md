# Vehicle Maintenance Scheduler

A microservice that pulls the day's maintenance backlog from the
evaluation server and decides which tasks the team should service
**right now** so the total operational impact is maximised within the
available mechanic-hours.

## The problem in one sentence

> Given a budget of *H* mechanic-hours and a list of tasks each with a
> `Duration` (hours) and an `Impact` (a score), pick the subset of
> tasks whose total duration ≤ *H* and whose total impact is the
> largest possible.

That is a 0/1 knapsack problem. It is NP-hard in general but trivial at
the scale the API actually returns (~50 tasks, capacity in the low
hundreds), so a straight dynamic-programming solution is more than
fast enough.

## How capacity is determined

The Vehicles API returns a flat list of tasks with no depot field, so
there's no published relation between a task and a depot. The
problem statement uses *"a daily mechanic-hour budget"* in the
singular, so I treat the budget as **sum of all depots'
MechanicHours**. Documented in code: `scheduler.js → sumMechanicHours`.

If the spec is later clarified to bind each task to a depot, swapping
in a *per-depot* knapsack is a few-line change — call `solveKnapsack`
once per depot with that depot's task subset and capacity.

## Algorithm

`scheduler.js` implements bottom-up 0/1 knapsack:

```
dp[w] = max impact achievable in capacity w considering items 0..i
for each item i:
    for w from W down to duration[i]:
        dp[w] = max(dp[w], dp[w-duration[i]] + impact[i])
```

Backtracking through a `keep[i][w]` bitmap recovers the actual subset
of selected tasks, not just the optimal value.

Complexity: O(n · W) time, O(n · W) memory for the `keep` matrix.

No external libraries are used for the algorithm itself — only
`express`, `axios`, and `dotenv` for the boilerplate.

## API

| Method | Path        | What it does |
|--------|-------------|--------------|
| GET    | `/schedule` | Solve and return the plan |
| GET    | `/schedule?dryRun=1` | Also return inputs and skipped tasks |
| GET    | `/health`   | Liveness check |

Sample response:

```json
{
  "summary": {
    "depotsConsidered": 5,
    "tasksConsidered": 47,
    "capacityHours": 644,
    "utilisationPct": 98.45,
    "tasksSelected": 31,
    "totalDurationHours": 634,
    "totalImpactScore": 215,
    "computeTimeMs": 412
  },
  "selectedTaskIds": [
    "264e638f-1c7a-4d67-9f9c-53f3d1766d3",
    "..."
  ],
  "selectedTasks": [ ... ]
}
```

## Running

```bash
cp .env.example .env       # then fill in EVAL_* credentials
npm install
npm start                  # listens on :3000 by default
curl http://localhost:3000/schedule
```

## Testing

```bash
npm test
```

Runs the assertions in `tests/scheduler.test.js` — no framework
required, just Node's built-in `node:assert`.

## Things deliberately not done

- **No caching of API responses.** The depot and vehicle data is fresh
  for every call. If the upstream proved slow in practice, a TTL cache
  in `apiClient.js` would be a small change.
- **No streaming for very large task lists.** At the spec's scale, the
  whole list fits in memory comfortably. If the API ever returned
  ~10⁵ tasks, the DP arrays would need a re-think.
- **No retry on upstream 5xx.** A 502 is surfaced cleanly to the
  caller. Retries would mask intermittent issues during debugging.
