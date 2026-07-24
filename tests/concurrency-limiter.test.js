// tests/concurrency-limiter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConcurrencyLimiter } from '../src/background/concurrency-limiter.js';

test('caps active tasks to the supplied limit', async () => {
  const limiter = createConcurrencyLimiter();
  let active = 0;
  let maxObserved = 0;
  let completed = 0;

  function makeTask(delay) {
    return async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await new Promise((r) => setTimeout(r, delay));
      active--;
      completed++;
    };
  }

  // Submit 3 tasks with limit 2
  const results = await Promise.all([
    limiter.run(makeTask(30), 2),
    limiter.run(makeTask(30), 2),
    limiter.run(makeTask(30), 2),
  ]);

  assert.equal(results.length, 3);
  assert.ok(maxObserved <= 2, `maxObserved (${maxObserved}) exceeded limit 2`);
  assert.equal(completed, 3);
});

test('drains queued tasks in FIFO order', async () => {
  const limiter = createConcurrencyLimiter();
  const order = [];

  function makeTask(id) {
    return async () => {
      order.push(id);
      // Varying delay so the only reason task 2 waits for task 1 is the limiter
      await new Promise((r) => setTimeout(r, id === 1 ? 20 : 5));
    };
  }

  const p1 = limiter.run(makeTask(1), 1);
  const p2 = limiter.run(makeTask(2), 1);
  const p3 = limiter.run(makeTask(3), 1);

  await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('releases a slot after a task rejection', async () => {
  const limiter = createConcurrencyLimiter();
  let completions = 0;

  // Fill one slot with a task that rejects
  const p1 = limiter.run(async () => { throw new Error('boom'); }, 2);
  await assert.rejects(p1, /boom/);

  // A subsequent task should start (slot was freed)
  const p2 = limiter.run(async () => { completions++; }, 2);
  await p2;
  assert.equal(completions, 1);
});

test('clamps limit to at least 1 (zero and negative)', async () => {
  const limiter = createConcurrencyLimiter();
  const order = [];

  // Limit 0 -> clamped to 1
  await limiter.run(async () => { order.push('a'); }, 0);
  // Limit -5 -> clamped to 1
  await limiter.run(async () => { order.push('b'); }, -5);

  assert.deepEqual(order, ['a', 'b']);
});

test('does not exceed limit across rapid submissions', async () => {
  const limiter = createConcurrencyLimiter();
  let active = 0;
  let maxObserved = 0;

  function makeTask() {
    return async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
    };
  }

  await Promise.all(Array.from({ length: 10 }, () => limiter.run(makeTask(), 3)));
  assert.ok(maxObserved <= 3, `maxObserved (${maxObserved}) exceeded limit 3`);
});

function deferred() {
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise: p, resolve, reject };
}

test('increasing limit drains queue in FIFO order before starting newly submitted task', async () => {
  const limiter = createConcurrencyLimiter();
  const order = [];

  // A runs at limit 1, holding the slot
  const aDef = deferred();
  const pA = limiter.run(async () => { order.push('A'); await aDef.promise; }, 1);

  // B, C queue behind A (active=1, limit=1)
  const pB = limiter.run(async () => { order.push('B'); }, 1);
  const pC = limiter.run(async () => { order.push('C'); }, 1);

  // D submitted at limit 3 -- must NOT bypass B and C
  const pD = limiter.run(async () => { order.push('D'); }, 3);

  // Release A
  aDef.resolve();
  await pA;
  await Promise.all([pB, pC, pD]);

  assert.deepEqual(order, ['A', 'B', 'C', 'D']);
});

test('decreasing limit blocks stale-queued entries until active count drops below new limit', async () => {
  const limiter = createConcurrencyLimiter();
  const order = [];

  // Fill all 3 slots at limit 3
  const defs = [deferred(), deferred(), deferred()];
  const promises = defs.map((d, i) =>
    limiter.run(async () => { order.push(String.fromCharCode(65 + i)); await d.promise; }, 3),
  );

  // D queued with stale limit 3, then E queued with new limit 1 (clamps currentLimit to 1)
  const dDef = deferred();
  const pD = limiter.run(async () => { order.push('D'); await dDef.promise; }, 3);
  const eDef = deferred();
  const pE = limiter.run(async () => { order.push('E'); await eDef.promise; }, 1);

  // Let A finish -> active=2. currentLimit=1 -> nothing new should start.
  defs[0].resolve();
  await promises[0];
  await new Promise((r) => setTimeout(r, 0));
  // Old per-entry code would start D (stale limit=3 > active=2). New code must not.
  assert.equal(order.includes('D'), false, 'D must not start after A finishes (active=2, limit=1)');
  assert.equal(order.includes('E'), false, 'E must not start after A finishes');

  // Let B finish -> active=1. Still 1 not < 1.
  defs[1].resolve();
  await promises[1];
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(order.includes('D'), false, 'D must not start after B finishes (active=1, limit=1)');
  assert.equal(order.includes('E'), false, 'E must not start after B finishes');

  // Let C finish -> active=0. D may now start (first in queue, 0 < 1).
  defs[2].resolve();
  await promises[2];
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(order.includes('D'), true, 'D must start after C finishes (active=0, limit=1)');
  assert.equal(order.includes('E'), false, 'E must still wait');

  // Finish D -> E can start
  dDef.resolve();
  await pD;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(order.includes('E'), true, 'E must start after D finishes');

  eDef.resolve();
  await pE;

  assert.deepEqual(order, ['A', 'B', 'C', 'D', 'E']);
});

test('clamps limit to at most 10 - mid-flight check', async () => {
  const limiter = createConcurrencyLimiter();
  let active = 0;
  let maxObserved = 0;

  const defs = Array.from({ length: 15 }, () => deferred());
  const promises = defs.map((d) =>
    limiter.run(async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await d.promise;
      active--;
    }, 999),
  );

  // After synchronously submitting all 15, at most 10 should be active
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(active <= 10, `active (${active}) exceeded clamp of 10`);
  assert.ok(maxObserved <= 10, `maxObserved (${maxObserved}) exceeded clamp of 10`);

  // Resolve everything
  for (const d of defs) d.resolve();
  await Promise.all(promises);
});

test('clamps limit to at most 10 - all resolved', async () => {
  const limiter = createConcurrencyLimiter();
  let active = 0;
  let maxObserved = 0;

  const defs = Array.from({ length: 15 }, () => deferred());
  const promises = defs.map((d) =>
    limiter.run(async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await d.promise;
      active--;
    }, 999),
  );

  // Resolve everything immediately
  for (const d of defs) d.resolve();
  await Promise.all(promises);

  assert.ok(maxObserved <= 10, `maxObserved (${maxObserved}) exceeded clamp of 10`);
});
