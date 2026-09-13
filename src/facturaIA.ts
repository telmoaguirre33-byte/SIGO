import { supabase } from "./supabase";

export type FacturaItemIA = {
  descripcion: string;
  codigo: string | null;
  codigo_barras: string | null;
  cantidad: number;
  costo_unitario: number;
  total_linea: number | null;
  confianza: number;
};

export type FacturaCompraIA = {
  proveedor: {
    razon_social: string | null;
    cuit: string | null;
  };
  fecha: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  moneda: string | null;
  total: number | null;
  confianza_general: number;
  items: FacturaItemIA[];
  advertencias: string[];
};

const TIPOS_IMAGEN_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const MAX_INVOICE_ITEMS = 300;
const CLIENT_TIMEOUT_MS = 55_000;

function leerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen de la factura."));
    reader.readAsDataURL(blob);
  });
}

async function comprimirImagen(file: File): Promise<string> {
  if (!TIPOS_IMAGEN_PERMITIDOS.has(file.type)) throw new Error("Usá una foto o imagen JPG, PNG o WebP de la factura.");
  if (file.size <= 0) throw new Error("La imagen de la factura está vacía.");
  if (file.size > 15 * 1024 * 1024) throw new Error("La imagen supera 15 MB. Tomá una foto más liviana.");

  const original = await leerComoDataUrl(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo abrir la imagen de la factura."));
    img.src = original;
  });

  if (!Number.isFinite(img.naturalWidth) || !Number.isFinite(img.naturalHeight) || img.naturalWidth < 320 || img.naturalHeight < 320) {
    throw new Error("La foto es demasiado chica para leer una factura con seguridad. Tomá otra más cerca y nítida.");
  }

  const max = 1800;
  const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * escala));
  const height = Math.max(1, Math.round(img.naturalHeight * escala));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function normalizarMoneda(value: unknown): string | null {
  if (value == null) return null;
  const moneda = String(value).trim().toUpperCase().replace(/\s+/g, "");
  if (!moneda) return null;
  if (["ARS", "$", "AR$", "PESO", "PESOS", "PESOSARGENTINOS"].includes(moneda)) return "ARS";
  if (["USD", "US$", "U$S", "DOLAR", "DOLARES", "DÓLAR", "DÓLARES"].includes(moneda)) return "USD";
  return moneda.slice(0, 12);
}

function cuitArgentinoValido(value: unknown): boolean {
  const cuit = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, index) => total + Number(cuit[index]) * peso, 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return esperado === Number(cuit[10]);
}

function gtinValido(value: string): boolean | null {
  const codigo = value.replace(/[\s-]+/g, "");
  if (!/^\d+$/.test(codigo) || !GTIN_LENGTHS.has(codigo.length)) return null;
  const cuerpo = codigo.slice(0, -1);
  const digito = Number(codigo.at(-1));
  let suma = 0;
  let peso = 3;
  for (let index = cuerpo.length - 1; index >= 0; index -= 1) {
    suma += Number(cuerpo[index]) * peso;
    peso = peso === 3 ? 1 : 3;
  }
  return ((10 - (suma % 10)) % 10) === digito;
}

function normalizarCodigoBarras(value: unknown): string | null {
  if (value == null) return null;
  const codigo = String(value).trim().replace(/[\s-]+/g, "");
  if (!codigo) return null;
  return gtinValido(codigo) === false ? null : codigo.slice(0, 80);
}

function normalizarCodigoProveedor(value: unknown): string | null {
  if (value == null) return null;
  const codigo = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);
  return codigo || null;
}

