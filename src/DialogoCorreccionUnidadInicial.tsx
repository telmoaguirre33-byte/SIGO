import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { CAMPOS, NOMBRES_CAMPOS, PRECISION_UNIDAD, UNIDADES, textoConfirmacion, type ControladorCorreccion } from './correccionUnidadInicial';
/** Montar fuera del form Productos. El host conserva controller hasta resolver incertidumbre. */
export default function DialogoCorreccionUnidadInicial({ controller, onClose }: {
  controller: ControladorCorreccion; onClose: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  const destinationId = useId();
  const bloqueado = state.fase === 'saving' || state.fase === 'uncertain';
  const seleccionable = ['idle', 'loading', 'ready', 'error'].includes(state.fase);
  useEffect(() => { ref.current?.showModal(); }, [controller]);
  return <dialog ref={ref} className="modal" aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); if (!bloqueado) onClose(); }}>
    <h2 id={title}>Corregir unidad de carga inicial{state.preview ? `: ${state.preview.unidad} → ${state.preview.unidadDestino}` : ''}</h2>
    <p id={description}>Sólo para un producto sin movimientos cuyos seis valores ya correspondían a la unidad de destino. No convierte unidades ni modifica cantidades, precio o costos. El servidor vuelve a verificar el historial al guardar. La conversión de productos con historial no está disponible en esta etapa.</p>
    <label htmlFor={destinationId}>Unidad de destino</label>
    <select id={destinationId} value={state.destino ?? ''} disabled={!seleccionable} onChange={event => controller.seleccionarDestino(event.target.value)}>
      <option value="">Elegí una unidad</option>
      {UNIDADES.map(unidad => <option key={unidad} value={unidad}>{unidad}</option>)}
    </select>
    {state.destino && <p>{PRECISION_UNIDAD[state.destino] === 0 ? `${state.destino} requiere cantidades enteras.` : `${state.destino} admite hasta ${PRECISION_UNIDAD[state.destino]} decimales en cantidades.`} No se redondeará ni se forzará una equivalencia 1:1.</p>}
    {state.preview && <>
      <h3>{state.preview.nombre}</h3>
      <p>Unidad actual: {state.preview.unidad}. Destino: {state.preview.unidadDestino}. Revisión verificada: {state.preview.revision}.</p>
      <p>Estos seis valores se conservan exactamente. Confirmá que ya significan lo indicado:</p>
      <dl>{CAMPOS.map(campo => <div key={campo}><dt>{NOMBRES_CAMPOS[campo]} {campo.startsWith('stock_') ? `(${state.preview!.unidadDestino})` : `por ${state.preview!.unidadDestino}`}</dt><dd>{state.preview!.valores[campo] === null ? 'Sin valor (se conserva)' : String(state.preview!.valores[campo])}</dd></div>)}</dl>
    </>}
    {state.fase === 'loading' && <p role="status">Verificando producto, valores e historial…</p>}
    {state.fase === 'saving' && <p role="status">Guardando y verificando el resultado…</p>}
    {state.mensaje && <p role={state.fase === 'success' ? 'status' : 'alert'}>{state.mensaje}</p>}
    {state.fase === 'ready' && state.destino && <label><input type="checkbox" checked={state.confirmado} onChange={e => controller.confirmar(e.target.checked)} />{textoConfirmacion(state.destino)}</label>}
    <div className="form-actions">
      <button type="button" onClick={onClose} disabled={bloqueado}>{state.fase === 'success' ? 'Listo' : 'Cerrar'}</button>
      {(state.fase === 'idle' || state.fase === 'error') && <button type="button" disabled={!state.destino} onClick={() => void controller.cargar()}>{state.fase === 'error' ? 'Volver a verificar' : 'Verificar valores e historial'}</button>}
      {state.fase === 'ready' && <button type="button" disabled={!state.confirmado} onClick={() => void controller.guardar()}>Corregir solamente la unidad a {state.destino}</button>}
      {state.fase === 'uncertain' && <button type="button" onClick={() => void controller.reintentar()}>Recuperar resultado con la misma solicitud</button>}
    </div>
  </dialog>;
}
