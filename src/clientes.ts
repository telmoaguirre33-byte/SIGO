import { supabase } from "./supabase";

export type ClienteSigo = {
  id: string;
  empresa_id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  limite_credito: number | null;
  saldo_actual: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type ClienteInput = {
  id?: string | null;
  empresaId: string;
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  limiteCredito?: number | null;
};

export type MedioCobroSigo = "efectivo" | "debito" | "credito" | "transferencia" | "otro";

function texto(valor?: string | null) {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

function validarEmail(email?: string | null) {
  const limpio = texto(email);
  if (!limpio) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) throw new Error("Ingresá un email válido.");
  return limpio;
}

function validarLimiteCredito(valor?: number | null) {
  if (valor == null) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) throw new Error("El límite de crédito debe ser un importe válido y no negativo.");
  return numero;
}

function mensajeCobro(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  if (raw.includes("PAYMENT_EXCEEDS_BALANCE")) return "El cobro no puede superar el saldo pendiente del cliente.";
  if (raw.includes("CLIENT_WITHOUT_DEBT")) return "El cliente ya no tiene deuda pendiente.";
  if (raw.includes("PAYMENT_AMOUNT_INVALID")) return "Ingresá un importe de cobro válido.";
  if (raw.includes("PAYMENT_METHOD_INVALID")) return "Seleccioná un medio de cobro válido.";
  if (raw.includes("CLIENT_NOT_FOUND")) return "El cliente ya no está disponible en esta empresa.";
  if (raw.includes("CLIENTS_WRITE_FORBIDDEN")) return "Tu usuario no tiene permiso para registrar cobros de clientes.";
  if (raw.includes("SALES_WRITE_FORBIDDEN")) return "Tu usuario no tiene permiso para registrar ingresos de caja.";
  if (raw.includes("AUTH_REQUIRED")) return "La sesión venció. Volvé a ingresar a SIGO.";
  return raw || "No se pudo registrar el cobro.";
}

export async function listarClientesSigo(empresaId: string): Promise<ClienteSigo[]> {
  if (!empresaId) return [];
  const { data, error } = await supabase
    .from("clientes_sigo")
    .select("id,empresa_id,nombre,documento,telefono,email,direccion,limite_credito,saldo_actual,activo,created_at,updated_at")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ClienteSigo[];
}

export async function guardarClienteSigo(input: ClienteInput): Promise<ClienteSigo> {
  if (!input.empresaId) throw new Error("Seleccioná una empresa activa.");
  if (!input.nombre.trim()) throw new Error("El nombre del cliente es obligatorio.");

  const payload = {
    empresa_id: input.empresaId,
    nombre: input.nombre.trim(),
    documento: texto(input.documento),
    telefono: texto(input.telefono),
    email: validarEmail(input.email),
    direccion: texto(input.direccion),
    limite_credito: validarLimiteCredito(input.limiteCredito),
    updated_at: new Date().toISOString(),
  };

  const consulta = input.id
    ? supabase.from("clientes_sigo").update(payload).eq("empresa_id", input.empresaId).eq("id", input.id)
    : supabase.from("clientes_sigo").insert(payload);

  const { data, error } = await consulta.select("id,empresa_id,nombre,documento,telefono,email,direccion,limite_credito,saldo_actual,activo,created_at,updated_at").single();
  if (error) throw error;
  return data as ClienteSigo;
}

export async function registrarCobroClienteSigo(input: {
  empresaId: string;
  clienteId: string;
  importe: number;
  medioPago: MedioCobroSigo;
  concepto?: string;
}): Promise<string> {
  if (!input.empresaId) throw new Error("Seleccioná una empresa activa.");
  if (!input.clienteId) throw new Error("Seleccioná un cliente.");
  if (!Number.isFinite(input.importe) || input.importe <= 0) throw new Error("Ingresá un importe de cobro válido.");

  const mediosValidos: MedioCobroSigo[] = ["efectivo", "debito", "credito", "transferencia", "otro"];
  if (!mediosValidos.includes(input.medioPago)) throw new Error("Seleccioná un medio de cobro válido.");

  const { data, error } = await supabase.rpc("registrar_cobro_cliente_sigo_v2", {
    p_empresa_id: input.empresaId,
    p_cliente_id: input.clienteId,
    p_importe: input.importe,
    p_medio_pago: input.medioPago,
    p_concepto: input.concepto?.trim() || "Cobro cuenta corriente",
  });

  if (error) throw new Error(mensajeCobro(error));
  if (!data) throw new Error("El cobro no devolvió comprobante. Verificá la cuenta antes de repetirlo.");
  return String(data);
}
