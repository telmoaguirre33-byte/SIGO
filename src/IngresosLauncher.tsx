import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import IngresosDiariosOperativos from "./IngresosDiariosOperativos";
import { supabase } from "./supabase";
import {
  cargarMisEmpresas,
  leerEmpresaActivaGuardada,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";

type Host = HTMLElement | null;

export default function IngresosLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [host, setHost] = useState<Host>(null);
  const [open, setOpen] = useState(false);

  const cargarEmpresa = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setEmpresa(null);
        return null;
      }
      const empresas = await cargarMisEmpresas();
      const preferida = leerEmpresaActivaGuardada(data.user.id);
      const activa = resolverEmpresaActiva(empresas, preferida, data.user.id);
      setEmpresa(activa);
      return activa;
    } catch {
      setEmpresa(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void cargarEmpresa();
    const refrescar = () => { if (document.visibilityState === "visible") void cargarEmpresa(); };
    document.addEventListener("visibilitychange", refrescar);
    return () => document.removeEventListener("visibilitychange", refrescar);
  }, [cargarEmpresa]);

  useEffect(() => {
    function resolverHost() {
      const encontrado = document.querySelector<HTMLElement>(".sigo-report-catalog");
      setHost((actual) => actual === encontrado ? actual : encontrado);
      if (!encontrado) setOpen(false);
    }

    resolverHost();
    const observer = new MutationObserver(resolverHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function abrir() {
    const activa = await cargarEmpresa();
    if (activa) setOpen(true);
  }

  if (!empresa || !host) return null;

  const card = (
    <button
      type="button"
      className="sigo-report-card sigo-income-launch-card highlighted"
      onClick={() => void abrir()}
      aria-haspopup="dialog"
      aria-label="Abrir informe diario de ingresos"
    >
      <span className="sigo-report-icon" aria-hidden="true">↗</span>
      <strong>Ingresos</strong>
      <span>Ventas por día, cobrado, a cobrar y total con filtros rápidos.</span>
    </button>
  );

  return (
    <>
      {createPortal(card, host)}
      {open && (
        <div className="sigo-income-overlay" role="dialog" aria-modal="true" aria-label="Ingresos por día">
          <div className="sigo-income-overlay-topbar">
            <button className="admin-button" type="button" onClick={() => setOpen(false)}>← Volver</button>
            <div>
              <strong>Ingresos</strong>
              <small>{empresa.empresa_nombre}</small>
            </div>
          </div>
          <main className="sigo-income-overlay-content">
            <IngresosDiariosOperativos empresaId={empresa.empresa_id} />
          </main>
        </div>
      )}
    </>
  );
}
