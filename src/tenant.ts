import { supabase } from "./supabase";
import { notificarAltaEmpresaAdmin } from "./adminPush";

export type RolEmpresaSigo =
  | "owner"
  | "admin"
  | "seller"
  | "warehouse"
  | "client";

export type EmpresaOperativa = {
  empresa_id: string;
  nombre: string;
  empresa_nombre: string;
  razon_social: string | null;
  rol: RolEmpresaSigo;
};

const ACTIVE_COMPANY_KEY = "sigo.activeEmpresaId";
const ROLES_VALIDOS = new Set<RolEmpresaSigo>([
  "owner",
  "admin",
  "seller",
  "warehouse",
  "client",
]);

function normalizarRol(valor: unknown): RolEmpresaSigo {
  if (typeof valor === "string" && ROLES_VALIDOS.has(valor as RolEmpresaSigo)) {
    return valor as RolEmpresaSigo;
  }
  throw new Error("TENANT_ROLE_INVALID");
}

function normalizarEmpresa(empresa: Omit<EmpresaOperativa, "empresa_nombre">): EmpresaOperativa {
  return {
    ...empresa,
    empresa_nombre: empresa.nombre || empresa.razon_social || "Empresa",
  };
}

function deduplicarEmpresas(empresas: EmpresaOperativa[]): EmpresaOperativa[] {
  const porId = new Map<string, EmpresaOperativa>();
  for (const empresa of empresas) {
    const empresaId = empresa.empresa_id.trim();
    if (!empresaId) continue;
    if (!porId.has(empresaId)) porId.set(empresaId, { ...empresa, empresa_id: empresaId });
  }
  return Array.from(porId.values());
}

function rpcNoDisponible(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    (mensaje.includes("mis_empresas_sigo") && (mensaje.includes("not found") || mensaje.includes("does not exist")))
  );
}

function errorBackendNoPreparado(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    mensaje.includes("does not exist") ||
    mensaje.includes("not found") ||
    mensaje.includes("schema cache")
  );
}

function errorTransitorio(error: { code?: string; message?: string; status?: number } | null): boolean {
  if (!error) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return (
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    mensaje.includes("network") ||
    mensaje.includes("fetch") ||
    mensaje.includes("timeout") ||
    mensaje.includes("temporarily unavailable")
  );
}

function esperar(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function diagnosticarBackendTenant(): Promise<void> {
  const { error } = await supabase.rpc("sigo_access_healthcheck");
  if (!error) return;
  if (errorBackendNoPreparado(error)) throw new Error("TENANT_BACKEND_MIGRATION_PENDING");
  throw error;
}

async function cargarEmpresasPorMembresia(): Promise<EmpresaOperativa[]> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error("AUTH_REQUIRED");

  const { data, error } = await supabase
    .from("empresa_usuarios")
    .select("empresa_id, rol, empresas!inner(id, nombre, razon_social, activa)")
    .eq("user_id", user.id)
    .eq("activo", true)
    .eq("empresas.activa", true);

  if (error) {
    if (errorBackendNoPreparado(error)) throw new Error("TENANT_BACKEND_MIGRATION_PENDING");
    throw error;
  }

  const normalizadas = (data ?? []).flatMap((fila: any) => {
    const empresa = Array.isArray(fila.empresas) ? fila.empresas[0] : fila.empresas;
    if (!empresa?.id) return [];

    return [
      normalizarEmpresa({
        empresa_id: String(empresa.id).trim(),
        nombre: empresa.nombre ?? "Empresa",
        razon_social: empresa.razon_social ?? null,
        rol: normalizarRol(fila.rol),
      }),
    ];
  });

  return deduplicarEmpresas(normalizadas);
}

