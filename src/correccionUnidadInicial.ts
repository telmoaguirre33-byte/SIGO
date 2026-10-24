/** Contrato de corrección inicial: cambia la etiqueta, nunca convierte valores. */
export class ErrorVistaPrevia extends Error {}
export const PRECISION_UNIDAD = Object.freeze({ unidad: 0, g: 0, ml: 0, docena: 0, caja: 0, bolsa: 0, paquete: 0, rollo: 0, bandeja: 0, atado: 0, cm: 1, kg: 3, l: 3, m: 3, m2: 3, m3: 3 });
export type Unidad = keyof typeof PRECISION_UNIDAD;
export const UNIDADES = Object.freeze(Object.keys(PRECISION_UNIDAD) as Unidad[]);
export const esUnidadSoportada = (value: unknown): value is Unidad => typeof value === 'string' && Object.hasOwn(PRECISION_UNIDAD, value);
export const CAMPOS = ['stock_actual', 'stock_minimo', 'stock_maximo', 'precio_venta', 'costo_actual', 'costo_ultima_compra'] as const;
export type Campo = typeof CAMPOS[number];
export const NOMBRES_CAMPOS: Record<Campo, string> = { stock_actual: 'Stock actual', stock_minimo: 'Stock mínimo', stock_maximo: 'Stock máximo', precio_venta: 'Precio de venta', costo_actual: 'Costo actual', costo_ultima_compra: 'Costo de última compra' };
export type Alcance = Readonly<{ empresaId: string; productoId: string }>;
export type Valores = Readonly<Record<Campo, string | number | null>>;
export type VistaPrevia = Alcance & Readonly<{
  nombre: string; unidad: Unidad; unidadDestino: Unidad; revision: string; elegible: true;
  /** Snapshot opaco exacto devuelto por RPC; nunca reconstruir con datos del formulario. */
  snapshot: string; valores: Valores;
}>;
export const CONFIRMACION = 'Confirmo que fue un error de carga inicial sin movimientos: los seis valores ya corresponden a la unidad de destino. No quiero convertir ni modificar ningún número.';
export const textoConfirmacion = (destino: Unidad) => `Confirmo que fue un error de carga inicial sin movimientos: stock actual, stock mínimo y stock máximo ya estaban expresados en ${destino}, y precio de venta, costo actual y costo de última compra ya eran por ${destino}. No quiero convertir ni modificar ningún número.`;
export type Intento = Readonly<{
  requestId: string; preview: VistaPrevia; destino: Unidad; confirmacion: typeof CONFIRMACION;
}>;
export type Resultado = (Alcance & { estado: 'aplicado'; requestId: string; snapshot: string; unidad: Unidad; revision: string; valores: Valores })
  | { estado: 'rechazado'; mensaje: string };
