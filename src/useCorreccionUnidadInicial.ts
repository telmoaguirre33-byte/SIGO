import { useEffect, useRef, useState } from 'react';
import { prepararCorreccionUnidadInicial } from './prepararCorreccionUnidadInicial';
import { crearPersistenciaCorreccionUnidadInicial, type AlmacenSesion } from './persistenciaCorreccionUnidadInicial';
import type { ClienteRpc } from './adaptadorCorreccionUnidadInicial';
import type { ControladorCorreccion } from './correccionUnidadInicial';

/** Mantiene el diálogo fuera de filas/formularios; nunca reinicia intentos inciertos. */
export function useCorreccionUnidadInicial(config: {
  empresaId: string; usuarioId: string; permitido: boolean; cliente: ClienteRpc;
  storage: () => AlmacenSesion; onUpdated: () => void; onBlocked: (blocked: boolean) => void;
}) {
  const live = useRef(config); live.current = config;
  const mounted = useRef(true);
  const active = useRef<ControladorCorreccion | null>(null);
  const [controller, setController] = useState<ControladorCorreccion | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { controller?.verificarAlcance(); }, [controller, config.empresaId, config.usuarioId, config.permitido]);
  useEffect(() => {
    if (!controller) return;
    let updated = false;
    const onState = () => {
      if (controller.getState().fase === 'success' && !updated) { updated = true; live.current.onUpdated(); }
    };
    const unsubscribe = controller.subscribe(onState); onState();
    const unload = (event: BeforeUnloadEvent) => {
      if (controller.getIntentoPendiente()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => { unsubscribe(); window.removeEventListener('beforeunload', unload); };
  }, [controller]);
  function pendiente(productoId: string) {
    if (!config.usuarioId) return false;
    try { return crearPersistenciaCorreccionUnidadInicial(config.storage(), { usuarioId: config.usuarioId, empresaId: config.empresaId, productoId }).tienePendiente(); }
    catch { return true; } // Abrir una corrección siempre vuelve a verificar almacenamiento y falla cerrado.
  }
  function abrir(productoId: string) {
    if (active.current || !config.permitido || !config.usuarioId) return;
    try {
      const contexto = { empresaId: config.empresaId, productoId };
      const next = prepararCorreccionUnidadInicial({ cliente: config.cliente, sessionStorage: config.storage(), usuarioId: config.usuarioId, alcance: contexto,
        contextoActual: () => ({ usuarioId: mounted.current && live.current.permitido ? live.current.usuarioId : '', empresaId: live.current.empresaId, productoId }),
      });
      active.current = next; setController(next); setError(''); config.onBlocked(true);
    } catch { setError('No se pudo preparar la recuperación segura. No se envió ningún cambio. Revisá el almacenamiento de esta pestaña.'); }
  }
  function cerrar() {
    const current = active.current;
    if (current && ['saving', 'uncertain'].includes(current.getState().fase)) return;
    active.current = null; setController(null); config.onBlocked(false);
  }
  return { controller, error, abrir, cerrar, pendiente };
}

