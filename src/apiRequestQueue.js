const { LookupError } = require("./lookupResult");

function createApiQueue({ now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), intervalMs = 1100 } = {}) {
  let nextStart = 0;
  let pausedUntil = 0;
  let tail = Promise.resolve();
  return {
    pause(delayMs) { pausedUntil = Math.max(pausedUntil, now() + Math.max(0, delayMs)); },
    beforeRequest() {
      const slot = tail.then(async () => {
        while (true) {
          const delay = Math.max(nextStart, pausedUntil) - now();
          if (delay > 60000) throw new LookupError("API pausada pelo fornecedor. Tente novamente apos o prazo informado.", {
            errorCode: "api_cooldown", retryable: false, retryAfterMs: delay
          });
          if (delay <= 0) break;
          await wait(delay);
        }
        nextStart = now() + intervalMs;
      });
      tail = slot.catch(() => {});
      return slot;
    }
  };
}

const apiRequestQueue = createApiQueue();
module.exports = { createApiQueue, apiRequestQueue };
