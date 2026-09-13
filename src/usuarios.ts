import { supabase } from "./supabase";
import type { SigoPermission, SigoRole } from "./permissions";

export type UsuarioEmpresaSigo = {
  membresia_id: string;
  user_id: string;
  email: string;
  rol: SigoRole;
  activo: boolean;
  permisos_extra: SigoPermission[];
  permisos_denegados: SigoPermission[];
  created_at: string;
};

export type VinculoPortalClienteSigo = {
  membresia_id: string;
  user_id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  vinculos_activos: number;
};

const rolesGestionables: SigoRole[] = ["admin", "seller", "warehouse", "client"];

const PERMISOS_VALIDOS = new Set<SigoPermission>([
  "companies.manage",
  "users.manage",
  "products.read",
  "products.write",
  "stock.read",
  "stock.write",
  "sales.read",
  "sales.write",
  "purchases.read",
  "purchases.write",
  "clients.read",
  "clients.write",
  "suppliers.read",
  "suppliers.write",
  "reports.read",
  "costs.read",
  "margins.read",
  "price_lists.read",
  "arca.configure",
  "invoices.issue",
  "client_portal.read",
]);

function normalizarPermisos(valor: unknown): SigoPermission[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.map(String).filter((item): item is SigoPermission => PERMISOS_VALIDOS.has(item as SigoPermission)))];
}

function mensajeUsuarios(errorMessage: string): string {
  const normalized = errorMessage.toUpperCase();
  if (normalized.includes("USER_NOT_REGISTERED")) return "Ese email todavía no tiene una cuenta SIGO. Pedile que cree una cuenta de usuario y volvé a agregarlo.";
  if (normalized.includes("USER_EMAIL_REQUIRED")) return "Ingresá el email del usuario.";
  if (normalized.includes("ROLE_NOT_ALLOWED")) return "Tu perfil no puede asignar ese rol.";
  if (normalized.includes("OWNER_MEMBERSHIP_IMMUTABLE")) return "El propietario principal no puede modificarse desde esta pantalla.";
  if (normalized.includes("SELF_DEACTIVATION_FORBIDDEN")) return "No podés desactivar tu propio acceso.";
  if (normalized.includes("OWNER_PERMISSION_REQUIRED")) return "Sólo el Propietario puede personalizar permisos individuales.";
  if (normalized.includes("PERMISSION_CONFLICT")) return "Un permiso no puede estar otorgado y denegado al mismo tiempo.";
  if (normalized.includes("PERMISSION_GRANT_FORBIDDEN")) return "Ese privilegio estructural no puede otorgarse como permiso adicional. Usá el rol correspondiente.";
  if (normalized.includes("CLIENT_EXTRA_PERMISSIONS_FORBIDDEN")) return "El rol Cliente debe permanecer limitado al Portal Cliente.";
  if (normalized.includes("USERS_MANAGE_FORBIDDEN")) return "No tenés permiso para administrar usuarios de esta empresa.";
  if (normalized.includes("PERMISSION_INVALID")) return "La configuración contiene un permiso no válido.";
  if (normalized.includes("MEMBERSHIP_NOT_FOUND")) return "La membresía ya no existe o pertenece a otra empresa.";
  if (normalized.includes("CLIENT_MEMBERSHIP_REQUIRED")) return "El Portal Cliente sólo puede vincularse a un usuario activo con rol Cliente.";
  if (normalized.includes("CLIENT_NOT_FOUND")) return "El cliente comercial ya no está activo o pertenece a otra empresa.";
  if (normalized.includes("PORTAL_LINK_AMBIGUOUS")) return "El usuario tiene más de una vinculación activa. Elegí nuevamente el cliente para corregirla.";
  return "No pudimos completar la administración de usuarios. Actualizá e intentá nuevamente.";
}

export function rolUsuarioValido(rol: string): rol is SigoRole {
  return ["owner", ...rolesGestionables].includes(rol as SigoRole);
}

