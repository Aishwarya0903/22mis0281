# Notification Backend

Implements the Stage 6 deliverable from the notifications question: a
priority inbox that returns the top *n* most important unread
notifications, ranked by a combination of notification type and
recency.

## Endpoints

| Method | Path                            | Purpose |
|--------|---------------------------------|---------|
| GET    | `/notifications`                | Passthrough of the upstream feed. |
| GET    | `/notifications/top?n=10`       | Top-N by priority. Cap is 100. |
| GET    | `/notifications/top?n=10&explain=1` | Same, but includes per-item score breakdown. |
| GET    | `/health`                       | Liveness check. |

Example:

```bash
curl 'http://localhost:3001/notifications/top?n=5&explain=1'
```

```json
{
  "count": 5,
  "notifications": [
    {
      "ID": "b2832...",
      "Type": "Placement",
      "Message": "CSX Corporation hiring",
      "Timestamp": "2026-04-22T17:51:18Z",
      "_priority": {
        "score": 2.94,
        "weight": 3,
        "ageHours": 4.13,
        "recencyFactor": 0.9831
      }
    },
    ...
  ]
}
```

## Priority formula

```
score = typeWeight × 0.5 ^ (ageHours / 168)

typeWeight: Placement = 3, Result = 2, Event = 1
half-life:  168 hours (one week)
```

Reasoning is in the header comment of `priorityScorer.js`. The
formula is intentionally pure (a function of the notification alone),
so it can be moved server-side into a database column or
materialised view if query volume ever justifies precomputation.

## Running

```bash
cp .env.example .env       # then fill in EVAL_* credentials
npm install
npm start                  # listens on :3001 by default
```

## Testing

```bash
npm test
```

The tests run against a frozen `now` so decay behaviour is
deterministic.

## Scope

The other stages (1–5) are answered as written design in
`../notification_system_design.md`. Per the spec, only Stage 6
required executable code; the rest is architecture and reasoning.
