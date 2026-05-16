# Notification System Design

This document walks through the design of the campus notification
microservice across six stages, each building on the previous one.
Each stage is a self-contained section so it can be reviewed in
isolation.

---

## Stage 1

### Context

We need a REST API that the frontend uses to display notifications to
a logged-in student. Three kinds of notification flow through the
system: **Placement**, **Event**, and **Result**. Each one has a
short message and a timestamp; the user can mark them read or
dismiss them.

### Core actions

| User intent                          | HTTP                                           |
|--------------------------------------|------------------------------------------------|
| Pull my notifications when I open the app | `GET /api/v1/students/{studentId}/notifications` |
| Pull only the unread ones for the badge   | `GET /api/v1/students/{studentId}/notifications?status=unread&limit=1` (we just need the `total` field) |
| Mark one as read                          | `PATCH /api/v1/students/{studentId}/notifications/{id}` with `{ "isRead": true }` |
| Mark everything read                      | `POST /api/v1/students/{studentId}/notifications/mark-all-read` |
| Broadcast (admin)                         | `POST /api/v1/notifications` |

Pagination is cursor-based, not offset-based. Offset paging breaks
when new notifications stream in mid-scroll; cursors don't.

### Request / response shape

```jsonc
// GET /api/v1/students/1042/notifications?status=unread&limit=20
{
  "notifications": [
    {
      "id": "d1460958-...",
      "type": "Result",
      "message": "mid-sem",
      "createdAt": "2026-04-22T17:51:30Z",
      "isRead": false
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA0LTIyVDE3OjUxOjMwWiJ9",
  "total": 47
}
```

```jsonc
// POST /api/v1/notifications  (admin / system)
{
  "type": "Placement",
  "message": "CSX Corporation hiring",
  "recipients": "all",          // or an array of studentIds
  "scheduledFor": "2026-04-23T09:00:00Z"  // optional
}
```

### Naming conventions

- URLs are kebab-case, JSON keys are camelCase. Pick one of each and
  stop debating it.
- Resource names are plural, identifiers are nouns.
- The API is versioned in the path (`/api/v1`). Breaking changes will
  ship under `/api/v2`.
- HTTP verbs follow REST conventions: `GET` is safe and idempotent,
  `POST` creates, `PATCH` partial-updates, `DELETE` removes.
- Status codes are standard: `200` for retrieved, `201` for created,
  `204` for no-content (mark-all-read), `400` for bad input, `404`
  for missing resources, `502` when an upstream is down.

### What this design optimises for

Predictability over cleverness. Anyone who has used a REST API for
five minutes can guess the URL and payload shape without reading the
docs. That matters more than fashionable design at this stage.

---

## Stage 2

### Storage choice: PostgreSQL

Three reasons:

1. **Reads dominate**, but the writes that do happen need
   transactional guarantees. When a student marks a notification
   read, the badge count update and the row update must both happen
   or neither happens. Postgres ACID gives us that for free.
2. **The schema is stable.** Notifications have a fixed shape:
   `{id, studentId, type, message, createdAt, isRead}`. We don't
   need NoSQL's schema flexibility, and we'd pay for it in lost
   query-time joins.
3. **The query patterns are well-known.** "Most recent unread for
   student X" is a classic indexed range scan, exactly what a B-tree
   index in Postgres is built for. NoSQL stores can do this too but
   require us to maintain secondary indexes or denormalised
   materialised views.

A document store like MongoDB would handle the volume, and a wide
column store like Cassandra would handle the write throughput during
broadcasts. Neither problem is bad enough at our scale (50k students,
~5M notifications) to outweigh the cost of giving up SQL joins and
transactions.

### Schema

```sql
CREATE TABLE notifications (
  id          UUID         PRIMARY KEY,
  student_id  BIGINT       NOT NULL REFERENCES students(id),
  type        VARCHAR(20)  NOT NULL
              CHECK (type IN ('Placement', 'Event', 'Result')),
  message     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_read     BOOLEAN      NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ
);
```

A separate `notification_broadcasts` table tracks broadcast metadata
(sender, target audience, scheduled send time) and an
`outbox_events` table feeds the queue worker in Stage 5.

### Problems that show up at volume

- **Index bloat on `is_read` flipping.** Marking-read updates one
  column on potentially many rows and touches every secondary index
  that includes `is_read`. Mitigation: a partial index that
  *excludes* read rows (Stage 3).
