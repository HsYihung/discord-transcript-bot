/**
 * 建立序列化的速率限制器：所有工作排隊執行，兩次執行間至少間隔 minIntervalMs。
 * 用於遵守 STT API 的每分鐘請求數限制（如 Groq 免費層 20 RPM）。
 */
export function createRateLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let lastRun = 0;

  return function schedule(fn) {
    const run = chain.then(async () => {
      const wait = lastRun + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRun = Date.now();
      try {
        return await fn();
      } finally {
        lastRun = Date.now();
      }
    });
    chain = run.catch(() => {});
    return run;
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