async function cargarMisEmpresasUnaVez(): Promise<EmpresaOperativa[]> {
  const { data, error } = await supabase.rpc("mis_empresas_sigo");

  if (!error) {
    const normalizadas = ((data ?? []) as Array<Record<string, unknown>>).map((fila) =>
      normalizarEmpresa({
        empresa_id: String(fila.empresa_id ?? "").trim(),
        nombre: String(fila.nombre ?? "Empresa"),
        razon_social: typeof fila.razon_social === "string" ? fila.razon_social : null,
        rol: normalizarRol(fila.rol),
      }),
    );
    return deduplicarEmpresas(normalizadas);
  }

  if (!rpcNoDisponible(error)) throw error;

  console.warn("mis_empresas_sigo no disponible; verificando fallback RLS", error);
  try {
    return await cargarEmpresasPorMembresia();
  } catch (fallbackError) {
    if (fallbackError instanceof Error && fallbackError.message === "TENANT_BACKEND_MIGRATION_PENDING") {
      try {
        await diagnosticarBackendTenant();
      } catch (diagnosticError) {
        throw diagnosticError;
      }
    }
    throw fallbackError;
  }
}

export async function cargarMisEmpresas(): Promise<EmpresaOperativa[]> {
  try {
    return await cargarMisEmpresasUnaVez();
  } catch (error) {
    const compatible = error as { code?: string; message?: string; status?: number } | null;
    if (!errorTransitorio(compatible)) throw error;

    await esperar(650);
    return cargarMisEmpresasUnaVez();
  }
}

export async function crearEmpresaSigo(nombre: string): Promise<string> {
  const limpio = nombre.trim();
  if (!limpio) throw new Error("EMPRESA_NOMBRE_REQUIRED");

  const { data, error } = await supabase.rpc("crear_empresa", {
    p_nombre: limpio,
    p_razon_social: null,
    p_cuit: null,
  });

  if (error) {
    if (errorBackendNoPreparado(error)) throw new Error("TENANT_BACKEND_MIGRATION_PENDING");
    throw error;
  }

  const empresaId = typeof data === "string" ? data.trim() : "";
  if (!empresaId) throw new Error("EMPRESA_ID_INVALID");
  void notificarAltaEmpresaAdmin(empresaId);
  return empresaId;
}

function activeCompanyStorageKey(userId?: string | null): string {
  const normalizedUserId = userId?.trim();
  return normalizedUserId ? `${ACTIVE_COMPANY_KEY}.${normalizedUserId}` : ACTIVE_COMPANY_KEY;
}

function leerStorageLimpio(key: string): string | null {
  const value = window.localStorage.getItem(key)?.trim() ?? "";
  return value || null;
}

export function leerEmpresaActivaGuardada(userId?: string | null): string | null {
  try {
    const scopedKey = activeCompanyStorageKey(userId);
    const scopedValue = leerStorageLimpio(scopedKey);
    if (scopedValue) return scopedValue;

    // Compatibilidad con sesiones anteriores: el valor legado solo se usa como sugerencia
    // y siempre se vuelve a validar contra las membresías visibles del usuario actual.
    return userId ? leerStorageLimpio(ACTIVE_COMPANY_KEY) : scopedValue;
  } catch {
    return null;
  }
}

export function guardarEmpresaActiva(empresaId: string | null, userId?: string | null): void {
  try {
    const key = activeCompanyStorageKey(userId);
    const normalizedEmpresaId = empresaId?.trim() ?? "";
    if (normalizedEmpresaId) {
      window.localStorage.setItem(key, normalizedEmpresaId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // La app puede continuar sin persistencia local (modo privado/intranet restringida).
  }
}

export function resolverEmpresaActiva(
  empresas: EmpresaOperativa[],
  preferida?: string | null,
  userId?: string | null,
): EmpresaOperativa | null {
  if (empresas.length === 0) return null;

  const candidata = (preferida ?? leerEmpresaActivaGuardada(userId))?.trim() || null;
  const encontrada = candidata
    ? empresas.find((empresa) => empresa.empresa_id === candidata)
    : undefined;

  const activa = encontrada ?? empresas[0];

  // La persistencia definitiva siempre debe quedar ligada al usuario autenticado.
  // Si el caller todavía no tiene userId, devolvemos la empresa sin escribir la clave global legado.
  if (userId?.trim()) guardarEmpresaActiva(activa.empresa_id, userId);
  return activa;
}
