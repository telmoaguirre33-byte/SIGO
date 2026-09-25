import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { verificarCompraSigo, type VerificacionCompraSigo } from "./compras";
import { construirCompraIA, errorGuardadoCompraIA, type GuardarCompraIAInput } from "./guardarCompraIA";

type Props = GuardarCompraIAInput & {
  empresaId: string;
  idempotencyKey: string;
  disabled?: boolean;
  onAntesGuardar: () => void;
  onEstado: (guardando: boolean) => void;
  onError: (mensaje: string) => void;
  onPendiente: (pendiente: boolean) => void;
  onGuardada: (id: string, verificacion: VerificacionCompraSigo) => void;
};

type Resultado = {
  compra_id: string;
  items: { producto_id: string; cantidad: number; costo_unitario: number; stock_antes: number | null }[];
};

export default function GuardarCompraIA(props: Props) {
  const [guardando, setGuardando] = useState(false);
  const [pendiente, setPendiente] = useState(false);
  const envioKey = `sigo:compra-ia:envio:${props.empresaId}:${props.idempotencyKey}`;
  const lock = useRef(false);
  const context = useRef({ active: true });
  useEffect(() => {
    const current = { active: true };
    context.current = current;
    lock.current = false;
    setGuardando(false);
    let hayEnvio = false;
    try { hayEnvio = Boolean(localStorage.getItem(envioKey)); } catch { /* checked again before writing */ }
    setPendiente(hayEnvio);
    props.onPendiente(hayEnvio);
    return () => { current.active = false; };
  }, [props.empresaId, props.idempotencyKey]);

  async function guardar() {
    if (lock.current || props.disabled) return;
    lock.current = true;
    const current = context.current;
    setGuardando(true);
    props.onEstado(true);
    props.onError("");
    let confirmado = false;
    try {
      const envioGuardado = localStorage.getItem(envioKey);
      const compra = envioGuardado ? JSON.parse(envioGuardado) : construirCompraIA(props);
      if (!props.empresaId || !props.idempotencyKey) throw new Error("No se pudo identificar el borrador de esta compra.");
      // Flush the draft/key before the request: refresh/retry must reuse the same key.
      props.onAntesGuardar();
      if (!envioGuardado) localStorage.setItem(envioKey, JSON.stringify(compra));
      setPendiente(true);
      props.onPendiente(true);
      const { data, error } = await supabase.rpc("guardar_compra_ia_sigo", {
        p_empresa_id: props.empresaId,
        p_idempotency_key: props.idempotencyKey,
        p_compra: compra,
      });
      if (error) {
        // A PostgreSQL error proves transaction rollback. A transport error does not.
        if (/^[0-9A-Z]{5}$/.test(error.code ?? "") && !error.message.includes("IDEMPOTENCY_CONFLICT")) {
          localStorage.removeItem(envioKey);
          if (current.active) { setPendiente(false); props.onPendiente(false); }
        }
        throw new Error(errorGuardadoCompraIA(error.message));
      }
      const resultado = data as Resultado | null;
      if (!resultado?.compra_id || !Array.isArray(resultado.items)) throw new Error("El servidor no devolvió la confirmación. Reintentá con este mismo borrador; no cargues otra compra.");
      confirmado = true;
      localStorage.removeItem(envioKey);
      if (!current.active) return;
      let verificacion: VerificacionCompraSigo = { estado: "NO_VERIFICADO", detalle: "Compra guardada. No se pudo completar la verificación posterior; no vuelvas a ingresarla." };
      try {
        verificacion = await verificarCompraSigo({
          empresaId: props.empresaId,
          compraId: resultado.compra_id,
          items: resultado.items,
          stockAntes: Object.fromEntries(resultado.items.map(i => [i.producto_id, i.stock_antes == null ? Number.NaN : Number(i.stock_antes)])),
        });
      } catch { /* A read-back failure must never undo or retry the committed write. */ }
      if (current.active) { setPendiente(false); props.onPendiente(false); props.onGuardada(resultado.compra_id, verificacion); }
    } catch (err) {
      if (current.active) props.onError(confirmado
        ? "La compra se guardó, pero no se pudo actualizar la pantalla. Revisá el historial; no vuelvas a ingresarla."
        : errorGuardadoCompraIA(err instanceof Error ? err.message : ""));
    } finally {
      if (current.active) {
        lock.current = false;
        setGuardando(false);
        props.onEstado(false);
      }
    }
  }

  return <div style={{ display: "grid", gap: 6 }}><button type="button" className="primary-button" disabled={props.disabled || guardando}
    onClick={() => void guardar()} aria-label="Confirmar compra e ingresar stock">
    {guardando ? "Confirmando compra…" : pendiente ? "✅ REINTENTAR CONFIRMACIÓN" : "✅ CONFIRMAR COMPRA E INGRESAR STOCK"}
  </button>{pendiente && !guardando && <small role="status">Hay un envío pendiente. Reintentá para recuperar su resultado sin duplicar la compra ni el stock.</small>}</div>;
}
