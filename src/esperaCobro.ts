export type FaseEsperaCobro = "preparacion" | "envio" | "verificacion";

export class TiempoEsperaCobroError extends Error {
  readonly fase: FaseEsperaCobro;
  constructor(fase: FaseEsperaCobro) {
    super(fase === "preparacion"
      ? "La preparación del cobro demoró demasiado. Conservamos el mismo intento para recuperarlo sin cambiar sus datos."
      : "La respuesta del cobro demoró demasiado. Su resultado debe verificarse recuperando el mismo intento; no vuelvas a cobrarlo.");
    this.name = "TiempoEsperaCobroError";
    this.fase = fase;
  }
}

// Abort cancels fetch where supported. The race also releases the caller if a
// transport ignores cancellation. Every continuation must check the signal before
// starting more work: a timeout must never turn into a later, invisible charge.
export async function esperarCobro<T>(fase: FaseEsperaCobro, ms: number, trabajo: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + ms;
  const comprobarPlazo = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    // Timers may be throttled while a mobile browser is suspended. A response
    // arriving after the deadline is late even if its timer has not fired yet.
    if (Date.now() >= deadline) {
      const error = new TiempoEsperaCobroError(fase);
      controller.abort(error);
      throw error;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new TiempoEsperaCobroError(fase);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    const operacion = Promise.resolve().then(async () => {
      comprobarPlazo();
      const resultado = await trabajo(controller.signal);
      comprobarPlazo();
      return resultado;
    });
    const resultado = await Promise.race([operacion, vencimiento]);
    comprobarPlazo();
    return resultado;
  } finally {
    clearTimeout(timer);
  }
}
