import { cantidadEscaladaMedida, normalizarRevisionUnidad, normalizarUnidadVenta, type UnidadVenta } from "./ventaPorMedidas";
import type { MedioPagoSigo } from "./ventas";

export type PayloadIntentoCobro = {
  empresaId: string;
  medioPago: MedioPagoSigo;
  clienteId: string | null;
  descuentoPct: number;
  idempotencyKey: string;
  items: { productoId: string; cantidad: number; unidadMedida: UnidadVenta; unidadRevision?: string | null }[];
};
export type IntentoCobro = {
  version: 1;
  estado: "pendiente" | "confirmado" | "rechazado";
  payload: PayloadIntentoCobro;
  huella: string;
  totalEsperado: number;
  creadoEn: string;
  ventaId?: string;
};

type AlmacenCobro = Pick<Storage, "getItem" | "setItem">;
const MEDIOS = ["efectivo", "debito", "credito", "transferencia", "mercado_pago", "cuenta_corriente", "otro"];
const ERROR_LECTURA = "No se pudo leer el intento de cobro guardado. No vuelvas a cobrar: revisá esta venta en Ventas/Informes antes de continuar.";
const ERROR_ESCRITURA = "No se pudo guardar la protección del cobro en este navegador. No se envió un cobro nuevo. Habilitá el almacenamiento de la sesión y reintentá.";
export const claveIntentoCobro = (empresaId: string) => `sigo:intento-cobro:${empresaId}`;

// El orden y cada dato del pedido quedan congelados. La recuperación no usa el carrito,
// precios, cliente o unidades actuales, y nunca conserva una autorización fiscal.
export function huellaPayloadCobro(payload: PayloadIntentoCobro): string {
  return JSON.stringify({ empresaId: payload.empresaId, medioPago: payload.medioPago,
    clienteId: payload.clienteId, descuentoPct: payload.descuentoPct,
    idempotencyKey: payload.idempotencyKey,
    items: payload.items.map(({ productoId, cantidad, unidadMedida, unidadRevision }) => ({ productoId, cantidad, unidadMedida, ...(unidadRevision !== undefined ? { unidadRevision } : {}) })) });
}

function validarIntento(value: unknown, empresaId: string): IntentoCobro {
  if (!value || typeof value !== "object") throw new Error(ERROR_LECTURA);
  const intento = value as IntentoCobro;
  const p = intento.payload;
  if (intento.version !== 1 || !["pendiente", "confirmado", "rechazado"].includes(intento.estado)
    || !p || p.empresaId !== empresaId || !empresaId.trim()
    || typeof p.idempotencyKey !== "string" || !p.idempotencyKey.trim()
    || !MEDIOS.includes(p.medioPago)
    || !(p.clienteId === null || typeof p.clienteId === "string")
    || (p.medioPago === "cuenta_corriente" && !p.clienteId)
    || !Number.isFinite(p.descuentoPct) || p.descuentoPct < 0 || p.descuentoPct >= 100
    || Math.round(p.descuentoPct * 100) / 100 !== p.descuentoPct
    || !Array.isArray(p.items) || !p.items.length
    || !Number.isFinite(intento.totalEsperado) || intento.totalEsperado <= 0
    || typeof intento.creadoEn !== "string" || !Number.isFinite(Date.parse(intento.creadoEn))
    || (intento.estado === "confirmado" && (typeof intento.ventaId !== "string" || !intento.ventaId.trim()))) {
    throw new Error(ERROR_LECTURA);
  }
  for (const item of p.items) {
    if (!item || typeof item.productoId !== "string" || !item.productoId.trim()
      || !item.unidadMedida || normalizarUnidadVenta(item.unidadMedida) !== item.unidadMedida) throw new Error(ERROR_LECTURA);
    if (item.unidadRevision != null && normalizarRevisionUnidad(item.unidadRevision) === null) throw new Error(ERROR_LECTURA);
    try { cantidadEscaladaMedida(item.cantidad, item.unidadMedida); }
    catch { throw new Error(ERROR_LECTURA); }
  }
  if (intento.huella !== huellaPayloadCobro(p)) throw new Error(ERROR_LECTURA);
  return intento;
}

export function leerIntentoCobro(empresaId: string, almacen: AlmacenCobro = sessionStorage): IntentoCobro | null {
  try {
    const raw = almacen.getItem(claveIntentoCobro(empresaId));
    return raw === null ? null : validarIntento(JSON.parse(raw), empresaId);
  } catch { throw new Error(ERROR_LECTURA); }
}

export function crearIntentoCobro(payload: PayloadIntentoCobro, totalEsperado: number): IntentoCobro {
  const copia = JSON.parse(JSON.stringify(payload)) as PayloadIntentoCobro;
  return validarIntento({ version: 1, estado: "pendiente", payload: copia, huella: huellaPayloadCobro(copia),
    totalEsperado, creadoEn: new Date().toISOString() }, payload.empresaId);
}

export function guardarIntentoCobro(intento: IntentoCobro, almacen: AlmacenCobro = sessionStorage): void {
  validarIntento(intento, intento.payload.empresaId);
  const anterior = leerIntentoCobro(intento.payload.empresaId, almacen);
  if (anterior && anterior.payload.idempotencyKey === intento.payload.idempotencyKey && anterior.huella !== intento.huella) {
    throw new Error("La clave del cobro no se puede reutilizar para otro carrito.");
  }
  if (anterior?.estado === "pendiente" && anterior.huella !== intento.huella) {
    throw new Error("Hay un cobro pendiente distinto. Recuperá ese mismo cobro antes de iniciar otra venta; no se enviaron los cambios del carrito.");
  }
  try {
    const raw = JSON.stringify(intento);
    almacen.setItem(claveIntentoCobro(intento.payload.empresaId), raw);
    if (almacen.getItem(claveIntentoCobro(intento.payload.empresaId)) !== raw) throw new Error(ERROR_ESCRITURA);
  } catch { throw new Error(ERROR_ESCRITURA); }
}

export function registrarCobroConfirmado(intento: IntentoCobro, ventaId: string, almacen: AlmacenCobro = sessionStorage): void {
  // Se conserva el UUID aun si falla el puntero opcional de último ticket.
  // Un intento confirmado puede ser reemplazado por una nueva venta, nunca uno pendiente.
  guardarIntentoCobro({ ...intento, estado: "confirmado", ventaId }, almacen);
}

export function registrarCobroRechazado(intento: IntentoCobro, almacen: AlmacenCobro = sessionStorage): void {
  guardarIntentoCobro({ ...intento, estado: "rechazado" }, almacen);
}
