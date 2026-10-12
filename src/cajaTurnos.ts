import { supabase } from "./supabase";

export type CajaTurnoSigo = {
  id: string;
  empresa_id: string;
  caja_id: string;
  estado: "abierta" | "cerrada";
  usuario_apertura: string;
  fecha_apertura: string;
  fondo_inicial: number | string;
  usuario_cierre: string | null;
  fecha_cierre: string | null;
  efectivo_contado: number | string | null;
  efectivo_esperado: number | string | null;
  diferencia: number | string | null;
  motivo_diferencia: string | null;
};

export type CajaMovimientoSigo = {
  tipo: "ingreso" | "egreso";
  medio_pago: string;
  importe: number | string;
  concepto: string;
  created_at: string;
};

export type CajaAjusteSigo = {
  id: string;
  tipo: "ingreso" | "retiro";
  importe: number | string;
  motivo: string;
  usuario_id: string;
  fecha: string;
};

function errorCaja(error: unknown): Error {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const raw = error instanceof Error ? error.message
    : typeof error === "string" ? error
    : [code, message, details].filter(Boolean).join(" ");
  if (code === "PGRST205" || /caja_(turnos|ajustes|movimientos)_sigo/i.test(raw) && /not found|schema cache|does not exist|could not find|relation/i.test(raw)) {
    return new Error("La estructura de Caja aún no está disponible en este entorno de pruebas. Aplicá la migración de caja y volvé a cargar.");
  }
  const messages: Array<[string, string]> = [
    ["CASH_SESSION_ALREADY_OPEN", "Ya existe una apertura activa para esta caja."],
    ["CASH_SESSION_REQUIRED", "Abrí la caja antes de registrar ventas o cobros."],
    ["CASH_SESSION_CLOSED", "El turno ya está cerrado. Actualizá la pantalla."],
    ["CASH_DIFFERENCE_REASON_REQUIRED", "Indicá el motivo cuando el arqueo tenga diferencia."],
    ["CASH_WRITE_FORBIDDEN", "Tu usuario no tiene permiso para operar la caja."],
    ["IDEMPOTENCY_CONFLICT", "La operación ya se procesó con otros datos. Actualizá la caja antes de seguir."],
    ["CASH_AMOUNT_INVALID", "El importe debe ser un número válido igual o mayor a cero."],
    ["CASH_REASON_REQUIRED", "Escribí un motivo de al menos 3 caracteres."],
    ["AUTH_REQUIRED", "La sesión venció. Volvé a ingresar a SIGO."],
  ];
  return new Error(messages.find(([knownCode]) => raw.includes(knownCode))?.[1] || raw || "No se pudo completar la operación de caja.");
}

export async function obtenerTurnoAbiertoSigo(empresaId: string, cajaId = "principal"): Promise<CajaTurnoSigo | null> {
  const { data, error } = await supabase.from("caja_turnos_sigo").select("*")
    .eq("empresa_id", empresaId).eq("caja_id", cajaId).eq("estado", "abierta").maybeSingle();
  if (error) throw errorCaja(error);
  return (data as CajaTurnoSigo | null) ?? null;
}

export async function listarTurnosSigo(empresaId: string, limite = 1000): Promise<CajaTurnoSigo[]> {
  const { data, error } = await supabase.from("caja_turnos_sigo").select("*")
    .eq("empresa_id", empresaId).order("fecha_apertura", { ascending: false }).limit(limite);
  if (error) throw errorCaja(error);
  return (data ?? []) as CajaTurnoSigo[];
}

export async function listarMovimientosTurnoSigo(empresaId: string, turnoId: string): Promise<CajaMovimientoSigo[]> {
  const { data, error } = await supabase.from("caja_movimientos_sigo")
    .select("tipo,medio_pago,importe,concepto,created_at")
    .eq("empresa_id", empresaId).eq("turno_id", turnoId).order("created_at", { ascending: true });
  if (error) throw errorCaja(error);
  return (data ?? []) as CajaMovimientoSigo[];
}

export async function listarAjustesTurnoSigo(empresaId: string, turnoId: string): Promise<CajaAjusteSigo[]> {
  const { data, error } = await supabase.from("caja_ajustes_sigo").select("id,tipo,importe,motivo,usuario_id,fecha")
    .eq("empresa_id", empresaId).eq("turno_id", turnoId).order("fecha", { ascending: true });
  if (error) throw errorCaja(error);
  return (data ?? []) as CajaAjusteSigo[];
}

export async function abrirTurnoCajaSigo(empresaId: string, fondoInicial: number, claveIdempotencia: string, cajaId = "principal") {
  const { data, error } = await supabase.rpc("abrir_turno_caja_sigo", {
    p_empresa_id: empresaId, p_fondo_inicial: fondoInicial, p_clave_idempotencia: claveIdempotencia, p_caja_id: cajaId,
  });
  if (error) throw errorCaja(error);
  return String(data ?? "");
}

export async function ajustarEfectivoCajaSigo(input: {
  empresaId: string; turnoId: string; tipo: "ingreso" | "retiro"; importe: number; motivo: string; claveIdempotencia: string;
}) {
  const { data, error } = await supabase.rpc("ajustar_efectivo_caja_sigo", {
    p_empresa_id: input.empresaId, p_turno_id: input.turnoId, p_tipo: input.tipo,
    p_importe: input.importe, p_motivo: input.motivo, p_clave_idempotencia: input.claveIdempotencia,
  });
  if (error) throw errorCaja(error);
  return String(data ?? "");
}

export type ResultadoCierreCajaSigo = {
  turno_id: string;
  efectivo_esperado: number;
  efectivo_contado: number;
  diferencia: number;
};

export async function cerrarTurnoCajaSigo(input: {
  empresaId: string; turnoId: string; efectivoContado: number; motivoDiferencia: string; claveIdempotencia: string;
}): Promise<ResultadoCierreCajaSigo> {
  const { data, error } = await supabase.rpc("cerrar_turno_caja_sigo", {
    p_empresa_id: input.empresaId, p_turno_id: input.turnoId, p_efectivo_contado: input.efectivoContado,
    p_motivo_diferencia: input.motivoDiferencia, p_clave_idempotencia: input.claveIdempotencia,
  });
  if (error) throw errorCaja(error);
  return data as ResultadoCierreCajaSigo;
}