- **`SELECT * FROM notifications` is dangerous.** With 5M rows and
  a query that omits `WHERE student_id`, the planner picks a seq
  scan. Mitigation: enforce a `student_id` filter at the
  application layer, and treat any unfiltered query in production
  logs as a bug.
- **Schema migrations.** Adding a column to a 5M-row table needs to
  be done with care (`ALTER TABLE ... ADD COLUMN ... DEFAULT NULL`,
  then backfill in batches). Mitigation: a migration tool such as
  `pg-migrate` or Liquibase, plus a "no destructive migrations in
  rush hour" team norm.

### NoSQL alternative considered

If write volume during a broadcast (50k inserts in a few seconds)
proves too painful for a single Postgres primary, we could route
broadcast inserts through Kafka into a Cassandra table partitioned
by `(student_id, day)`. Queries would join the two stores. This is
worth the complexity only if we observe Postgres struggling, which is
unlikely at this scale.

---

## Stage 3

### The query in question

```sql
SELECT *
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Is it accurate?

Logically yes — it returns the unread feed for one student. There
are three things to clean up:

1. **`SELECT *` is wasteful.** The UI uses `id`, `type`, `message`,
   `createdAt`, `isRead`. Returning `read_at` and any future columns
   pumps bytes across the wire for no reason.
2. **No `LIMIT`.** A student with thousands of unread notifications
   would receive all of them in one response. Add `LIMIT 50` (or
   whatever the page size is) and cursor-paginate the rest.
3. **No cursor on `created_at`.** Without one, paging the second
   page becomes either `OFFSET` (which scans and discards) or
   re-fetching the full list. Adding `AND created_at < $cursor`
   keeps every page fast.

Cleaned up:

```sql
SELECT id, type, message, created_at, is_read
FROM notifications
WHERE student_id = 1042
  AND is_read = false
  AND created_at < $cursor    -- optional, for page 2+
ORDER BY created_at DESC
LIMIT 50;
```

### Why it's slow

On 5M rows with no useful index, Postgres falls back to a sequential
scan plus an in-memory sort. That's why page loads feel sluggish.

### Will a single-column index help?

Not really. An index on `student_id` alone narrows the rowset to
roughly 5M / 50k ≈ 100 rows per student, which is OK, but Postgres
still has to filter by `is_read` and sort by `created_at` after the
fetch.

### What does help: a composite partial index

```sql
CREATE INDEX idx_notifications_student_unread
  ON notifications (student_id, created_at DESC)
  WHERE is_read = FALSE;
```

This index does three things at once:

- Filters by `student_id`.
- Skips read rows entirely (because of the `WHERE` clause), so the
  index stays small — only as big as the global unread backlog.
- Stores rows in `created_at DESC` order, so the planner can drop
  the sort step and just walk the index.

Expected planner output:

```
Index Scan using idx_notifications_student_unread on notifications
  Index Cond: (student_id = 1042)
  Heap Fetches: ...
```

For the typical "20 unread for one student" query, this is a
sub-millisecond operation.

### Should we add an index on every column?

No, and this is a mistake worth pushing back on. Every additional
index:

- **Slows down writes.** Every `INSERT` / `UPDATE` touches every
  index. Mark-as-read on a hot student can cause meaningful write
  amplification.
- **Costs storage.** A B-tree on a 5M-row table is hundreds of MB.
- **Confuses the planner.** With redundant indexes, Postgres
  sometimes picks the wrong one.

The right principle: add indexes that match real query shapes, and
prove necessity with `EXPLAIN ANALYZE`. The two we actually need:

```sql
-- Partial index for the unread-feed query (Stage 3)
CREATE INDEX idx_notifications_student_unread
  ON notifications (student_id, created_at DESC)
  WHERE is_read = FALSE;

-- For the "all placements in last 7 days" admin query
CREATE INDEX idx_notifications_type_recent
  ON notifications (type, created_at DESC);
