import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { FormatoFiscal } from "./ticketFiscal";
export function formatoFiscalValido(value: unknown): FormatoFiscal { return value === "80" || value === "a4" ? value : "58"; }
export function claveFormatoFiscal(usuario: string, empresa: string) { return `sigo:formato-fiscal:v1:${encodeURIComponent(usuario)}:${encodeURIComponent(empresa)}`; }
// Only a presentation preference is persisted. Never credentials or receipt contents.
export function useFormatoFiscal(empresaId: string) {
  const [preferencia, setPreferencia] = useState<{ empresa: string; usuario: string; formato: FormatoFiscal } | null>(null);
  useEffect(() => {
    let activo = true, revision = 0, usuarioActual: string | undefined;
    function cargar(usuario?: string) {
      if (!activo) return;
      usuarioActual = usuario;
      let formato: FormatoFiscal = "58";
      if (usuario) try { formato = formatoFiscalValido(localStorage.getItem(claveFormatoFiscal(usuario, empresaId))); } catch { /* storage is optional */ }
      setPreferencia(usuario ? { empresa: empresaId, usuario, formato } : null);
    }
    const sincronizar = () => cargar(usuarioActual);
    window.addEventListener("storage", sincronizar);
    window.addEventListener("sigo:formato-fiscal", sincronizar);
    const inicial = revision;
    void supabase.auth.getSession().then(({ data }) => { if (revision === inicial) cargar(data.session?.user?.id); }).catch(() => { if (revision === inicial) cargar(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { revision++; cargar(session?.user?.id); });
    return () => { activo = false; subscription.unsubscribe(); window.removeEventListener("storage", sincronizar); window.removeEventListener("sigo:formato-fiscal", sincronizar); };
  }, [empresaId]);
  const actual = preferencia?.empresa === empresaId ? preferencia : null;
  function cambiar(value: unknown) {
    const formato = formatoFiscalValido(value);
    if (!actual) return;
    try { localStorage.setItem(claveFormatoFiscal(actual.usuario, empresaId), formato); } catch { /* retain in memory when unavailable */ }
    window.dispatchEvent(new Event("sigo:formato-fiscal"));
    setPreferencia({ ...actual, formato });
  }
  return { formato: actual?.formato || "58" as FormatoFiscal, cambiar, listo: Boolean(actual) };
}
