const assert = require('node:assert/strict');
const {
  topN,
  scoreNotification,
  TYPE_WEIGHTS,
  HALF_LIFE_HOURS,
} = require('../priorityScorer');

function describe(name, fn) { process.stdout.write(`\n${name}\n`); fn(); }
function it(name, fn) {
  try { fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) {
    process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`);
    process.exitCode = 1;
  }
}

const now = Date.parse('2026-04-22T18:00:00Z');
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();

describe('scoreNotification', () => {

  it('weights Placement higher than Result, Result higher than Event', () => {
    const ts = hoursAgo(1);
    const p = scoreNotification({ Type: 'Placement', Timestamp: ts }, now).score;
    const r = scoreNotification({ Type: 'Result',    Timestamp: ts }, now).score;
    const e = scoreNotification({ Type: 'Event',     Timestamp: ts }, now).score;
    assert.ok(p > r, `expected ${p} > ${r}`);
    assert.ok(r > e, `expected ${r} > ${e}`);
  });

  it('decays with age — half score at one half-life', () => {
    const fresh = scoreNotification({ Type: 'Result', Timestamp: hoursAgo(0) }, now).score;
    const aged  = scoreNotification({ Type: 'Result', Timestamp: hoursAgo(HALF_LIFE_HOURS) }, now).score;
    assert.ok(Math.abs(aged - fresh / 2) < 0.001,
      `expected ${aged} ≈ ${fresh / 2}`);
  });

  it('scores unknown types as zero', () => {
    const r = scoreNotification({ Type: 'Mystery', Timestamp: hoursAgo(0) }, now);
    assert.equal(r.score, 0);
  });

  it('handles unparseable timestamps without crashing', () => {
    const r = scoreNotification({ Type: 'Placement', Timestamp: 'not-a-date' }, now);
    assert.equal(r.score, 0);
    assert.equal(r.ageHours, Infinity);
  });
});

describe('topN', () => {

  it('returns at most n items', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ID: `${i}`,
      Type: 'Event',
      Timestamp: hoursAgo(i),
    }));
    assert.equal(topN(items, 10, now).length, 10);
  });

  it('ranks a fresh Placement above a fresh Event', () => {
    const items = [
      { ID: 'event-now',     Type: 'Event',     Timestamp: hoursAgo(0) },
      { ID: 'placement-now', Type: 'Placement', Timestamp: hoursAgo(0) },
    ];
    const ranked = topN(items, 2, now);
    assert.equal(ranked[0].ID, 'placement-now');
  });

  it('ranks a fresh Event above a year-old Placement', () => {
    const items = [
      { ID: 'event-fresh',  Type: 'Event',     Timestamp: hoursAgo(0) },
      { ID: 'placement-old', Type: 'Placement', Timestamp: hoursAgo(24 * 365) },
    ];
    const ranked = topN(items, 2, now);
    assert.equal(ranked[0].ID, 'event-fresh');
  });

  it('throws on invalid n', () => {
    assert.throws(() => topN([], 0));
    assert.throws(() => topN([], -1));
    assert.throws(() => topN([], 'ten'));
  });

  it('throws if notifications is not an array', () => {
    assert.throws(() => topN(null, 10));
  });
});

describe('TYPE_WEIGHTS', () => {
  it('is the documented mapping', () => {
    assert.equal(TYPE_WEIGHTS.Placement, 3);
    assert.equal(TYPE_WEIGHTS.Result,    2);
    assert.equal(TYPE_WEIGHTS.Event,     1);
  });
});
