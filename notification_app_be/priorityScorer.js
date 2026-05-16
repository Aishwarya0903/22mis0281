/**
 Priority scorer for the Priority Inbox feature (Stage 6).
 
 Score is a combination of:
 - Type weight: Placement > Result > Event
 - Recency:     fresher notifications outweigh stale ones
 
 *Formula
 score = typeWeight * recencyFactor
 typeWeight     ∈ { Placement: 3, Result: 2, Event: 1 }
 recencyFactor  = 0.5 ^ (ageHours / HALF_LIFE_HOURS)
 
 
 */

const TYPE_WEIGHTS = Object.freeze({
  Placement: 3,
  Result:    2,
  Event:     1,
});

const HALF_LIFE_HOURS = 168; // one week

function scoreNotification(notification, now = Date.now()) {
  const weight = TYPE_WEIGHTS[notification.Type] ?? 0;
  const ts = Date.parse(notification.Timestamp);
  if (Number.isNaN(ts)) {
    // Unparseable timestamp → treat as ancient.
    return { score: 0, weight, ageHours: Infinity, recencyFactor: 0 };
  }
  const ageHours = Math.max(0, (now - ts) / 3_600_000);
  const recencyFactor = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
  return {
    score: weight * recencyFactor,
    weight,
    ageHours: +ageHours.toFixed(2),
    recencyFactor: +recencyFactor.toFixed(4),
  };
}

function topN(notifications, n = 10, now = Date.now()) {
  if (!Array.isArray(notifications)) {
    throw new Error('notifications must be an array');
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`n must be a positive integer, got ${n}`);
  }

  return notifications
    .map(notif => ({
      ...notif,
      _priority: scoreNotification(notif, now),
    }))
    .sort((a, b) => b._priority.score - a._priority.score)
    .slice(0, n);
}

module.exports = { topN, scoreNotification, TYPE_WEIGHTS, HALF_LIFE_HOURS };