export async function listarUsuariosEmpresaSigo(empresaId: string): Promise<UsuarioEmpresaSigo[]> {
  const { data, error } = await supabase.rpc("listar_usuarios_empresa_sigo", { p_empresa_id: empresaId });
  if (error) throw new Error(mensajeUsuarios(error.message));
  return ((data ?? []) as unknown[])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.membresia_id === "string" && typeof row.user_id === "string" && rolUsuarioValido(String(row.rol ?? "")))
    .map((row) => ({
      membresia_id: String(row.membresia_id),
      user_id: String(row.user_id),
      email: String(row.email ?? ""),
      rol: String(row.rol) as SigoRole,
      activo: Boolean(row.activo),
      permisos_extra: normalizarPermisos(row.permisos_extra),
      permisos_denegados: normalizarPermisos(row.permisos_denegados),
      created_at: String(row.created_at ?? ""),
    }));
}

export async function listarVinculosPortalClienteSigo(empresaId: string): Promise<VinculoPortalClienteSigo[]> {
  const { data, error } = await supabase.rpc("listar_vinculos_portal_cliente_sigo", { p_empresa_id: empresaId });
  if (error) throw new Error(mensajeUsuarios(error.message));

  return ((data ?? []) as unknown[])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.membresia_id === "string" && typeof row.user_id === "string")
    .map((row) => ({
      membresia_id: String(row.membresia_id),
      user_id: String(row.user_id),
      cliente_id: typeof row.cliente_id === "string" ? row.cliente_id : null,
      cliente_nombre: typeof row.cliente_nombre === "string" ? row.cliente_nombre : null,
      vinculos_activos: Number.isFinite(Number(row.vinculos_activos)) ? Number(row.vinculos_activos) : 0,
    }));
}

export async function agregarUsuarioEmpresaSigo(empresaId: string, email: string, rol: SigoRole): Promise<string> {
  if (!rolesGestionables.includes(rol)) throw new Error("Rol de usuario inválido.");
  const { data, error } = await supabase.rpc("agregar_usuario_empresa_sigo", {
    p_empresa_id: empresaId,
    p_email: email.trim().toLowerCase(),
    p_rol: rol,
  });
  if (error) throw new Error(mensajeUsuarios(error.message));
  return String(data);
}

export async function actualizarUsuarioEmpresaSigo(
  empresaId: string,
  membresiaId: string,
  rol: SigoRole,
  activo: boolean,
): Promise<string> {
  if (!rolesGestionables.includes(rol)) throw new Error("Rol de usuario inválido.");
  const { data, error } = await supabase.rpc("actualizar_usuario_empresa_sigo", {
    p_empresa_id: empresaId,
    p_membresia_id: membresiaId,
    p_rol: rol,
    p_activo: activo,
  });
  if (error) throw new Error(mensajeUsuarios(error.message));
  return String(data);
}

export async function actualizarPermisosUsuarioEmpresaSigo(
  empresaId: string,
  membresiaId: string,
  permisosExtra: readonly SigoPermission[],
  permisosDenegados: readonly SigoPermission[],
): Promise<string> {
  const extra = [...new Set(permisosExtra)];
  const denegados = [...new Set(permisosDenegados)];
  if (extra.some((permiso) => !PERMISOS_VALIDOS.has(permiso)) || denegados.some((permiso) => !PERMISOS_VALIDOS.has(permiso))) {
    throw new Error("La configuración contiene un permiso no válido.");
  }
  if (extra.some((permiso) => denegados.includes(permiso))) {
    throw new Error("Un permiso no puede estar otorgado y denegado al mismo tiempo.");
  }

  const { data, error } = await supabase.rpc("actualizar_permisos_usuario_empresa_sigo", {
    p_empresa_id: empresaId,
    p_membresia_id: membresiaId,
    p_permisos_extra: extra,
    p_permisos_denegados: denegados,
  });
  if (error) throw new Error(mensajeUsuarios(error.message));
  return String(data);
}

export async function vincularUsuarioClienteSigo(
  empresaId: string,
  membresiaId: string,
  clienteId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("vincular_usuario_cliente_sigo", {
    p_empresa_id: empresaId,
    p_membresia_id: membresiaId,
    p_cliente_id: clienteId,
  });
  if (error) throw new Error(mensajeUsuarios(error.message));
  return data ? String(data) : null;
}
