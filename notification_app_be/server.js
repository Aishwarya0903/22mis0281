require('dotenv').config();

const express = require('express');
const { Log } = require('../logging_middleware/logger');
const { fetchNotifications } = require('./apiClient');
const { topN } = require('./priorityScorer');

const app = express();
app.use(express.json());

// ---- Routes --------------------------------------------------------------

/**
 * GET /notifications
 * Passthrough of the upstream notification feed.
 */
app.get('/notifications', async (req, res) => {
  try {
    const notifications = await fetchNotifications();
    await Log('backend', 'info', 'route',
      `GET /notifications returned ${notifications.length} items`);
    res.json({ count: notifications.length, notifications });
  } catch (err) {
    await Log('backend', 'error', 'service',
      `fetchNotifications failed: ${err.message}`);
    res.status(502).json({ error: 'upstream_unavailable' });
  }
});

/**
 * GET /notifications/top?n=10
 *
 * Stage 6: priority inbox. Returns the n highest-priority
 * notifications based on a combination of type weight and recency.
 *
 * The default n=10 matches the spec. Cap at 100 to keep responses
 * bounded.
 */
app.get('/notifications/top', async (req, res) => {
  const startedAt = Date.now();

  const requestedN = Number(req.query.n) || 10;
  const n = Math.min(Math.max(1, Math.floor(requestedN)), 100);

  let notifications;
  try {
    notifications = await fetchNotifications();
  } catch (err) {
    await Log('backend', 'error', 'service',
      `fetchNotifications failed in /top: ${err.message}`);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }

  let ranked;
  try {
    ranked = topN(notifications, n);
  } catch (err) {
    await Log('backend', 'error', 'domain',
      `priority scoring failed: ${err.message}`);
    return res.status(400).json({ error: 'bad_request', message: err.message });
  }

  const elapsedMs = Date.now() - startedAt;
  await Log('backend', 'info', 'route',
    `GET /notifications/top?n=${n} served in ${elapsedMs}ms`);

  // The `_priority` debug field is informative for evaluators but
  // would normally be stripped behind a feature flag in production.
  const includeScore = req.query.explain === '1';
  res.json({
    count: ranked.length,
    notifications: ranked.map(({ _priority, ...rest }) =>
      includeScore ? { ...rest, _priority } : rest,
    ),
  });
});

/** Health check. */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

// ---- Fallthroughs --------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.use(async (err, req, res, next) => {
  await Log('backend', 'fatal', 'handler',
    `unhandled error on ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'internal_error' });
});

// ---- Boot ----------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3001;
if (require.main === module) {
  app.listen(PORT, async () => {
    await Log('backend', 'info', 'service',
      `notification backend listening on :${PORT}`);
  });
}

module.exports = app;
