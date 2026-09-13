import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ConfiguracionOperativa from "./ConfiguracionOperativa";
import { supabase } from "./supabase";
import {
  cargarMisEmpresas,
  leerEmpresaActivaGuardada,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";

function puedeConfigurar(empresa: EmpresaOperativa | null) {
  return empresa?.rol === "owner" || empresa?.rol === "admin";
}

type NavHost = {
  element: HTMLElement;
  kind: "sidebar" | "context";
};

export default function ConfiguracionLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [open, setOpen] = useState(false);
  const [navHost, setNavHost] = useState<NavHost | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setEmpresa(null);
        return null;
      }
      const empresas = await cargarMisEmpresas();
      const preferida = leerEmpresaActivaGuardada(data.user.id);
      const activa = resolverEmpresaActiva(empresas, preferida, data.user.id);
      setEmpresa(puedeConfigurar(activa) ? activa : null);
      return puedeConfigurar(activa) ? activa : null;
    } catch {
      setEmpresa(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void cargar();
    const refrescar = () => { if (document.visibilityState === "visible") void cargar(); };
    document.addEventListener("visibilitychange", refrescar);
    return () => document.removeEventListener("visibilitychange", refrescar);
  }, [cargar]);

  useEffect(() => {
    function resolverHost() {
      const sidebar = document.querySelector<HTMLElement>(".sigo-operation-only .sidebar .menu");
      if (sidebar) {
        setNavHost((actual) => actual?.element === sidebar && actual.kind === "sidebar" ? actual : { element: sidebar, kind: "sidebar" });
        return;
      }

      const contexto = document.querySelector<HTMLElement>(".sigo-context-actions");
      if (contexto) {
        setNavHost((actual) => actual?.element === contexto && actual.kind === "context" ? actual : { element: contexto, kind: "context" });
        return;
      }
      setNavHost(null);
    }

    resolverHost();
    const observer = new MutationObserver(resolverHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function abrir() {
    const activa = await cargar();
    if (activa) setOpen(true);
  }

  if (!empresa) return null;

  const boton = navHost?.kind === "sidebar" ? (
    <button
      className="menu-item sigo-settings-menu-item"
      type="button"
      onClick={() => void abrir()}
      aria-label="Abrir Configuración"
      aria-haspopup="dialog"
    >
      <span className="menu-icon" aria-hidden="true">CF</span>
      <span>Configuración</span>
    </button>
  ) : (
    <button
      className="admin-button sigo-settings-context-button"
      type="button"
      onClick={() => void abrir()}
      aria-label="Abrir Configuración"
      aria-haspopup="dialog"
    >
      Configuración
    </button>
  );

  return (
    <>
      {navHost ? createPortal(boton, navHost.element) : null}

      {open && (
        <div className="sigo-settings-overlay" role="dialog" aria-modal="true" aria-label="Configuración de SIGO">
          <div className="sigo-settings-topbar">
            <button className="admin-button" type="button" onClick={() => setOpen(false)}>← Volver</button>
            <div>
              <strong>Configuración</strong>
              <small>{empresa.empresa_nombre}</small>
            </div>
          </div>
          <main className="sigo-settings-content">
            <ConfiguracionOperativa empresa={empresa} />
          </main>
        </div>
      )}
    </>
  );
}
