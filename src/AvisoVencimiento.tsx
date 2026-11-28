import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function AvisoVencimiento({ empresaId }: { empresaId: string }) {
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    let consulta: AbortController | undefined;
    function actualizar() {
      if (document.visibilityState !== "visible") return;
      consulta?.abort();
      const actual = new AbortController();
      consulta = actual;
      void supabase.rpc("sigo_aviso_vencimiento", { p_empresa_id: empresaId })
        .abortSignal(actual.signal).then(({ data, error }) => {
          if (!actual.signal.aborted && !error) setVencida(data === true);
        }, () => {});
    }
    actualizar();
    document.addEventListener("visibilitychange", actualizar);
    const intervalo = window.setInterval(actualizar, 60_000);
    return () => {
      consulta?.abort();
      document.removeEventListener("visibilitychange", actualizar);
      window.clearInterval(intervalo);
    };
  }, [empresaId]);

  return vencida ? <p className="sigo-aviso-vencimiento" role="status">Tu cuenta está vencida. Por favor, regularizá tu pago</p> : null;
}
