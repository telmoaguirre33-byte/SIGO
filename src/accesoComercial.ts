import { supabase } from "./supabase";
import type { EmpresaOperativa } from "./tenant";

export type EstadoComercial =
  | "pagada" | "pago_vencido" | "prueba" | "prueba_vencida"
  | "suspendida" | "anterior" | "superadmin";

type AccesoComercial = { empresa_id: string | null; estado: EstadoComercial };

export function esAccesoVigente(estado: EstadoComercial) {
  return estado === "pagada" || estado === "prueba" || estado === "anterior" || estado === "superadmin";
}

export async function misAccesosComerciales(): Promise<AccesoComercial[]> {
  const { data, error } = await supabase.rpc("mis_accesos_comerciales_sigo");
  if (error) throw error;
  return data;
}

export async function limitarEmpresasPorAcceso(empresas: EmpresaOperativa[]) {
  const accesos = await misAccesosComerciales();
  if (accesos.some(({ estado }) => estado === "superadmin")) return empresas;
  const autorizadas = new Set(accesos.filter(({ estado }) => esAccesoVigente(estado)).map(({ empresa_id }) => empresa_id));
  return empresas.filter(({ empresa_id }) => autorizadas.has(empresa_id));
}