```

### Finding all students with a placement notification in the last 7 days

With `idx_notifications_type_recent` in place:

```sql
SELECT DISTINCT student_id
FROM notifications
WHERE type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```

The index makes this an index-only range scan over a narrow slice
(7 days × placement volume). Without the index, it's a full table
scan.

---

## Stage 4

### The problem

The DB is being hammered on every page load. Indexes from Stage 3
make each query fast, but 50,000 students refreshing their inbox
every few minutes still drives a lot of small, identical reads. The
queries are fast individually; in aggregate they saturate the DB's
connection pool.

### The fix: Redis as a read-through cache

Cache layout:

```
notifications:student:{id}:unread:page:1   →   JSON, TTL 30s
notifications:student:{id}:unread:count    →   integer, TTL 30s
```

On read:

1. Check Redis. If present, return it. Done in O(1).
2. On miss, query Postgres, store result in Redis with a 30s TTL,
   return it.

On write (new notification, mark-as-read):

1. Invalidate the affected student's cache keys.

### Why these specific choices

**TTL of 30 seconds** is short enough that staleness is rarely
visible to users (a notification arriving at 12:00:01 is in their
feed by 12:00:31 at the latest, and usually instantly because mark-
read writes also invalidate), but long enough that bursty traffic
during a chapel announcement or exam-result release flattens out.

**Per-student keys, not a global cache.** A global "all unread
feeds" cache would have a hot-key problem during broadcasts. Sharded
by student, the cache scales linearly with the number of active
users.

**Cache-aside, not write-through.** Write-through would tie every DB
write to a Redis write, doubling the failure modes. Cache-aside with
invalidation lets the DB stay the source of truth.

### How much load does this take off the DB?

If the average student refreshes once every 60 seconds and the cache
TTL is 30 seconds, roughly half of the requests hit the cache. The
ratio gets much better in practice because students tend to refresh
in bursts (open the app, scroll, refresh, idle for 10 minutes).

A back-of-envelope: 50k students × 1 refresh / minute = ~830 reads
per second hitting the cache, of which maybe 10–15% miss → about 100
DB queries per second instead of 830. The Postgres primary is happy.

### Effectiveness?

Yes. Caching is one of the genuinely effective fixes to "DB is
overwhelmed" — but only because the workload is read-heavy and the
data is per-user (so the cache doesn't have a hot-key problem). If
this were a write-heavy workload, caching wouldn't help and we'd be
looking at sharding or queues instead.

---

## Stage 5

### Reviewing the pseudocode

```js
function notify_all(student_ids: array, message: string):
  for student_id in student_ids:
      send_email(student_id, message)     # calls Email API
      save_to_db(student_id, message)     # DB insert
      push_to_app(student_id, message)    # in-app notification
```

There are several problems, and they compound.

### Problems

**Sequential.** Each iteration waits for the previous one to finish.
At ~200ms per email round trip, 50,000 students × 200ms = nearly
three hours per broadcast. By the time the last student is
notified, the news is stale.

**No retry.** The team notes 200 emails failed midway. With the
current code, those 200 students simply never get the email and we
have no record of which ones — the loop moved on.

**Tight coupling.** The email API, the DB, and the push service are
three independent systems with three independent failure modes. The
loop treats all three failures as "skip and continue," which loses
data silently.

**DB insert per iteration.** 50,000 single-row inserts at ~5ms each
is over four minutes of pure DB time, plus connection overhead, plus
lock contention. A batch insert would do the same work in a few
seconds.

**No idempotency.** If the process crashes halfway through and
restarts, students 1 to 25,000 will get a second copy of the email.

### Should the DB save and the email send be paired in a loop?

No. They should be decoupled:

- The DB row is the **source of truth**. Once it's written, the user
  can see the notification in the app whether or not the email ever
  arrives.
- The email and push are **side effects**. They're best-effort
  deliveries handled asynchronously, with retries and visibility
  into failures.

Reliable broadcasts use the **outbox pattern**:

1. In a single transaction, batch-insert all 50,000 notification rows
   *and* a single broadcast event row in the outbox table.
2. A worker reads the outbox event and enqueues per-student delivery
   jobs into a queue (RabbitMQ, SQS, Kafka — anything with at-least-
   once semantics).
3. A pool of email-sending workers consumes the queue in parallel,
   sending emails and pushes with retries and exponential backoff.

### Revised design

```js
// 1. Controller — synchronous, returns immediately
async function notify_all(student_ids, message, type):
    notification_id = uuid()
    transaction:
        batch_insert(notification_id, student_ids, message, type)
        enqueue_outbox_event(notification_id)
    return 202 Accepted, { notification_id, count: len(student_ids) }

// 2. Outbox worker — reads new events, fans out to queue
on outbox_event(notification_id):
    rows = fetch_rows_for(notification_id)
    for chunk in chunks(rows, 1000):
        queue.enqueue_batch(chunk, key=notification_id)

