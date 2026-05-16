require('dotenv').config();

const express = require('express');
const { Log } = require('../logging_middleware/logger');
const { fetchDepots, fetchVehicleTasks } = require('./apiClient');
const { solveKnapsack, sumMechanicHours } = require('./scheduler');

const app = express();
app.use(express.json());

// ---- Routes --------------------------------------------------------------

/**
 * GET /schedule
 *
 * Pulls depots + vehicle tasks from the protected APIs, solves the knapsack,
 * and returns the selected task IDs plus totals.
 *
 * Query params:
 *   ?dryRun=1  → returns inputs alongside the schedule for debugging
 */
app.get('/schedule', async (req, res) => {
  const startedAt = Date.now();

  let depots, tasks;
  try {
    [depots, tasks] = await Promise.all([fetchDepots(), fetchVehicleTasks()]);
  } catch (err) {
    await Log('backend', 'error', 'service',
      `upstream API call failed: ${err.message}`);
    return res.status(502).json({
      error: 'upstream_unavailable',
      message: err.message,
    });
  }

  const capacity = sumMechanicHours(depots);

  await Log('backend', 'info', 'domain',
    `solving for ${tasks.length} tasks, capacity ${capacity}h across ${depots.length} depots`);

  let result;
  try {
    result = solveKnapsack(tasks, capacity);
  } catch (err) {
    await Log('backend', 'error', 'domain',
      `scheduler crashed: ${err.message}`);
    return res.status(500).json({
      error: 'scheduling_failed',
      message: err.message,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  await Log('backend', 'info', 'route',
    `/schedule served in ${elapsedMs}ms, picked ${result.selected.length}/${tasks.length} tasks`);

  const body = {
    summary: {
      depotsConsidered:    depots.length,
      tasksConsidered:     tasks.length,
      capacityHours:       result.capacity,
      utilisationPct:      result.utilisationPct,
      tasksSelected:       result.selected.length,
      totalDurationHours:  result.totalDuration,
      totalImpactScore:    result.totalImpact,
      computeTimeMs:       elapsedMs,
    },
    selectedTaskIds: result.selected.map(t => t.TaskID),
    selectedTasks:   result.selected,
  };

  if (req.query.dryRun) {
    body.inputs = { depots, allTasks: tasks };
    body.skipped = result.skipped;
  }

  res.json(body);
});

/** Health check. */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

// ---- Error handler -------------------------------------------------------

// 404 fallthrough
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// Last-resort error handler — Log() never throws so this rarely fires.
app.use(async (err, req, res, next) => {
  await Log('backend', 'fatal', 'handler',
    `unhandled error on ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'internal_error' });
});

// ---- Boot ----------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, async () => {
    await Log('backend', 'info', 'service',
      `vehicle scheduler listening on :${PORT}`);
  });
}

module.exports = app;
