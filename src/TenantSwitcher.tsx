import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cargarMisEmpresas,
  crearEmpresaSigo,
  guardarEmpresaActiva,
  leerEmpresaActivaGuardada,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";
import { supabase } from "./supabase";

type TenantState = "loading" | "ready" | "empty" | "error";

type Props = {
  value?: string | null;
  onChange: (empresa: EmpresaOperativa | null) => void;
  onStateChange?: (state: TenantState) => void;
  disabled?: boolean;
};

export default function TenantSwitcher({ value, onChange, onStateChange, disabled = false }: Props) {
  const [empresas, setEmpresas] = useState<EmpresaOperativa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const primeraCarga = empresas.length === 0;
    if (primeraCarga) {
      setLoading(true);
      onStateChange?.("loading");
    }
    setError(false);

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const currentUser = authData.user ?? null;
      const currentUserId = currentUser?.id ?? null;
      if (!currentUserId) throw new Error("Sesión no disponible para cargar empresas.");

      let disponibles = await cargarMisEmpresas();
      if (requestRef.current !== requestId) return;

      // La empresa sigue siendo el contenedor técnico que separa datos, pero ya no bloquea el acceso.
      // Si el usuario autenticado todavía no tiene ninguna, SIGO crea un espacio operativo mínimo
      // automáticamente y continúa. Luego el nombre/datos de empresa se pueden editar normalmente.
      if (disponibles.length === 0) {
        const metadataNombre = String(currentUser?.user_metadata?.sigo_empresa_nombre ?? "").trim();
        const emailNombre = String(currentUser?.email ?? "").split("@")[0]?.trim() ?? "";
        const nombreInicial = metadataNombre || emailNombre || "Mi negocio";

        const empresaCreadaId = await crearEmpresaSigo(nombreInicial);
        if (requestRef.current !== requestId) return;
        disponibles = await cargarMisEmpresas();
        if (requestRef.current !== requestId) return;

        if (disponibles.length === 0) throw new Error("EMPRESA_CREATED_NOT_VISIBLE");

        const creada = resolverEmpresaActiva(disponibles, empresaCreadaId, currentUserId);
        if (!creada) throw new Error("EMPRESA_CREATED_NOT_VISIBLE");

        // Limpiamos el dato pendiente si existía. No condiciona el ingreso.
        const { error: metadataError } = await supabase.auth.updateUser({
          data: { sigo_empresa_nombre: null },
        });
        if (metadataError) console.warn("No se pudo limpiar el nombre pendiente de empresa", metadataError);
      }

      setUserId(currentUserId);
      setEmpresas(disponibles);
      const preferida = value ?? leerEmpresaActivaGuardada(currentUserId);
      const activa = resolverEmpresaActiva(disponibles, preferida, currentUserId);
      if (!value || value !== activa?.empresa_id) onChange(activa);
      onStateChange?.(activa ? "ready" : "empty");
    } catch (e) {
      if (requestRef.current !== requestId) return;
      console.error(e);
      setEmpresas([]);
      setError(true);
      onChange(null);
      onStateChange?.("error");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [onChange, onStateChange, value, empresas.length]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const refrescarAlVolver = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refrescarAlVolver);
    return () => document.removeEventListener("visibilitychange", refrescarAlVolver);
  }, [load]);

  const selected = useMemo(() => {
    if (value && empresas.some((empresa) => empresa.empresa_id === value)) return value;
    return empresas[0]?.empresa_id ?? "";
  }, [empresas, value]);

  function selectEmpresa(empresaId: string) {
    const empresa = empresas.find((item) => item.empresa_id === empresaId) ?? null;
    guardarEmpresaActiva(empresa?.empresa_id ?? null, userId);
    onChange(empresa);
  }

  async function cerrarSesion() {
    requestRef.current += 1;
    guardarEmpresaActiva(null, userId);
    await supabase.auth.signOut();
  }

  if (loading || error || empresas.length === 0) return null;

  return (
    <div className="sigo-company-switcher">
      <label className="sigo-company-field">
        <span className="sigo-company-eyebrow">Empresa activa</span>
        <select
          value={selected}
          disabled={disabled || empresas.length === 1}
          onChange={(event) => selectEmpresa(event.target.value)}
          aria-label="Seleccionar empresa activa"
          className="sigo-company-select"
        >
          {empresas.map((empresa) => (
            <option key={empresa.empresa_id} value={empresa.empresa_id}>
              {empresa.nombre || empresa.razon_social || "Empresa"}
            </option>
          ))}
        </select>
      </label>
      <div className="sigo-company-actions">
        <button type="button" disabled={disabled} onClick={() => void load()} className="sigo-company-button" aria-label="Actualizar empresa">
          <span aria-hidden="true">↻</span><span>Actualizar</span>
        </button>
        <button type="button" disabled={disabled} onClick={() => void cerrarSesion()} className="sigo-company-button sigo-company-logout" aria-label="Cerrar sesión">
          <span aria-hidden="true">↗</span><span>Salir</span>
        </button>
      </div>
    </div>
  );
}
