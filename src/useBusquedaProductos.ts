import { useEffect, useState } from "react";
import { buscarProductosSigo, type PaginaProductos } from "./productos";
import { supabase } from "./supabase";
import { errorCatalogo } from "./erroresCatalogo";

// Sin caché compartida: al cambiar empresa/consulta no se reutilizan filas ni errores.
export function useBusquedaProductos(empresaId: string, texto: string, buscarVacio = false) {
  const [pagina, setPagina] = useState({ consulta: "", numero: 0 });
  const [revision, setRevision] = useState(0);
  const consulta = JSON.stringify([empresaId, texto.trim()]);
  const numero = pagina.consulta === consulta ? pagina.numero : 0;
  const clave = JSON.stringify([consulta, numero, revision]);
  const habilitado = buscarVacio || Boolean(texto.trim());
  const [resultado, setResultado] = useState<PaginaProductos & { clave: string; error: string }>({ clave: "", productos: [], hayMas: false, error: "" });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(evento => {
      if (["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(evento)) setRevision(n => n + 1);
    });
    return () => data.subscription.unsubscribe();
  }, [empresaId]);

  useEffect(() => {
    if (!habilitado) return;
    const controller = new AbortController();
    let plazo: ReturnType<typeof setTimeout> | undefined;
    const timer = window.setTimeout(() => {
      plazo = setTimeout(() => {
        setResultado({ clave, productos: [], hayMas: false, error: errorCatalogo("timeout").message });
        controller.abort();
      }, 8000);
      void buscarProductosSigo(empresaId, texto, numero, controller.signal).then(datos => {
        clearTimeout(plazo);
        if (!controller.signal.aborted) setResultado({ ...datos, clave, error: "" });
      }).catch(error => {
        clearTimeout(plazo);
        if (!controller.signal.aborted) setResultado({ clave, productos: [], hayMas: false, error: errorCatalogo(error).message });
      });
    }, texto.trim() ? 180 : 0);
    return () => { clearTimeout(timer); clearTimeout(plazo); controller.abort(); };
  }, [empresaId, texto, numero, revision, clave, habilitado]);

  const vigente = resultado.clave === clave && habilitado;
  return {
    productos: vigente ? resultado.productos : [],
    hayMas: vigente && resultado.hayMas,
    error: vigente ? resultado.error : "",
    loading: habilitado && !vigente,
    pagina: numero,
    irPagina: (n: number) => setPagina({ consulta, numero: Math.max(0, n) }),
    refrescar: () => setRevision(n => n + 1),
  };
}