export type Fase = 'idle' | 'loading' | 'ready' | 'saving' | 'uncertain' | 'error' | 'success' | 'invalidated';
export type Estado = Readonly<{ fase: Fase; destino?: Unidad; preview?: VistaPrevia; confirmado: boolean; mensaje?: string }>;
export type Dependencias = {
  alcanceActual: () => Alcance;
  preview: (alcance: Alcance, destino: Unidad) => Promise<VistaPrevia>;
  /** Rechazado sólo si el servidor confirma que NO se aplicó. Red/timeouts => throw. */
  commit: (intento: Intento) => Promise<Resultado>;
  uuid?: () => string;
  persistencia?: { leer: () => { intento: Intento; expirado: boolean } | null; guardar: (intento: Intento) => void; resolver: () => void };
};
const mismo = (a: Alcance, b: Alcance) => a.empresaId === b.empresaId && a.productoId === b.productoId;
const esRevision = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const esRequestId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
/** Validación decimal exacta, sin multiplicar floats, redondear ni reformatear. */
export function validarValoresEnDestino(valores: Valores, destino: Unidad) {
  if (!esUnidadSoportada(destino) || !valores || typeof valores !== 'object' || Array.isArray(valores)) throw new ErrorVistaPrevia('No se pudieron verificar los valores y la unidad de destino.');
  for (const campo of CAMPOS) {
    const value = valores[campo];
    if (campo === 'stock_maximo' && value === null) continue;
    if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || (Number.isInteger(value) && !Number.isSafeInteger(value))))
      || !/^\d+(\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) throw new ErrorVistaPrevia(`No se pudo verificar ${NOMBRES_CAMPOS[campo].toLowerCase()}.`);
    const cantidad = campo.startsWith('stock_');
    const precision = cantidad ? PRECISION_UNIDAD[destino] : campo === 'precio_venta' ? 2 : 4;
    const decimales = String(value).split('.')[1] ?? '';
    if (/[1-9]/.test(decimales.slice(precision))) {
      const regla = precision === 0 ? 'requiere cantidades enteras' : `admite hasta ${precision} decimales`;
      throw new ErrorVistaPrevia(`${NOMBRES_CAMPOS[campo]} (${value}) no es representable ${cantidad ? `en ${destino}, que ${regla}` : `con la precisión permitida de ${precision} decimales`}. Esta corrección no convierte, redondea ni fuerza una equivalencia 1:1. Revisá la carga inicial antes de continuar.`);
    }
  }
}
export function validarPreview(preview: VistaPrevia, alcance: Alcance, destino: Unidad): VistaPrevia {
  if (!preview || !mismo(preview, alcance) || !esUnidadSoportada(preview.unidad) || !esUnidadSoportada(destino)
    || preview.unidadDestino !== destino || preview.unidad === destino || !esRevision(preview.revision) || preview.elegible !== true
    || typeof preview.nombre !== 'string' || !preview.nombre.trim() || typeof preview.snapshot !== 'string' || !preview.snapshot)
    throw new ErrorVistaPrevia('Vista previa inválida, desactualizada o producto no elegible para ese destino.');
  validarValoresEnDestino(preview.valores, destino);
  return Object.freeze({ ...preview, valores: Object.freeze({ ...preview.valores }) });
}
export function validarIntento(intento: Intento, alcance: Alcance): Intento {
  if (!intento || !esRequestId(intento.requestId) || !esUnidadSoportada(intento.destino) || intento.confirmacion !== CONFIRMACION) throw Error('Intento pendiente inválido; no borrar');
  return Object.freeze({ ...intento, preview: validarPreview(intento.preview, alcance, intento.destino) });
}
export function reciboCoincide(result: Extract<Resultado, { estado: 'aplicado' }>, sent: Intento): boolean {
  return mismo(result, sent.preview) && result.requestId === sent.requestId && result.snapshot === sent.preview.snapshot
    && result.unidad === sent.destino && esRevision(result.revision) && BigInt(result.revision) === BigInt(sent.preview.revision) + 1n
    && !!result.valores && CAMPOS.every(campo => result.valores[campo] === sent.preview.valores[campo]);
}
/** Instancia por empresa/producto; conservar mientras haya resultado incierto. Sin reintentos automáticos. */
export function crearCorreccionUnidadInicial(alcance: Alcance, deps: Dependencias) {
  const target = Object.freeze({ ...alcance });
  let state: Estado = Object.freeze({ fase: 'idle', confirmado: false });
  let attempt: Intento | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const set = (next: Estado) => { state = Object.freeze(next); listeners.forEach(fn => fn()); };
  try {
    const saved = deps.persistencia?.leer();
    if (saved) {
      attempt = validarIntento(saved.intento, target);
      state = Object.freeze({ fase: 'uncertain', destino: attempt.destino, preview: attempt.preview, confirmado: false, mensaje: saved.expirado ? 'Hay una solicitud pendiente vencida. Se conserva su identificador: recuperá su resultado sin crear otra.' : 'Hay una solicitud pendiente. Recuperá su resultado con el mismo identificador antes de intentar otra corrección.' });
    }
  } catch { state = Object.freeze({ fase: 'invalidated', confirmado: false, mensaje: 'Hay un registro de recuperación incompatible o no verificable, posiblemente de una versión anterior. No se borrará ni se enviará una nueva corrección. Conservá los datos y revisá la recuperación.' }); }
  const vigente = () => mismo(target, deps.alcanceActual());
  const invalidar = () => { generation++; set({ ...state, fase: 'invalidated', confirmado: false, mensaje: 'Cambió la empresa, el usuario o el producto. No se enviará otra solicitud desde esta pantalla.' }); };
  const check = () => { if (!vigente()) { invalidar(); return false; } return state.fase !== 'invalidated'; };
  function seleccionarDestino(destino: string) {
    if (!check() || !['idle', 'error', 'ready', 'loading'].includes(state.fase)) return;
    generation++; attempt = undefined;
    if (!esUnidadSoportada(destino)) { set({ fase: 'idle', confirmado: false }); return; }
    set({ fase: 'idle', destino, confirmado: false });
  }
  async function cargar() {
    if (!check() || !['idle', 'error', 'ready'].includes(state.fase)) return;
    const destino = state.destino;
    if (!destino) { set({ fase: 'error', confirmado: false, mensaje: 'Elegí primero la unidad de destino.' }); return; }
    const id = ++generation;
    attempt = undefined;
    set({ fase: 'loading', destino, confirmado: false });
    try {
      const preview = validarPreview(await deps.preview(target, destino), target, destino);
      if (!check() || id !== generation) return;
      set({ fase: 'ready', destino, confirmado: false, preview });
    } catch (error) {
      if (!check() || id !== generation) return;
      set({ fase: 'error', destino, confirmado: false, mensaje: error instanceof ErrorVistaPrevia ? error.message : 'No se pudo verificar la elegibilidad. No se realizó ningún cambio.' });
    }
  }
  async function enviar(reintento: boolean) {
    if (!check()) return;
    if (reintento ? state.fase !== 'uncertain' || !attempt : state.fase !== 'ready' || !state.confirmado || !state.preview) return;
    if (!reintento) {
      let requestId = '';
      try { requestId = (deps.uuid ?? (() => crypto.randomUUID()))(); } catch { /* Fallar cerrado si no hay generador UUID seguro. */ }
      if (!esRequestId(requestId)) { set({ ...state, fase: 'error', confirmado: false, mensaje: 'No se pudo preparar un identificador seguro. No se realizó ningún cambio.' }); return; }
      attempt = Object.freeze({ requestId, preview: state.preview!, destino: state.preview!.unidadDestino, confirmacion: CONFIRMACION });
    }
    const sent = attempt!;
    try { deps.persistencia?.guardar(sent); } catch {
      set({ ...state, fase: reintento ? 'uncertain' : 'error', confirmado: false, mensaje: 'No se pudo guardar de forma segura la solicitud. No se envió ningún nuevo cambio. Conservá esta pantalla para recuperar el intento.' }); return;
    }
    const id = ++generation;
    set({ ...state, fase: 'saving' }); // antes del await: bloqueo sincrónico de doble clic
    try {
      const result = await deps.commit(sent);
      if (!check() || id !== generation) return;
      if (result.estado === 'rechazado') {
        if (reintento) { set({ ...state, fase: 'uncertain', mensaje: 'No se pudo recuperar el resultado anterior. ' + result.mensaje }); return; }
        try { deps.persistencia?.resolver(); } catch { set({ ...state, fase: 'invalidated', confirmado: false, mensaje: 'El servidor rechazó el cambio, pero no se pudo cerrar el registro local. Revisá la recuperación antes de crear otra solicitud.' }); return; }
        attempt = undefined;
        set({ ...state, fase: 'error', confirmado: false, mensaje: result.mensaje || 'El servidor rechazó la corrección. Actualizá la vista previa.' });
      } else if (result.estado === 'aplicado' && reciboCoincide(result, sent)) {
        let aviso = '';
        try { deps.persistencia?.resolver(); } catch { aviso = ' No se pudo limpiar el registro local; si reaparece, recuperá el mismo resultado.'; }
        set({ ...state, fase: 'success', confirmado: false, mensaje: `Unidad corregida de ${sent.preview.unidad} a ${sent.destino}. No se modificó ninguno de los seis valores.` + aviso });
      } else throw new Error('Recibo no verificable');
    } catch {
      if (!check() || id !== generation) return;
      set({ ...state, fase: 'uncertain', mensaje: 'No pudimos confirmar el resultado. La corrección puede haberse aplicado. Reintentá la misma solicitud para recuperar su resultado; no crees otra.' });
    }
  }
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    seleccionarDestino, cargar,
    confirmar: (value: boolean) => { if (check() && state.fase === 'ready') set({ ...state, confirmado: value === true }); },
    guardar: () => enviar(false), reintentar: () => enviar(true), verificarAlcance: check,
    /** Sólo para recuperación segura; nunca inventar otro intento al recuperar. */
    getIntentoPendiente: () => state.fase === 'saving' || state.fase === 'uncertain' || state.fase === 'invalidated' ? attempt : undefined,
  };
}
export type ControladorCorreccion = ReturnType<typeof crearCorreccionUnidadInicial>;
