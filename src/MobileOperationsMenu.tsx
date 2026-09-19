import { useCallback, useEffect, useMemo, useState } from "react";
import { cargarMisEmpresas, leerEmpresaActivaGuardada, resolverEmpresaActiva, type EmpresaOperativa } from "./tenant";
import { supabase } from "./supabase";

type Grupo = "ingresos" | "egresos" | null;

function normalizar(texto: string) {
  return texto.trim().toLocaleLowerCase("es-AR");
}

function clickPorTexto(selector: string, texto: string) {
  const esperado = normalizar(texto);
  const botones = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const boton = botones.find((item) => normalizar(item.textContent ?? "").includes(esperado));
  boton?.click();
  return Boolean(boton);
}

function clickSelector(selector: string) {
  const elemento = document.querySelector<HTMLElement>(selector);
  elemento?.click();
  return Boolean(elemento);
}

function etiquetaRol(rol?: string) {
  return ({ owner: "Propietario", admin: "Administrador", seller: "Vendedor", warehouse: "Depósito", client: "Cliente" } as Record<string, string>)[rol || ""] || "";
}

export default function MobileOperationsMenu() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [grupo, setGrupo] = useState<Grupo>("ingresos");
  const [top, setTop] = useState(176);

  const puedeAdministrar = empresa?.rol === "owner" || empresa?.rol === "admin";
  const puedeVender = empresa ? ["owner", "admin", "seller"].includes(empresa.rol) : true;
  const puedeFacturar = empresa ? ["owner", "admin", "seller"].includes(empresa.rol) : false;

  const cargarEmpresa = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return;
      const empresas = await cargarMisEmpresas();
      const activa = resolverEmpresaActiva(empresas, leerEmpresaActivaGuardada(data.user.id), data.user.id);
      if (activa) setEmpresa(activa);
    } catch (error) {
      console.warn("No se pudo refrescar la empresa del menú móvil", error);
    }
  }, []);

  useEffect(() => {
    void cargarEmpresa();
    const refrescar = () => { if (document.visibilityState === "visible") void cargarEmpresa(); };
    document.addEventListener("visibilitychange", refrescar);
    return () => document.removeEventListener("visibilitychange", refrescar);
  }, [cargarEmpresa]);

  useEffect(() => {
    let observer: ResizeObserver | null = null;
    const actualizar = () => {
      const barra = document.querySelector<HTMLElement>(".sigo-tenant-bar");
      if (!barra) {
        setTop(12);
        return;
      }
      setTop(Math.max(8, Math.round(barra.getBoundingClientRect().bottom + 8)));
      if (!observer) {
        observer = new ResizeObserver(actualizar);
        observer.observe(barra);
      }
    };
    actualizar();
    const timer = window.setInterval(actualizar, 800);
    window.addEventListener("resize", actualizar);
    window.addEventListener("scroll", actualizar, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", actualizar);
      window.removeEventListener("scroll", actualizar);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior; };
  }, [abierto]);

  const nombreEmpresa = useMemo(() => empresa?.empresa_nombre || empresa?.nombre || "Empresa activa", [empresa]);

  function cerrar() {
    setAbierto(false);
  }

  function irOperacion(seccion: string) {
    cerrar();
    clickPorTexto(".sigo-context-actions button", "Operación");
    window.setTimeout(() => clickPorTexto(".sigo-operation-only .sidebar .menu > button", seccion), 80);
  }

  function irWorkspace(nombre: string) {
    cerrar();
    clickPorTexto(".sigo-context-actions button", nombre);
  }

  function abrirCarrito() {
    cerrar();
    if (clickSelector(".sigo-cart-menu-item, .sigo-cart-context-button")) return;
    irOperacion("Ventas");
  }

  function abrirLectorCelular() {
    cerrar();
    if (clickSelector(".sigo-mobile-reader-menu-item")) return;
    clickPorTexto(".sigo-context-actions button", "Operación");
    window.setTimeout(() => clickSelector(".sigo-mobile-reader-menu-item"), 100);
  }

  function abrirDevoluciones() {
    cerrar();
    if (clickSelector(".sigo-returns-menu-item, .sigo-returns-context-button")) return;
    irOperacion("Ventas");
  }

  function abrirIngresos() {
    cerrar();
    clickPorTexto(".sigo-context-actions button", "Informes");
    window.setTimeout(() => {
      if (!clickSelector(".sigo-income-launch-card")) {
        document.getElementById("informe-ventas")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 180);
  }

  function abrirArca() {
    cerrar();
    clickSelector(".arca-launcher");
  }

  function abrirConfiguracion() {
    cerrar();
    clickSelector(".sigo-settings-menu-item, .sigo-settings-context-button");
  }

  function abrirAyuda() {
    cerrar();
    clickSelector(".sigo-help-launcher");
  }

  return (
    <>
      <div className="sigo-mobile-operations-actions" style={{ top }} aria-label="Accesos rápidos de operación">
        <button className="sigo-mobile-menu-trigger" type="button" onClick={() => setAbierto(true)} aria-label="Abrir menú de SIGO" aria-expanded={abierto}>
          <span aria-hidden="true">☰</span>
          <strong>Menú</strong>
        </button>
        {puedeVender && (
          <button className="sigo-mobile-cart-trigger" type="button" onClick={abrirCarrito} aria-label="Abrir carrito y nueva venta">
            <span aria-hidden="true">🛒</span>
            <strong>Carrito</strong>
          </button>
        )}
      </div>

      {abierto && (
        <div className="sigo-mobile-drawer-layer" role="presentation">
          <button className="sigo-mobile-drawer-backdrop" type="button" aria-label="Cerrar menú" onClick={cerrar} />
          <aside className="sigo-mobile-drawer" role="dialog" aria-modal="true" aria-label="Menú principal SIGO">
            <div className="sigo-mobile-drawer-head">
              <div className="sigo-mobile-drawer-logo">S</div>
              <div><strong>SIGO</strong><span>{nombreEmpresa}{empresa?.rol ? ` · ${etiquetaRol(empresa.rol)}` : ""}</span></div>
              <button type="button" onClick={cerrar} aria-label="Cerrar menú">×</button>
            </div>

            {empresa?.rol === "seller" ? (
              <div style={{ padding: "10px 16px", fontSize: 13, opacity: 0.8 }}>
                Vendedor: ventas, productos/stock de consulta, clientes para vender y emisión ARCA. Sin usuarios, compras, costos, informes administrativos ni configuración.
              </div>
            ) : null}

            <nav className="sigo-mobile-drawer-nav" aria-label="Temas de SIGO">
              {puedeVender && (
                <button className="sigo-mobile-drawer-primary" type="button" onClick={abrirCarrito}>
                  <span>🛒</span><div><strong>Nueva venta / Carrito</strong><small>Escanear, agregar productos y cobrar</small></div>
                </button>
              )}

              <section>
                <button className="sigo-mobile-drawer-section" type="button" onClick={() => setGrupo(grupo === "ingresos" ? null : "ingresos")}>
                  <span>↗</span><strong>Ingresos</strong><b>{grupo === "ingresos" ? "⌄" : "›"}</b>
                </button>
                {grupo === "ingresos" && <div className="sigo-mobile-drawer-submenu">
                  {puedeVender && <button type="button" onClick={abrirCarrito}>Ventas a clientes</button>}
                  {puedeAdministrar && <button type="button" onClick={abrirIngresos}>Ventas por día / Ingresos</button>}
                </div>}
              </section>

              {puedeAdministrar ? (
                <section>
                  <button className="sigo-mobile-drawer-section" type="button" onClick={() => setGrupo(grupo === "egresos" ? null : "egresos")}>
                    <span>↘</span><strong>Egresos</strong><b>{grupo === "egresos" ? "⌄" : "›"}</b>
                  </button>
                  {grupo === "egresos" && <div className="sigo-mobile-drawer-submenu">
                    <button type="button" onClick={() => irWorkspace("Compras / Proveedores")}>Compras a proveedores</button>
                  </div>}
                </section>
              ) : null}

              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={() => irWorkspace("Clientes / Ctas. corrientes")}><span>👥</span><strong>Contactos / Clientes</strong><b>›</b></button>}
              <button className="sigo-mobile-drawer-item" type="button" onClick={() => irOperacion("Productos")}><span>◇</span><strong>Productos</strong><b>›</b></button>
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={() => irOperacion("Lista de precios")}><span>$</span><strong>Lista de precios</strong><b>›</b></button>}
              {puedeVender && <button className="sigo-mobile-drawer-item" type="button" onClick={abrirDevoluciones}><span>↩</span><strong>Devoluciones / Anulaciones</strong><b>›</b></button>}
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={abrirLectorCelular}><span>📱</span><strong>Vincular celular</strong><b>›</b></button>}
              {puedeFacturar && <button className="sigo-mobile-drawer-item" type="button" onClick={abrirArca}><span>A</span><strong>ARCA / Facturación</strong><b>›</b></button>}
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={() => irWorkspace("Clientes / Ctas. corrientes")}><span>▣</span><strong>Cuentas corrientes</strong><b>›</b></button>}
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={() => irWorkspace("Informes")}><span>◔</span><strong>Informes</strong><b>›</b></button>}
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={() => irWorkspace("Usuarios")}><span>♙</span><strong>Usuarios / permisos</strong><b>›</b></button>}
              {puedeAdministrar && <button className="sigo-mobile-drawer-item" type="button" onClick={abrirConfiguracion}><span>⚙</span><strong>Configuración</strong><b>›</b></button>}
              <button className="sigo-mobile-drawer-item" type="button" onClick={abrirAyuda}><span>?</span><strong>Ayuda</strong><b>›</b></button>
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
