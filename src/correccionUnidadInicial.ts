/** Contrato de UI. El adaptador RPC debe validar datos y recibos del servidor. */
export class ErrorVistaPrevia extends Error {}
export const CAMPOS = ['stock_actual', 'stock_minimo', 'stock_maximo', 'precio_venta', 'costo_actual', 'costo_ultima_compra'] as const;
export type Campo = typeof CAMPOS[number];
export type Alcance = Readonly<{ empresaId: string; productoId: string }>;
export type Valores = Readonly<Record<Campo, string | number | null>>;
export type VistaPrevia = Alcance & Readonly<{
  nombre: string; unidad: 'unidad'; elegible: true;
  /** Snapshot opaco exacto devuelto por RPC; nunca reconstruir con datos del formulario. */
  snapshot: string; valores: Valores;
}>;
export const CONFIRMACION = 'Confirmo que fue un error de carga inicial: stock actual, mínimo y máximo ya estaban expresados en kilogramos, y precio y costos ya eran por kilogramo. No quiero convertir ni modificar ningún número.';
export type Intento = Readonly<{
  requestId: string; preview: VistaPrevia; destino: 'kg'; confirmacion: typeof CONFIRMACION;
}>;
export type Resultado = { estado: 'aplicado'; empresaId: string; productoId: string; requestId: string; snapshot: string; unidad: 'kg' }
  | { estado: 'rechazado'; mensaje: string };
export type Fase = 'idle' | 'loading' | 'ready' | 'saving' | 'uncertain' | 'error' | 'success' | 'invalidated';
export type Estado = Readonly<{ fase: Fase; preview?: VistaPrevia; confirmado: boolean; mensaje?: string }>;
export type Dependencias = {
  alcanceActual: () => Alcance;
  preview: (alcance: Alcance) => Promise<VistaPrevia>;
  /** Rechazado sólo si el servidor confirma que NO se aplicó. Red/timeouts => throw. */
  commit: (intento: Intento) => Promise<Resultado>;
  uuid?: () => string;
  persistencia?: { leer: () => { intento: Intento; expirado: boolean } | null; guardar: (intento: Intento) => void; resolver: () => void }; 
};
const mismo = (a: Alcance, b: Alcance) => a.empresaId === b.empresaId && a.productoId === b.productoId;
export function validarPreview(preview: VistaPrevia, alcance: Alcance): VistaPrevia {
  if (!preview || !mismo(preview, alcance) || preview.unidad !== 'unidad' || preview.elegible !== true
    || typeof preview.nombre !== 'string' || !preview.nombre.trim() || typeof preview.snapshot !== 'string' || !preview.snapshot
    || !preview.valores) throw new Error('Vista previa inválida o producto no elegible.');
  for (const campo of CAMPOS) {
    const v = preview.valores[campo];
    if (v === null && campo === 'stock_maximo') continue;
    if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v))
      || !Number.isFinite(Number(v)) || Number(v) < 0) throw new Error('No se pudieron verificar todos los valores.');
  }
  return Object.freeze({ ...preview, valores: Object.freeze({ ...preview.valores }) });
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
      validarPreview(saved.intento.preview, target);
      if (saved.intento.destino !== 'kg' || saved.intento.confirmacion !== CONFIRMACION || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.intento.requestId)) throw Error('Intento inválido');
      attempt = Object.freeze({ ...saved.intento, preview: validarPreview(saved.intento.preview, target) });
      state = Object.freeze({ fase: 'uncertain', preview: attempt.preview, confirmado: false, mensaje: saved.expirado ? 'Hay una solicitud pendiente vencida. Se conserva su identificador: recuperá su resultado sin crear otra.' : 'Hay una solicitud pendiente. Recuperá su resultado con el mismo identificador antes de intentar otra corrección.' });
    }
  } catch { state = Object.freeze({ fase: 'invalidated', confirmado: false, mensaje: 'No se pudo leer de forma segura la solicitud pendiente. No se enviará una nueva corrección. Conservá los datos y revisá la recuperación.' }); }
  const vigente = () => mismo(target, deps.alcanceActual());
  const invalidar = () => { generation++; set({ fase: 'invalidated', confirmado: false, mensaje: 'Cambió la empresa o el producto. No se enviará otra solicitud desde esta pantalla.' }); };
  const check = () => { if (!vigente()) { invalidar(); return false; } return state.fase !== 'invalidated'; };
  async function cargar() {
    if (!check() || !['idle', 'error', 'ready'].includes(state.fase)) return;
    const id = ++generation;
    attempt = undefined;
    set({ fase: 'loading', confirmado: false });
    try {
      const preview = validarPreview(await deps.preview(target), target);
      if (!check() || id !== generation) return;
      set({ fase: 'ready', confirmado: false, preview });
    } catch (error) {
      if (!check() || id !== generation) return;
      set({ fase: 'error', confirmado: false, mensaje: error instanceof ErrorVistaPrevia ? error.message : 'No se pudo verificar la elegibilidad. No se realizó ningún cambio.' });
    }
  }
  async function enviar(reintento: boolean) {
    if (!check()) return;
    if (reintento ? state.fase !== 'uncertain' || !attempt : state.fase !== 'ready' || !state.confirmado || !state.preview) return;
    if (!reintento) {
      let requestId = '';
      try { requestId = (deps.uuid ?? (() => crypto.randomUUID()))(); } catch { /* Fallar cerrado si no hay generador UUID seguro. */ }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        set({ ...state, fase: 'error', confirmado: false, mensaje: 'No se pudo preparar un identificador seguro. No se realizó ningún cambio.' }); return;
      }
      attempt = Object.freeze({ requestId, preview: state.preview!, destino: 'kg', confirmacion: CONFIRMACION });
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
      } else if (result.estado === 'aplicado' && mismo(result, target) && result.requestId === sent.requestId
        && result.snapshot === sent.preview.snapshot && result.unidad === 'kg') {
        let aviso = '';
        try { deps.persistencia?.resolver(); } catch { aviso = ' No se pudo limpiar el registro local; si reaparece, recuperá el mismo resultado.'; }
        set({ ...state, fase: 'success', confirmado: false, mensaje: 'Unidad corregida a kg. No se modificaron los números.' + aviso });
      } else throw new Error('Recibo no verificable');
    } catch {
      if (!check() || id !== generation) return;
      set({ ...state, fase: 'uncertain', mensaje: 'No pudimos confirmar el resultado. La corrección puede haberse aplicado. Reintentá la misma solicitud para recuperar su resultado; no crees otra.' });
    }
  }
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cargar,
    confirmar: (value: boolean) => { if (check() && state.fase === 'ready') set({ ...state, confirmado: value === true }); },
    guardar: () => enviar(false),
    reintentar: () => enviar(true),
    verificarAlcance: check,
    /** Sólo para persistencia segura/diagnóstico del host; nunca inventar otro intento al recuperar. */
    getIntentoPendiente: () => state.fase === 'saving' || state.fase === 'uncertain' || state.fase === 'invalidated' ? attempt : undefined,
  };
}
export type ControladorCorreccion = ReturnType<typeof crearCorreccionUnidadInicial>;
