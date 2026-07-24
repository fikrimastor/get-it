// src/background/concurrency-limiter.js
// Minimal dependency-free FIFO concurrency limiter for download operations.

export function createConcurrencyLimiter() {
  let active = 0;
  let currentLimit = 3;
  /** @type {{ task: () => Promise<any>, resolve: (v: any) => void, reject: (e: any) => void }[]} */
  const queue = [];

  function dequeue() {
    while (queue.length > 0 && active < currentLimit) {
      const entry = queue.shift();
      active++;
      Promise.resolve()
        .then(() => entry.task())
        .then(
          (result) => {
            active--;
            dequeue();
            entry.resolve(result);
          },
          (err) => {
            active--;
            dequeue();
            entry.reject(err);
          },
        );
    }
  }

  /**
   * Run a task under the concurrency cap.
   * Always enqueues FIFO; the latest `maxConcurrent` is applied globally on drain.
   * Clamped to [1, 10].
   * @param {() => Promise<any>} task
   * @param {number} maxConcurrent - upper bound (clamped to [1, 10])
   * @returns {Promise<any>}
   */
  function run(task, maxConcurrent) {
    currentLimit = Math.min(10, Math.max(1, maxConcurrent | 0));
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      dequeue();
    });
  }

  return { run };
}
