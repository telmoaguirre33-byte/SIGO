export type SigoRole =
  | "superadmin"
  | "owner"
  | "admin"
  | "seller"
  | "warehouse"
  | "client";

export type SigoPermission =
  | "companies.manage"
  | "users.manage"
  | "products.read"
  | "products.write"
  | "stock.read"
  | "stock.write"
  | "sales.read"
  | "sales.write"
  | "purchases.read"
  | "purchases.write"
  | "clients.read"
  | "clients.write"
  | "suppliers.read"
  | "suppliers.write"
  | "reports.read"
  | "costs.read"
  | "margins.read"
  | "price_lists.read"
  | "arca.configure"
  | "invoices.issue"
  | "client_portal.read";

const rolePermissions: Record<SigoRole, ReadonlySet<SigoPermission>> = {
  // El superadmin administra la plataforma, empresas y usuarios, pero NO recibe
  // acceso operativo implícito a los datos de cada tenant. Para operar dentro
  // de una empresa debe tener una membresía/permiso explícito de esa empresa.
  superadmin: new Set<SigoPermission>([
    "companies.manage",
    "users.manage",
  ]),
  owner: new Set<SigoPermission>([
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
  ]),
  admin: new Set<SigoPermission>([
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
    "invoices.issue",
  ]),
  seller: new Set<SigoPermission>([
    "products.read",
    "stock.read",
    "sales.read",
    "sales.write",
    "clients.read",
    "invoices.issue",
  ]),
  // Depósito opera catálogo/stock. No recibe Compras/Proveedores porque ese
  // circuito expone costos; la recepción sin valores debe resolverse aparte.
  warehouse: new Set<SigoPermission>([
    "products.read",
    "stock.read",
    "stock.write",
  ]),
  client: new Set<SigoPermission>([
    "client_portal.read",
  ]),
};

/**
 * Permisos efectivos en frontend.
 * La denegacion explicita siempre prevalece sobre el rol y sobre permisos extra.
 * Esto es defensa en profundidad: la autorizacion real debe seguir aplicandose
 * en backend/RLS y nunca depender solamente de esta funcion.
 */
export function can(
  role: SigoRole,
  permission: SigoPermission,
  extraPermissions: readonly SigoPermission[] = [],
  deniedPermissions: readonly SigoPermission[] = []
): boolean {
  if (deniedPermissions.includes(permission)) return false;

  return (
    rolePermissions[role].has(permission) ||
    extraPermissions.includes(permission)
  );
}

export function canSeeSensitiveCommercialData(
  role: SigoRole,
  extraPermissions: readonly SigoPermission[] = [],
  deniedPermissions: readonly SigoPermission[] = []
): boolean {
  return (
    can(role, "costs.read", extraPermissions, deniedPermissions) ||
    can(role, "margins.read", extraPermissions, deniedPermissions) ||
    can(role, "price_lists.read", extraPermissions, deniedPermissions)
  );
}
