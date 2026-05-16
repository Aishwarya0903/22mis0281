/**
 * Lightweight tests for the knapsack scheduler. No framework — just
 * assertions. Run with `npm test` or `node tests/scheduler.test.js`.
 */

const assert = require('node:assert/strict');
const { solveKnapsack, sumMechanicHours } = require('../scheduler');

function describe(name, fn) {
  process.stdout.write(`\n${name}\n`);
  fn();
}
function it(name, fn) {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`);
    process.exitCode = 1;
  }
}

describe('solveKnapsack', () => {

  it('returns no tasks for zero capacity', () => {
    const r = solveKnapsack(
      [{ TaskID: 'a', Duration: 1, Impact: 5 }],
      0,
    );
    assert.equal(r.selected.length, 0);
    assert.equal(r.totalImpact, 0);
  });

  it('picks all tasks when capacity is unbounded', () => {
    const tasks = [
      { TaskID: 'a', Duration: 1, Impact: 5 },
      { TaskID: 'b', Duration: 2, Impact: 3 },
      { TaskID: 'c', Duration: 4, Impact: 7 },
    ];
    const r = solveKnapsack(tasks, 1000);
    assert.equal(r.selected.length, 3);
    assert.equal(r.totalImpact, 15);
  });

  it('solves the textbook example correctly', () => {
    // Classic small knapsack: capacity 10, expect max impact 15.
    const tasks = [
      { TaskID: 'a', Duration: 6, Impact: 8 },
      { TaskID: 'b', Duration: 5, Impact: 7 },
      { TaskID: 'c', Duration: 4, Impact: 6 },
      { TaskID: 'd', Duration: 3, Impact: 4 },
    ];
    const r = solveKnapsack(tasks, 10);
    assert.equal(r.totalImpact, 14);
    // any feasible mix that hits 14 is acceptable
    assert.ok(r.totalDuration <= 10);
  });

  it('does not double-count any task', () => {
    const tasks = [
      { TaskID: 'x', Duration: 3, Impact: 10 },
    ];
    const r = solveKnapsack(tasks, 10);
    assert.equal(r.selected.length, 1);
    assert.equal(r.totalDuration, 3);
  });

  it('reports utilisation percentage', () => {
    const tasks = [{ TaskID: 'a', Duration: 5, Impact: 1 }];
    const r = solveKnapsack(tasks, 10);
    assert.equal(r.utilisationPct, 50);
  });

  it('survives bad task data (skips it)', () => {
    const tasks = [
      { TaskID: 'good', Duration: 2, Impact: 5 },
      { TaskID: 'bad',  Duration: 'oops', Impact: 99 },
      { TaskID: 'neg',  Duration: -1, Impact: 99 },
    ];
    const r = solveKnapsack(tasks, 5);
    assert.equal(r.totalImpact, 5);
    assert.deepEqual(r.selected.map(t => t.TaskID), ['good']);
  });

  it('throws on negative capacity', () => {
    assert.throws(() => solveKnapsack([], -1));
  });
});

describe('sumMechanicHours', () => {
  it('sums depot budgets', () => {
    const depots = [
      { ID: 1, MechanicHours: 60 },
      { ID: 2, MechanicHours: 135 },
      { ID: 3, MechanicHours: 188 },
    ];
    assert.equal(sumMechanicHours(depots), 383);
  });

  it('treats missing MechanicHours as zero', () => {
    assert.equal(sumMechanicHours([{ ID: 1 }, { ID: 2, MechanicHours: 10 }]), 10);
  });
});
