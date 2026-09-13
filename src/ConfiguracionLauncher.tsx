import { useCallback, useEffect, useState } from "react";
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

export default function ConfiguracionLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [open, setOpen] = useState(false);

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

  async function abrir() {
    const activa = await cargar();
    if (activa) setOpen(true);
  }

  if (!empresa) return null;

  return (
    <>
      <button className="sigo-settings-launcher" type="button" onClick={() => void abrir()} aria-label="Abrir Configuración">
        <span className="sigo-settings-launcher-icon" aria-hidden="true">⚙</span>
        <span><strong>Configuración</strong><small>Empresa y ARCA</small></span>
      </button>

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
