import { supabase } from "./supabase";

export type ModuloEmpresa = {
  clave: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  disponible: boolean;
  obligatorio: boolean;
  habilitado: boolean;
  orden: number;
};

export type PresetModulo = "kiosco" | "almacen" | "libreria" | "mayorista" | "fiambreria" | "gastronomia" | "mixto";

function mensajeError(error: unknown) {
  const raw = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : error instanceof Error ? error.message : String(error ?? "");

  if (raw.includes("FORBIDDEN")) return "Tu perfil no puede administrar módulos de esta empresa.";
  if (raw.includes("MODULE_REQUIRED")) return "Ese módulo es esencial para SIGO y no se puede desactivar.";
  if (raw.includes("MODULE_NOT_AVAILABLE")) return "Ese módulo todavía está en preparación y no puede activarse.";
  if (raw.includes("PRESET_INVALID")) return "La configuración de negocio seleccionada no es válida.";
  if (raw.includes("listar_modulos_empresa_sigo") || raw.includes("PGRST202")) return "El tablero de módulos todavía no está disponible en la base de datos. Esperá a que termine el despliegue y volvé a intentar.";
  return raw || "No se pudo actualizar la configuración de módulos.";
}

export async function listarModulosEmpresa(empresaId: string): Promise<ModuloEmpresa[]> {
  const { data, error } = await supabase.rpc("listar_modulos_empresa_sigo", { p_empresa_id: empresaId });
  if (error) throw new Error(mensajeError(error));
  return ((data ?? []) as any[]).map((fila) => ({
    clave: String(fila.clave ?? ""),
    nombre: String(fila.nombre ?? fila.clave ?? "Módulo"),
    descripcion: String(fila.descripcion ?? ""),
    categoria: String(fila.categoria ?? "Otros"),
    disponible: Boolean(fila.disponible),
    obligatorio: Boolean(fila.obligatorio),
    habilitado: Boolean(fila.habilitado),
    orden: Number(fila.orden ?? 100),
  }));
}

export async function actualizarModuloEmpresa(empresaId: string, moduloClave: string, habilitado: boolean): Promise<void> {
  const { error } = await supabase.rpc("actualizar_modulo_empresa_sigo", {
    p_empresa_id: empresaId,
    p_modulo_clave: moduloClave,
    p_habilitado: habilitado,
  });
  if (error) throw new Error(mensajeError(error));
}

export async function aplicarPresetModulosEmpresa(empresaId: string, preset: PresetModulo): Promise<void> {
  const { error } = await supabase.rpc("aplicar_preset_modulos_sigo", {
    p_empresa_id: empresaId,
    p_preset: preset,
  });
  if (error) throw new Error(mensajeError(error));
}
