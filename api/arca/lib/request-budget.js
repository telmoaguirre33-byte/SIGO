// A bounded request must finish before Vercel's unchanged 30-second limit.
// Each invocation owns its budget: no global mutable timer/session state.
export const FISCAL_REQUEST_BUDGET_MS = 26_000;
export const FISCAL_OPERATION_MS = 6_000;
export function esTimeoutFiscal(error) {
  return error?.code === 'ARCA_REQUEST_DEADLINE' || error?.name === 'AbortError';
}
export function crearPresupuestoFiscal({ totalMs = FISCAL_REQUEST_BUDGET_MS, now = () => performance.now() } = {}) {
  const started = now();
  const errorTimeout = (stage) => Object.assign(new Error('ARCA_REQUEST_TIMEOUT'), { code: 'ARCA_REQUEST_DEADLINE', budgetStage: stage });
  const remaining = () => Math.max(0, totalMs - (now() - started));
  return {
    remaining,
    elapsed: () => Math.max(0, Math.round(now() - started)),
    require(ms, stage) { if (remaining() < ms) throw errorTimeout(stage); },
    async run(stage, capMs, operation, reserveMs = 0) {
      const timeoutMs = Math.min(capMs, remaining() - reserveMs);
      if (timeoutMs <= 0) throw errorTimeout(stage);
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(errorTimeout(stage)); }, timeoutMs);
      });
      try {
        const result = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
        // Parsing/body consumption is part of operation; no next side effect after budget.
        if (remaining() <= reserveMs) { controller.abort(); throw errorTimeout(stage); }
        return result;
      } finally { clearTimeout(timer); }
    },
  };
}
export async function fetchFiscal(sesion, stage, url, init = {}, capMs = FISCAL_OPERATION_MS, reserveMs = 0) {
  const operation = async (signal) => {
    const response = await fetch(url, { ...init, ...(signal ? { signal } : {}) });
    const payload = await response.json().catch(error => { if (signal?.aborted) throw error; return null; });
    return { response, payload };
  };
  return sesion?.presupuesto ? sesion.presupuesto.run(stage, capMs, operation, reserveMs) : operation(init.signal);
}
