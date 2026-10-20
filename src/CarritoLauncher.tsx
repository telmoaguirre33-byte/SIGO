import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VentaRapidaOperativa from "./VentaRapidaOperativa";
import { supabase } from "./supabase";
import {
  cargarMisEmpresas,
  leerEmpresaActivaGuardada,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";

function puedeVender(empresa: EmpresaOperativa | null) {
  return empresa?.rol === "owner" || empresa?.rol === "admin" || empresa?.rol === "seller";
}

type Host = { element: HTMLElement; kind: "sidebar" | "context" } | null;

export default function CarritoLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [open, setOpen] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [host, setHost] = useState<Host>(null);

  const cargarEmpresa = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return setEmpresa(null);
      const empresas = await cargarMisEmpresas();
      const activa = resolverEmpresaActiva(empresas, leerEmpresaActivaGuardada(data.user.id), data.user.id);
      setEmpresa(puedeVender(activa) ? activa : null);
    } catch {
      setEmpresa(null);
    }
  }, []);

  useEffect(() => {
    void cargarEmpresa();
    const refrescar = () => { if (document.visibilityState === "visible") void cargarEmpresa(); };
    const cambiarEmpresa = (event: Event) => {
      const siguiente = (event as CustomEvent<EmpresaOperativa | null>).detail;
      setEmpresa(puedeVender(siguiente) ? siguiente : null);
      setOpen(false); // Un carrito iniciado en otra empresa nunca se reutiliza.
    };
    document.addEventListener("visibilitychange", refrescar);
    window.addEventListener("sigo:empresa-activa-cambiada", cambiarEmpresa);
    return () => {
      document.removeEventListener("visibilitychange", refrescar);
      window.removeEventListener("sigo:empresa-activa-cambiada", cambiarEmpresa);
    };
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

  useEffect(() => {
    const abrirCaja = () => {
      if (!empresa) return;
      const ventas = document.querySelector<HTMLButtonElement>('.sidebar .menu-item[data-view="Ventas"], .sidebar button[data-view="Ventas"]');
      if (ventas) { ventas.click(); return; }
      setEmbedded(true);
      setOpen(true);
    };
    window.addEventListener("sigo:abrir-caja", abrirCaja);
    return () => window.removeEventListener("sigo:abrir-caja", abrirCaja);
  }, [empresa]);

  function cerrar() {
    if (window.confirm("¿Cerrar el carrito? Si hay una venta sin confirmar, se descartará sin modificar stock ni caja.")) {
      setOpen(false);
    }
  }

  if (!empresa) return null;

  // La venta ya se abre desde Operación > Ventas. Evitamos un acceso duplicado
  // en la cabecera/contexto que además podía abrir una vista sin navegación.
  const boton = null;

  return (
    <>
      {host && boton ? createPortal(boton, host.element) : null}
      {open && !embedded && (
        <div className="sigo-cart-overlay" role="dialog" aria-modal="true" aria-label="Carrito de ventas">
          <div className="sigo-cart-topbar">
            <button className="admin-button" type="button" onClick={cerrar}>← Cerrar / cancelar</button>
            <div>
              <strong>CAJA - VENTA</strong>
              <small>{empresa.empresa_nombre}</small>
            </div>
          </div>
          <main className="sigo-cart-content">
            <VentaRapidaOperativa key={`${empresa.empresa_id}-${open ? "open" : "closed"}`} empresaId={empresa.empresa_id} />
          </main>
        </div>
      )}
    </>
  );
}
