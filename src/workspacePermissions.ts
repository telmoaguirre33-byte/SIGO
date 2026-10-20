import type { RolEmpresaSigo } from "./tenant";

export type SigoWorkspace = "operacion" | "usuarios" | "clientes" | "compras" | "informes" | "portal";

const WORKSPACES_BY_ROLE: Record<RolEmpresaSigo, readonly SigoWorkspace[]> = {
  owner: ["operacion", "usuarios", "clientes", "compras", "informes"],
  admin: ["operacion", "usuarios", "clientes", "compras", "informes"],
  // Vendedor usa clientes dentro del flujo de venta, pero no entra al workspace
  // completo de cuentas corrientes hasta disponer de una vista estrictamente
  // de solo lectura acorde a clients.read.
  seller: ["operacion"],
  // Depósito opera catálogo/stock, pero no entra a Compras para no exponer costos
  // hasta disponer de una vista de recepción específica sin valores sensibles.
  warehouse: ["operacion"],
  // Cliente sólo entra al portal externo de su propia cuenta.
  client: ["portal"],
};

export function workspacesPermitidos(rol: RolEmpresaSigo): readonly SigoWorkspace[] {
  return WORKSPACES_BY_ROLE[rol] ?? [];
}

export function workspacePermitido(rol: RolEmpresaSigo, workspace: SigoWorkspace): boolean {
  return workspacesPermitidos(rol).includes(workspace);
}

export function workspaceInicial(rol: RolEmpresaSigo): SigoWorkspace {
  return workspacesPermitidos(rol)[0] ?? "operacion";
}

export function etiquetaRol(rol: RolEmpresaSigo): string {
  const etiquetas: Record<RolEmpresaSigo, string> = {
    owner: "Propietario",
    admin: "Administrador",
    seller: "Vendedor",
    warehouse: "Depósito",
    client: "Cliente",
  };
  return etiquetas[rol] ?? rol;
}