// 3. Email worker — parallel consumers
on email_job(student_id, notification_id, message):
    if already_sent(notification_id, student_id):   // idempotency
        return
    try:
        send_email(student_id, message)
        push_to_app(student_id, message)
        mark_sent(notification_id, student_id)
    except RetryableError as e:
        raise   // queue retries with backoff
    except FatalError as e:
        mark_failed(notification_id, student_id, e)
```

### What this fixes

- **Speed.** 50 workers sending in parallel cut a 3-hour job to about
  3 minutes.
- **Reliability.** Failed jobs go back on the queue with exponential
  backoff. After max retries, they land in a dead-letter queue for
  manual review. The 200 failed emails would be visible and
  retryable.
- **Idempotency.** Each `(notification_id, student_id)` pair is
  unique; replay is safe.
- **Decoupling.** Email API outage doesn't block in-app delivery,
  because the DB row is already there.
- **Observability.** The outbox table is a paper trail of every
  broadcast and its delivery status per student.

### Should the save-to-DB happen as one big batch?

Yes, with a caveat. A single transaction inserting 50,000 rows is
fine for Postgres if it's a `INSERT ... SELECT` or `COPY`. Some
hosting environments cap transaction size or replication lag, so for
very large broadcasts (say, 500k+) we'd chunk into batches of 5–10k
in their own transactions and accept eventual consistency between
chunks.

---

## Stage 6

### The feature

Show the top *n* most important unread notifications, where
importance combines **type** (Placement > Result > Event) and
**recency**.

### Approach

Define a score per notification:

```
score = typeWeight × recencyFactor
```

`typeWeight` is a small constant per type. `recencyFactor` is
exponential decay over time, so a notification's score halves over
some fixed period.

```
typeWeights:    Placement = 3, Result = 2, Event = 1
recencyFactor:  0.5 ^ (ageInHours / HALF_LIFE_HOURS)
HALF_LIFE_HOURS: 168   (one week)
```

A fresh Placement scores 3.0. A week-old Placement scores 1.5.
A fresh Event scores 1.0, which already loses to a week-old
Placement — exactly matching "Placement > Result > Event".

### Why exponential decay

Linear decay (e.g., `1 - age / max_age`) has a hard cutoff and treats
the gap between "2 hours old" and "5 hours old" the same as "8 days
old" vs "11 days old". For a notifications inbox, users care most
about the last 24 hours; the right curve is shallow over years and
steep over days. Exponential decay gives that shape, and the
half-life parameter is a single intuitive knob.

### Sketch implementation (executable code is in `notification_app_be/priorityScorer.js`)

```js
function score(notification, now) {
  const weight = TYPE_WEIGHTS[notification.Type] ?? 0;
  const ageHours = (now - Date.parse(notification.Timestamp)) / 3600_000;
  return weight * Math.pow(0.5, ageHours / 168);
}

function topN(notifications, n) {
  return notifications
    .map(n => ({ ...n, _score: score(n, Date.now()) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, n);
}
```

### How to maintain this efficiently as data grows

Today, with the API returning maybe a few hundred notifications per
call, scoring in memory is fine: 200 items × constant-time score =
nothing. If the workload grew to "rank the last 10,000 across 50,000
students continuously", we'd:

1. **Add a `priority_score` column** to the notifications table,
   recomputed by a cron job every 30 minutes (the decay is smooth
   enough that 30-minute updates are imperceptible).
2. **Index it descending** combined with `student_id` and `is_read`:
   `(student_id, is_read, priority_score DESC)`.
3. **Query becomes a top-K index range scan**: O(log N + n).

That's a bigger change than what the spec asks for, but the pure
function shape of `score()` makes it portable — same math, just
running at write time instead of read time.

### Shortcomings to flag

- **Per-user personalisation is missing.** A student in their final
  year cares about placements; a first-year cares more about events.
  A future iteration would learn per-user weights or accept
  user-configured weights.
- **Decay is identical for everyone.** Some students check their
  inbox daily; others weekly. A weekly checker effectively sees
  "older" notifications because their `now` lags. A more adaptive
  decay could be based on time-since-last-read rather than absolute
  age.
- **No spam suppression.** If a single placement triggers ten
  near-identical notifications, the inbox fills with duplicates.
  De-duplication is an obvious next step.

These aren't blockers for shipping v1 — they're a roadmap for v2.
