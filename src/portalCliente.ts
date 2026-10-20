import { supabase } from "./supabase";

export type PortalClienteProducto = {
  producto_id: string;
  codigo_interno: string | null;
  codigo_barras: string | null;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  stock_comercial: number | null;
  consumo_diario_estimado: number | null;
  dias_cobertura: number | null;
  semaforo: "VERDE" | "AMARILLO" | "ROJO" | "SIN_DATOS";
  sugerencia_compra: number;
  actualizado_en: string;
};

function numeroONull(valor: unknown): number | null {
  if (valor == null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export async function cargarPortalClienteSigo(empresaId: string): Promise<PortalClienteProducto[]> {
  const { data, error } = await supabase.rpc("portal_cliente_catalogo_sigo", { p_empresa_id: empresaId });
  if (error) {
    const normalized = error.message.toUpperCase();
    if (normalized.includes("PORTAL_LINK_AMBIGUOUS")) throw new Error("Tu acceso al Portal Cliente tiene una vinculación inconsistente. Pedile al administrador de la empresa que seleccione nuevamente tu cliente.");
    if (normalized.includes("PORTAL_FORBIDDEN")) throw new Error("Tu cuenta todavía no está vinculada a un cliente activo de esta empresa.");
    if (normalized.includes("AUTH_REQUIRED")) throw new Error("Tu sesión venció. Volvé a ingresar.");
    throw new Error("No pudimos cargar tu portal. Intentá nuevamente.");
  }

  return ((data ?? []) as unknown[]).map((item) => {
    const row = item as Record<string, unknown>;
    const semaforo = String(row.semaforo ?? "SIN_DATOS") as PortalClienteProducto["semaforo"];
    return {
      producto_id: String(row.producto_id),
      codigo_interno: row.codigo_interno == null ? null : String(row.codigo_interno),
      codigo_barras: row.codigo_barras == null ? null : String(row.codigo_barras),
      nombre: String(row.nombre ?? "Producto"),
      marca: row.marca == null ? null : String(row.marca),
      categoria: row.categoria == null ? null : String(row.categoria),
      stock_comercial: numeroONull(row.stock_comercial),
      consumo_diario_estimado: numeroONull(row.consumo_diario_estimado),
      dias_cobertura: numeroONull(row.dias_cobertura),
      semaforo: ["VERDE", "AMARILLO", "ROJO", "SIN_DATOS"].includes(semaforo) ? semaforo : "SIN_DATOS",
      sugerencia_compra: numeroONull(row.sugerencia_compra) ?? 0,
      actualizado_en: String(row.actualizado_en ?? ""),
    };
  });
}
