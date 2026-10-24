import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { CAMPOS, CONFIRMACION, type Campo, type ControladorCorreccion } from './correccionUnidadInicial';
const LABELS: Record<Campo, string> = {
  stock_actual: 'Stock actual (kg)', stock_minimo: 'Stock mínimo (kg)', stock_maximo: 'Stock máximo (kg)',
  precio_venta: 'Precio de venta por kg', costo_actual: 'Costo actual por kg', costo_ultima_compra: 'Costo última compra por kg',
};
/** Montar fuera del form Productos. El host conserva controller hasta resolver incertidumbre. */
export default function DialogoCorreccionUnidadInicial({ controller, onClose }: {
  controller: ControladorCorreccion; onClose: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  const bloqueado = state.fase === 'saving' || state.fase === 'uncertain';
  useEffect(() => { ref.current?.showModal(); if (controller.getState().fase === 'idle') void controller.cargar(); }, [controller]);
  return <dialog ref={ref} className="modal" aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); if (!bloqueado) onClose(); }}>
    <h2 id={title}>Corregir error de carga inicial: unidad → kg</h2>
    <p id={description}>Sólo para un producto sin movimientos cuyos números ya significaban kilogramos. No convierte unidades ni modifica cantidades, precio o costos. El servidor volverá a verificar que no exista historial al guardar.</p>
    {state.preview && <>
      <h3>{state.preview.nombre}</h3>
      <dl>{CAMPOS.map(campo => <div key={campo}><dt>{LABELS[campo]}</dt><dd>{state.preview!.valores[campo] === null ? 'Sin valor (se conserva)' : String(state.preview!.valores[campo])}</dd></div>)}</dl>
    </>}
    {state.fase === 'loading' && <p role="status">Verificando producto e historial…</p>}
    {state.fase === 'saving' && <p role="status">Guardando y verificando el resultado…</p>}
    {state.mensaje && <p role={state.fase === 'success' ? 'status' : 'alert'}>{state.mensaje}</p>}
    {state.fase === 'ready' && <label><input type="checkbox" checked={state.confirmado} onChange={e => controller.confirmar(e.target.checked)} />{CONFIRMACION}</label>}
    <div className="form-actions">
      <button type="button" onClick={onClose} disabled={bloqueado}>{state.fase === 'success' ? 'Listo' : 'Cerrar'}</button>
      {state.fase === 'error' && <button type="button" onClick={() => void controller.cargar()}>Volver a verificar</button>}
      {state.fase === 'ready' && <button type="button" disabled={!state.confirmado} onClick={() => void controller.guardar()}>Corregir solamente la unidad a kg</button>}
      {state.fase === 'uncertain' && <button type="button" onClick={() => void controller.reintentar()}>Recuperar resultado con la misma solicitud</button>}
    </div>
  </dialog>;
}
