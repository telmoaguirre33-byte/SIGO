import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import DevolucionesOperativas from "./DevolucionesOperativas";
import { supabase } from "./supabase";
import {
  cargarMisEmpresas,
  leerEmpresaActivaGuardada,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";

function puedeGestionar(empresa: EmpresaOperativa | null) {
  return empresa?.rol === "owner" || empresa?.rol === "admin" || empresa?.rol === "seller";
}

type Host = { element: HTMLElement; kind: "sidebar" | "context" } | null;

export default function DevolucionesLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Host>(null);

  const cargarEmpresa = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return setEmpresa(null);
      const empresas = await cargarMisEmpresas();
      const activa = resolverEmpresaActiva(empresas, leerEmpresaActivaGuardada(data.user.id), data.user.id);
      setEmpresa(puedeGestionar(activa) ? activa : null);
    } catch {
      setEmpresa(null);
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
      const sidebar = document.querySelector<HTMLElement>(".sigo-operation-only .sidebar .menu");
      if (sidebar) {
        setHost((actual) => actual?.element === sidebar ? actual : { element: sidebar, kind: "sidebar" });
        return;
      }
      const contexto = document.querySelector<HTMLElement>(".sigo-context-actions");
      if (contexto) {
        setHost((actual) => actual?.element === contexto ? actual : { element: contexto, kind: "context" });
        return;
      }
      setHost(null);
    }
    resolverHost();
    const observer = new MutationObserver(resolverHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!empresa) return null;

  const boton = host?.kind === "sidebar" ? (
    <button className="menu-item sigo-returns-menu-item" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span className="menu-icon" aria-hidden="true">↩</span>
      <span>Devoluciones</span>
    </button>
  ) : (
    <button className="admin-button sigo-returns-context-button" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      ↩ Devoluciones
    </button>
  );

  return (
    <>
      {host ? createPortal(boton, host.element) : null}
      {open && (
        <div className="sigo-cart-overlay" role="dialog" aria-modal="true" aria-label="Devoluciones y anulaciones">
          <div className="sigo-cart-topbar">
            <button className="admin-button" type="button" onClick={() => setOpen(false)}>← Volver</button>
            <div>
              <strong>↩ Devoluciones y anulaciones</strong>
              <small>{empresa.empresa_nombre}</small>
            </div>
          </div>
          <main className="sigo-cart-content">
            <DevolucionesOperativas key={empresa.empresa_id} empresaId={empresa.empresa_id} />
          </main>
        </div>
      )}
    </>
  );
}
