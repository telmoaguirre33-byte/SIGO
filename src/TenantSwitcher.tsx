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

type ContextoCargado = { userId: string; empresa: EmpresaOperativa | null };

function mismaEmpresa(a: EmpresaOperativa | null, b: EmpresaOperativa | null) {
  if (!a || !b) return a === b;
  return a.empresa_id === b.empresa_id && a.rol === b.rol
    && a.nombre === b.nombre && a.empresa_nombre === b.empresa_nombre
    && a.razon_social === b.razon_social;
}

function esErrorDeConexion(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; name?: string; message?: string };
  if (e.status === 401 || e.status === 403) return false;
  return e.name === "AuthRetryableFetchError" || [502, 503, 504].includes(e.status ?? 0)
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(e.message ?? "");
}

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
  const contextoRef = useRef<ContextoCargado | null>(null);
  const [errorActualizacion, setErrorActualizacion] = useState(false);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const contextoAnterior = contextoRef.current;
    const conservarPantalla = Boolean(contextoAnterior?.empresa && contextoAnterior.empresa.empresa_id === value);
    // Cámara/galería ocultan la página en Android. Revalidar no debe desmontar
    // Compra IA ni destruir el archivo seleccionado o su análisis en curso.
    if (!conservarPantalla) {
      setLoading(true);
      onStateChange?.("loading");
    }
    setError(false);
    setErrorActualizacion(false);

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (requestRef.current !== requestId) return;
      if (authError) throw authError;
      const currentUser = authData.user ?? null;
      const currentUserId = currentUser?.id ?? null;
      if (!currentUserId) throw new Error("Sesión no disponible para cargar empresas.");

      const cambioUsuario = Boolean(contextoAnterior && contextoAnterior.userId !== currentUserId);
      if (cambioUsuario) {
        contextoRef.current = null;
        setEmpresas([]);
        onChange(null);
        onStateChange?.("loading");
      }
      let disponibles = await cargarMisEmpresas();
      if (requestRef.current !== requestId) return;

      // La empresa sigue siendo el contenedor técnico que separa datos, pero ya no bloquea el acceso.
      // Si el usuario autenticado todavía no tiene ninguna, SIGO crea un espacio operativo mínimo
      // automáticamente y continúa. Luego el nombre/datos de empresa se pueden editar normalmente.
      if (disponibles.length === 0 && !contextoAnterior) {
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

      if (requestRef.current !== requestId) return;
      setUserId(currentUserId);
      setEmpresas(disponibles);
      const preferida = cambioUsuario ? leerEmpresaActivaGuardada(currentUserId) : value ?? leerEmpresaActivaGuardada(currentUserId);
      const activa = resolverEmpresaActiva(disponibles, preferida, currentUserId);
      const mismoContexto = contextoAnterior?.userId === currentUserId
        && mismaEmpresa(contextoAnterior.empresa, activa) && value === activa?.empresa_id;
      contextoRef.current = { userId: currentUserId, empresa: activa };
      // SigoRoot reinicia el workspace cuando recibe onChange: emitir sólo si
      // cambió realmente la empresa, sus datos o permisos, no al volver al foco.
      if (!mismoContexto) onChange(activa);
      onStateChange?.(activa ? "ready" : "empty");
    } catch (e) {
      if (requestRef.current !== requestId) return;
      if (conservarPantalla && contextoRef.current === contextoAnterior && esErrorDeConexion(e)) {
        setErrorActualizacion(true);
        return;
      }
      console.error(e);
      contextoRef.current = null;
      setEmpresas([]);
      setError(true);
      onChange(null);
      onStateChange?.("error");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [onChange, onStateChange, value]);

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
    requestRef.current += 1;
    contextoRef.current = userId ? { userId, empresa } : null;
    guardarEmpresaActiva(empresa?.empresa_id ?? null, userId);
    onChange(empresa);
  }

  async function cerrarSesion() {
    requestRef.current += 1;
    contextoRef.current = null;
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
      {errorActualizacion && <span role="status">No pudimos actualizar la conexión. Tu pantalla sigue abierta. Tocá Actualizar para reintentar.</span>}
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