function normalizarDescripcion(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fechaIsoCalendarioValida(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  return fecha.getUTCFullYear() === year && fecha.getUTCMonth() === month - 1 && fecha.getUTCDate() === day;
}

function validarCodigosNoAmbiguos(items: FacturaItemIA[]) {
  const porCodigo = new Map<string, Set<string>>();
  for (const item of items) {
    const codigos = new Set([item.codigo_barras, item.codigo]
      .filter(Boolean)
      .map((codigo) => String(codigo).trim().toUpperCase())
      .filter(Boolean));
    for (const clave of codigos) {
      const nombres = porCodigo.get(clave) ?? new Set<string>();
      nombres.add(normalizarDescripcion(item.descripcion));
      porCodigo.set(clave, nombres);
    }
  }
  if ([...porCodigo.values()].some((nombres) => nombres.size > 1)) {
    throw new Error("La factura contiene un mismo código asociado a productos distintos. Revisá esas líneas manualmente antes de ingresar stock.");
  }
}

function validarFactura(data: unknown): FacturaCompraIA {
  if (!data || typeof data !== "object") throw new Error("La IA no devolvió una factura válida.");
  const factura = data as Partial<FacturaCompraIA>;
  const items = Array.isArray(factura.items) ? factura.items : [];
  if (items.length > MAX_INVOICE_ITEMS) {
    throw new Error(`La factura contiene más de ${MAX_INVOICE_ITEMS} líneas. Dividí la carga o ingresala manualmente para evitar una compra parcial.`);
  }

  const validos = items
    .map((item) => item as Partial<FacturaItemIA>)
    .filter((item) => typeof item.descripcion === "string" && item.descripcion.trim())
    .map((item) => ({
      descripcion: String(item.descripcion).trim(),
      codigo: normalizarCodigoProveedor(item.codigo),
      codigo_barras: normalizarCodigoBarras(item.codigo_barras),
      cantidad: Number(item.cantidad ?? 0),
      costo_unitario: Number(item.costo_unitario ?? 0),
      total_linea: item.total_linea == null ? null : Number(item.total_linea),
      confianza: Math.max(0, Math.min(1, Number(item.confianza ?? 0))),
    }))
    .filter((item) => Number.isFinite(item.cantidad) && item.cantidad > 0 && Number.isFinite(item.costo_unitario) && item.costo_unitario >= 0);

  if (validos.length === 0) throw new Error("No pude reconocer productos con cantidad y costo válidos. Probá con otra foto más nítida.");
  validarCodigosNoAmbiguos(validos);

  const proveedor = (
    factura.proveedor && typeof factura.proveedor === "object"
      ? factura.proveedor
      : {}
  ) as Partial<FacturaCompraIA["proveedor"]>;

  const moneda = normalizarMoneda(factura.moneda);
  if (moneda && moneda !== "ARS") {
    throw new Error(`La factura fue detectada en ${moneda}. SIGO no la aplicará automáticamente como pesos; cargala manualmente o convertí los importes antes de ingresar stock.`);
  }

  const advertenciasCliente: string[] = [];
  const totalLeido = factura.total == null ? null : Number(factura.total);
  const total = totalLeido != null && Number.isFinite(totalLeido) && totalLeido >= 0 ? totalLeido : null;
  const cuitLeido = proveedor.cuit ? String(proveedor.cuit).replace(/\D/g, "") : "";
  const fechaLeida = factura.fecha ? String(factura.fecha).trim() : "";
  const fecha = fechaLeida && fechaIsoCalendarioValida(fechaLeida) ? fechaLeida : null;
  if (fechaLeida && !fecha) {
    advertenciasCliente.push("La fecha leída no es una fecha calendario válida; revisala antes de confirmar la compra.");
  }

  const bajaConfianza = validos.filter((item) => item.confianza < 0.5).length;
  if (bajaConfianza > 0) {
    advertenciasCliente.push(`${bajaConfianza} línea${bajaConfianza === 1 ? "" : "s"} tiene${bajaConfianza === 1 ? "" : "n"} confianza menor al 50%; revisá cantidad, costo y producto antes de ingresar stock.`);
  }

  if (total != null) {
    const sumaLineas = validos.reduce((suma, item) => {
      const totalLinea = item.total_linea;
      const calculado = item.cantidad * item.costo_unitario;
      return suma + (totalLinea != null && Number.isFinite(totalLinea) && totalLinea >= 0 ? totalLinea : calculado);
    }, 0);
    if (sumaLineas > 0) {
      const diferencia = Math.abs(total - sumaLineas);
      const tolerancia = Math.max(20, total * 0.05);
      if (diferencia > tolerancia) {
        advertenciasCliente.push("El total de la factura difiere de la suma de las líneas leídas. Revisá impuestos, descuentos y productos antes de confirmar.");
      }
    }
  }

  return {
    proveedor: {
      razon_social: proveedor.razon_social ? String(proveedor.razon_social).trim() : null,
      cuit: cuitArgentinoValido(cuitLeido) ? cuitLeido : null,
    },
    fecha,
    tipo_comprobante: factura.tipo_comprobante ? String(factura.tipo_comprobante).trim() : null,
    numero_comprobante: factura.numero_comprobante ? String(factura.numero_comprobante).trim() : null,
    moneda: moneda ?? "ARS",
    total,
    confianza_general: Math.max(0, Math.min(1, Number(factura.confianza_general ?? 0))),
    items: validos,
    advertencias: [...new Set([
      ...(Array.isArray(factura.advertencias)
        ? factura.advertencias.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
        : []),
      ...advertenciasCliente,
    ])].slice(0, 30),
  };
}

export async function analizarFacturaCompraSigo(empresaId: string, file: File): Promise<FacturaCompraIA> {
  if (!empresaId) throw new Error("No hay empresa activa para analizar la factura.");
  const imageDataUrl = await comprimirImagen(file);
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("La sesión venció. Volvé a ingresar a SIGO.");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("/api/compras/analizar-factura", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ empresaId, imageDataUrl }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La lectura de la factura tardó demasiado. Probá otra vez con una foto más nítida.");
    }
    throw new Error("No se pudo conectar con el analizador de facturas. Revisá la conexión e intentá nuevamente.");
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.error ?? "");
    if (code === "AI_NOT_CONFIGURED") throw new Error("La IA de facturas todavía no tiene configurada su clave en producción.");
    if (code === "FORBIDDEN") throw new Error("Tu usuario no tiene permiso para ingresar compras en esta empresa.");
    if (code === "INVALID_IMAGE") throw new Error("La foto no tiene un formato válido o es demasiado pesada.");
    if (code === "AI_TIMEOUT") throw new Error("La lectura de la factura tardó demasiado. Probá nuevamente con una foto más nítida.");
    if (code === "AI_UNAVAILABLE") throw new Error("El servicio de lectura de facturas no está disponible en este momento. La compra manual sigue funcionando.");
    if (code === "AI_REVIEW_REQUIRED") throw new Error(String(payload?.message ?? "La factura necesita revisión manual antes de ingresar stock."));
    if (code === "AI_INVALID_OUTPUT") throw new Error("La IA no pudo interpretar la factura con seguridad. Probá con otra foto o cargá la compra manualmente.");
    throw new Error(String(payload?.message ?? payload?.error ?? "No se pudo analizar la factura con IA."));
  }

  return validarFactura(payload?.factura);
}
