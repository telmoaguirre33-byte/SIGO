import { supabase } from "./supabase";
import { cantidadEscaladaMedida, normalizarRevisionUnidad } from "./ventaPorMedidas";

export type ProveedorSigo = {
  id: string;
  empresa_id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
};

export type CompraSigo = {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  fecha_compra: string;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  subtotal: number;
  total: number;
  estado: string;
  origen: string;
  created_at: string;
};

export type CompraItemInput = {
  producto_id: string;
  cantidad: number;
  costo_unitario: number;
  // Snapshot al seleccionar: nunca completar desde catálogo al confirmar.
  unidad_medida?: string | null;
  unidad_revision?: string | null;
};

export type VerificacionCompraSigo = {
  estado: "OK" | "REVISAR" | "NO_VERIFICADO";
  detalle: string;
};

type ProductoCompraPreflight = {
  id: string;
  nombre: string | null;
  codigo_interno: string | null;
  codigo_barras: string | null;
  stock_actual: number | null;
  costo_actual: number | null;
};

const MAX_COMPRA_ITEMS = 300;
const MAX_CANTIDAD_ITEM = 1_000_000;
const MAX_COSTO_UNITARIO = 1_000_000_000_000;
const PAGINA_PRODUCTOS_PREFLIGHT = 1000;
const MAX_PRODUCTOS_PREFLIGHT = 10000;
const PAGINA_PROVEEDORES = 1000;
const MAX_PROVEEDORES = 10000;

function validarEmailOpcional(email?: string): string | null {
  const limpio = email?.trim() ?? "";
  if (!limpio) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) {
    throw new Error("El email del proveedor no es válido.");
  }
  return limpio;
}

function cuitArgentinoValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, index) => total + Number(cuit[index]) * peso, 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return esperado === Number(cuit[10]);
}

function validarCuitOpcional(cuit?: string): string | null {
  const limpio = cuit?.replace(/\D/g, "") ?? "";
  if (!limpio) return null;
  if (limpio.length !== 11) throw new Error("El CUIT del proveedor debe tener 11 dígitos.");
  if (!cuitArgentinoValido(limpio)) throw new Error("El CUIT del proveedor no supera la validación del dígito verificador.");
  return limpio;
}

function normalizarRazonSocial(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizarDocumento(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizarIdentidadProducto(value?: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function esIdentidadPendienteProducto(producto: Pick<ProductoCompraPreflight, "codigo_interno" | "codigo_barras">): boolean {
  return [producto.codigo_interno, producto.codigo_barras]
    .some((codigo) => String(codigo ?? "").trim().toUpperCase().startsWith("LEGACY-DUP-"));
}

function indexarIdentidadesProductos(
  productos: ProductoCompraPreflight[],
  selector: (producto: ProductoCompraPreflight) => string | null,
): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const producto of productos) {
    const identidad = normalizarIdentidadProducto(selector(producto));
    if (!identidad) continue;
    const ids = mapa.get(identidad) ?? [];
    ids.push(producto.id);
    mapa.set(identidad, ids);
  }
  return mapa;
}

async function leerCatalogoActivoCompra(empresaId: string): Promise<ProductoCompraPreflight[]> {
  const productos: ProductoCompraPreflight[] = [];
  let desde = 0;

  while (desde < MAX_PRODUCTOS_PREFLIGHT) {
    const { data, error } = await supabase
      .from("productos")
      .select("id,nombre,codigo_interno,codigo_barras,stock_actual,costo_actual")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("archivado_comercial", false)
      .range(desde, desde + PAGINA_PRODUCTOS_PREFLIGHT - 1);
    if (error) throw new Error(`No se pudo validar el catálogo antes de confirmar la compra: ${error.message}`);

    const pagina = (data ?? []) as ProductoCompraPreflight[];
    productos.push(...pagina);
    if (pagina.length < PAGINA_PRODUCTOS_PREFLIGHT) return productos;
    desde += PAGINA_PRODUCTOS_PREFLIGHT;
  }

  throw new Error("El catálogo activo supera el límite seguro de prevalidación de compra.");
}

async function verificarProductosCompraAntesDeConfirmar(empresaId: string, items: CompraItemInput[]): Promise<void> {
  const catalogo = await leerCatalogoActivoCompra(empresaId);
  const porId = new Map(catalogo.map((producto) => [producto.id, producto]));
  const porCodigoBarras = indexarIdentidadesProductos(catalogo, (producto) => producto.codigo_barras);
  const porCodigoInterno = indexarIdentidadesProductos(catalogo, (producto) => producto.codigo_interno);

  for (const item of items) {
    const producto = porId.get(item.producto_id);
    if (!producto) {
      throw new Error("Uno de los productos no existe, está inactivo o no pertenece a la empresa activa.");
    }
    if (producto.stock_actual == null || !Number.isFinite(Number(producto.stock_actual))) {
      throw new Error(`El producto "${producto.nombre ?? item.producto_id}" tiene stock inválido o NULL. Corregilo antes de ingresar una compra.`);
    }
    if (producto.costo_actual == null || !Number.isFinite(Number(producto.costo_actual))) {
      throw new Error(`El producto "${producto.nombre ?? item.producto_id}" tiene costo_actual inválido o NULL. Corregilo antes de ingresar una compra.`);
    }
    if (esIdentidadPendienteProducto(producto)) {
      throw new Error(`El producto "${producto.nombre ?? item.producto_id}" tiene una identidad LEGACY-DUP pendiente. Verificá el código físico antes de ingresar stock.`);
    }

    const codigoBarras = normalizarIdentidadProducto(producto.codigo_barras);
    if (codigoBarras && (porCodigoBarras.get(codigoBarras)?.length ?? 0) > 1) {
      throw new Error(`Código de barras ambiguo en "${producto.nombre ?? item.producto_id}". Resolvé el duplicado antes de ingresar stock.`);
    }
    const codigoInterno = normalizarIdentidadProducto(producto.codigo_interno);
    if (codigoInterno && (porCodigoInterno.get(codigoInterno)?.length ?? 0) > 1) {
      throw new Error(`Código interno ambiguo en "${producto.nombre ?? item.producto_id}". Resolvé el duplicado antes de ingresar stock.`);
    }
  }
}

function fechaIsoValida(value?: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  return fecha.getUTCFullYear() === year && fecha.getUTCMonth() === month - 1 && fecha.getUTCDate() === day;
}

function mensajeCompra(raw: string): string {
  if (raw.includes("CORRECTED_PRODUCT_QUANTITY_INVALID")) return "La cantidad debe ser mayor que cero y respetar la precisión de su unidad (como máximo tres decimales). Revisá la cantidad antes de volver a confirmar.";
  if (raw.includes("CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED") || raw.includes("CORRECTED_PRODUCT_REVISION_REVIEW_REQUIRED")) return "Se corrigió la unidad de un producto de esta compra. Actualizá el catálogo, volvé a seleccionar ese producto y revisá cantidad y costo por la nueva unidad antes de confirmar.";
  if (raw.includes("PURCHASE_DOCUMENT_DUPLICATE")) return "Ese comprobante ya fue ingresado para este proveedor. SIGO bloqueó la carga para evitar duplicar stock y costos.";
  if (raw.includes("IDEMPOTENCY_CONFLICT")) return "Esta compra ya fue confirmada con la misma clave pero datos distintos. Actualizá Compras antes de volver a intentar.";
  if (raw.includes("IDEMPOTENCY_KEY_REQUIRED") || raw.includes("IDEMPOTENCY_KEY_INVALID")) return "No se pudo generar una clave segura para confirmar la compra. Reiniciá la carga antes de volver a intentar.";
  if (raw.includes("DUPLICATE_PRODUCT_ITEM")) return "El mismo producto aparece más de una vez. Unificá la cantidad en una sola línea.";
  if (raw.includes("INVALID_ITEM") || raw.includes("INVALID_QUANTITY") || raw.includes("INVALID_COST")) return "Hay una línea de compra con producto, cantidad o costo inválido.";
  if (raw.includes("TOO_MANY_ITEMS")) return "La compra tiene demasiadas líneas para una sola operación. Dividila en más de una compra.";
  if (raw.includes("FORBIDDEN")) return "No tenés permiso para registrar compras.";
  if (raw.includes("STOCK_WRITE_REQUIRED")) return "Tu usuario puede cargar compras pero no modificar stock.";
  if (raw.includes("SUPPLIER_NOT_FOUND")) return "El proveedor no pertenece a la empresa activa.";
  if (raw.includes("PRODUCT_ARCHIVED")) return "El producto está archivado y no admite nuevas compras. Su historial se conserva.";
  if (raw.includes("PRODUCT_NOT_FOUND")) return "Uno de los productos no pertenece a la empresa activa.";
  if (raw.includes("AUTH_REQUIRED")) return "La sesión venció. Volvé a ingresar a SIGO.";
  return raw || "No se pudo confirmar la compra.";
}

export function consolidarItemsCompra(items: CompraItemInput[]): CompraItemInput[] {
  if (items.length > MAX_COMPRA_ITEMS) {
    throw new Error(`La compra supera ${MAX_COMPRA_ITEMS} líneas. Dividila en más de una operación.`);
  }

  const agrupados = new Map<string, { cantidad: number; costoPonderado: number; milesimas?: number; unidad_medida?: string | null; unidad_revision?: string | null }>();

  for (const item of items) {
    const productoId = item.producto_id?.trim();
    const cantidad = Number(item.cantidad);
    const costo = Number(item.costo_unitario);
    if (!productoId) throw new Error("Hay una línea de compra sin producto seleccionado.");
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD_ITEM) {
      throw new Error("Hay una línea de compra con cantidad inválida o fuera del límite operativo.");
    }
    if (!Number.isFinite(costo) || costo < 0 || costo > MAX_COSTO_UNITARIO) {
      throw new Error("Hay una línea de compra con costo inválido o fuera del límite operativo.");
    }

    let milesimas: number | undefined;
    if (item.unidad_medida === "kg") {
      try { milesimas = cantidadEscaladaMedida(cantidad, "kg"); }
      catch { throw new Error("La cantidad en kg debe tener como máximo tres decimales; no se redondeará automáticamente."); }
    }

    if (item.unidad_revision != null && normalizarRevisionUnidad(item.unidad_revision) === null) {
      throw new Error("La revisión de unidad no es válida. Volvé a seleccionar el producto.");
    }
    const guardado = agrupados.get(productoId);
    if (guardado && (guardado.unidad_revision ?? null) !== (item.unidad_revision ?? null)) {
      throw new Error("El mismo producto tiene revisiones de unidad diferentes. Volvé a seleccionarlo antes de unificar cantidades.");
    }
    // null y undefined representan ausencia, nunca una unidad inferida.
    if (guardado && (guardado.unidad_medida ?? null) !== (item.unidad_medida ?? null)) {
      throw new Error("El mismo producto tiene unidades diferentes o una línea sin unidad. Revisá y volvé a seleccionar el producto antes de unificar cantidades.");
    }
    const previo = guardado ?? { cantidad: 0, costoPonderado: 0, unidad_medida: item.unidad_medida, unidad_revision: item.unidad_revision };
    // Sumar kg en enteros evita enviar 0.1 + 0.2 como 0.30000000000000004.
    // Para líneas legacy sin unidad se conserva exactamente el contrato anterior.
    const milesimasAcumuladas = milesimas === undefined ? undefined : (guardado?.milesimas ?? 0) + milesimas;
    const cantidadAcumulada = milesimasAcumuladas === undefined ? previo.cantidad + cantidad : milesimasAcumuladas / 1000;
    const costoPonderado = previo.costoPonderado + cantidad * costo;
    if (!Number.isFinite(cantidadAcumulada) || !Number.isFinite(costoPonderado) || cantidadAcumulada > MAX_CANTIDAD_ITEM) {
      throw new Error("La compra supera los valores numéricos permitidos.");
    }
    agrupados.set(productoId, { cantidad: cantidadAcumulada, costoPonderado, milesimas: milesimasAcumuladas, unidad_medida: previo.unidad_medida, unidad_revision: previo.unidad_revision });
  }

  return [...agrupados.entries()].map(([producto_id, valor]) => ({
    producto_id,
    ...(valor.unidad_medida !== undefined ? { unidad_medida: valor.unidad_medida } : {}),
    ...(valor.unidad_revision !== undefined ? { unidad_revision: valor.unidad_revision } : {}),
    cantidad: valor.cantidad,
    costo_unitario: valor.cantidad > 0 ? valor.costoPonderado / valor.cantidad : 0,
  }));
}

export async function listarProveedoresSigo(empresaId: string): Promise<ProveedorSigo[]> {
  const empresaNormalizada = empresaId.trim();
  if (!empresaNormalizada) return [];
  const proveedores: ProveedorSigo[] = [];

  for (let desde = 0; desde < MAX_PROVEEDORES; desde += PAGINA_PROVEEDORES) {
    const { data, error } = await supabase
      .from("proveedores_sigo")
      .select("id,empresa_id,razon_social,nombre_fantasia,cuit,telefono,email,direccion,activo")
      .eq("empresa_id", empresaNormalizada)
      .eq("activo", true)
      .eq("archivado_comercial", false)
      .order("razon_social", { ascending: true })
      .range(desde, desde + PAGINA_PROVEEDORES - 1);
    if (error) throw error;
    const pagina = (data ?? []) as ProveedorSigo[];
    proveedores.push(...pagina);
    if (pagina.length < PAGINA_PROVEEDORES) return proveedores;
  }

  throw new Error("El maestro de proveedores supera el límite seguro de 10.000 registros activos.");
}

export async function guardarProveedorSigo(input: {
  empresaId: string;
  razonSocial: string;
  cuit?: string;
  telefono?: string;
  email?: string;
}): Promise<ProveedorSigo> {
  const razonSocial = input.razonSocial.trim();
  if (!razonSocial) throw new Error("La razón social es obligatoria.");
  const empresaId = input.empresaId?.trim() ?? "";
  if (!empresaId) throw new Error("No hay una empresa activa válida.");
  const cuit = validarCuitOpcional(input.cuit);
  const identidadNombre = normalizarRazonSocial(razonSocial);
  const existentes = await listarProveedoresSigo(empresaId);

  const porCuit = cuit
    ? existentes.filter((proveedor) => String(proveedor.cuit ?? "").replace(/\D/g, "") === cuit)
    : [];
  if (porCuit.length > 1) {
    throw new Error("El CUIT ya está asociado a más de un proveedor activo. Resolvé el duplicado antes de continuar.");
  }
  if (porCuit.length === 1) {
    const existente = porCuit[0];
    if (normalizarRazonSocial(existente.razon_social) !== identidadNombre) {
      throw new Error(`El CUIT ingresado ya pertenece a "${existente.razon_social}". Revisá la identidad del proveedor antes de guardar.`);
    }
    return existente;
  }

  const porNombre = existentes.filter((proveedor) => normalizarRazonSocial(proveedor.razon_social) === identidadNombre);
  if (porNombre.length > 1) {
    throw new Error("La razón social ya coincide con más de un proveedor activo. Resolvé el duplicado antes de continuar.");
  }
  if (porNombre.length === 1) {
    const existente = porNombre[0];
    const cuitExistente = String(existente.cuit ?? "").replace(/\D/g, "");
    if (cuit && cuitExistente && cuitExistente !== cuit) {
      throw new Error(`La razón social "${razonSocial}" ya existe con otro CUIT. Revisá el proveedor antes de guardar.`);
    }
    if (cuit && !cuitExistente) {
      const { data: actualizado, error: updateError } = await supabase
        .from("proveedores_sigo")
        .update({ cuit })
        .eq("id", existente.id)
        .eq("empresa_id", empresaId)
        .eq("activo", true)
      .eq("archivado_comercial", false)
        .select("id,empresa_id,razon_social,nombre_fantasia,cuit,telefono,email,direccion,activo")
        .single();
      if (updateError) throw updateError;
      return actualizado as ProveedorSigo;
    }
    return existente;
  }

  const { data, error } = await supabase
    .from("proveedores_sigo")
    .insert({
      empresa_id: empresaId,
      razon_social: razonSocial,
      cuit,
      telefono: input.telefono?.trim() || null,
      email: validarEmailOpcional(input.email),
      activo: true,
    })
    .select("id,empresa_id,razon_social,nombre_fantasia,cuit,telefono,email,direccion,activo")
    .single();
  if (error) throw error;
  return data as ProveedorSigo;
}

export async function listarComprasSigo(empresaId: string): Promise<CompraSigo[]> {
  const empresaNormalizada = empresaId.trim();
  if (!empresaNormalizada) return [];
  const { data, error } = await supabase
    .from("compras_sigo")
    .select("id,empresa_id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,subtotal,total,estado,origen,created_at")
    .eq("empresa_id", empresaNormalizada)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as CompraSigo[];
}

export async function confirmarCompraSigo(input: {
  empresaId: string;
  proveedorId: string;
  items: CompraItemInput[];
  fecha?: string;
  tipoComprobante?: string;
  numeroComprobante?: string;
  idempotencyKey: string;
  origen?: "manual" | "ia";
}): Promise<string> {
  const empresaId = input.empresaId?.trim() ?? "";
  const proveedorId = input.proveedorId?.trim() ?? "";
  const idempotencyKey = input.idempotencyKey?.trim() ?? "";
  const tipoComprobante = input.tipoComprobante?.trim() || null;
  const numeroComprobante = input.numeroComprobante?.trim() || null;
  if (!empresaId) throw new Error("No hay una empresa activa válida.");
  if (!proveedorId) throw new Error("Seleccioná un proveedor.");
  if (!idempotencyKey) throw new Error("No se pudo generar una clave segura para confirmar la compra.");
  if (!fechaIsoValida(input.fecha)) throw new Error("La fecha de la compra no es válida.");

  const items = consolidarItemsCompra(input.items);
  if (items.length === 0) throw new Error("Agregá al menos un producto válido.");

  // Preflight UX: detecta también variantes de escritura del mismo comprobante.
  // El backend vuelve a validarlo de forma atómica antes de tocar stock/costos.
  const documentoNormalizado = normalizarDocumento(numeroComprobante);
  if (documentoNormalizado) {
    const { data: candidatas, error: duplicadaError } = await supabase
      .from("compras_sigo")
      .select("id,tipo_comprobante,numero_comprobante")
      .eq("empresa_id", empresaId)
      .eq("proveedor_id", proveedorId)
      .eq("estado", "confirmada")
      .order("created_at", { ascending: false })
      .limit(200);
    if (duplicadaError) throw duplicadaError;

    const tipoNormalizado = normalizarDocumento(tipoComprobante);
    const duplicada = (candidatas ?? []).some((compra) => {
      const mismoNumero = normalizarDocumento(compra.numero_comprobante) === documentoNormalizado;
      const tipoGuardado = normalizarDocumento(compra.tipo_comprobante);
      const mismoTipo = !tipoNormalizado || !tipoGuardado || tipoGuardado === tipoNormalizado;
      return mismoNumero && mismoTipo;
    });
    if (duplicada) {
      throw new Error("Ese comprobante ya fue ingresado para este proveedor. SIGO bloqueó la carga para evitar duplicar stock y costos.");
    }
  }

  // Última barrera de lectura antes del único RPC que modifica compra/stock/costos.
  // Evita dirigir stock a productos inactivos, con valores operativos NULL o identidades ambiguas.
  await verificarProductosCompraAntesDeConfirmar(empresaId, items);

  const { data, error } = await supabase.rpc("confirmar_compra_sigo", {
    p_empresa_id: empresaId,
    p_proveedor_id: proveedorId,
    p_items: items,
    p_fecha: input.fecha || null,
    p_tipo_comprobante: tipoComprobante,
    p_numero_comprobante: numeroComprobante,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(mensajeCompra(error.message || "No se pudo confirmar la compra."));
  const compraId = String(data ?? "").trim();
  if (!compraId) throw new Error("La compra no devolvió comprobante. No la repitas hasta verificar su estado.");
  const origen = input.origen === "ia" ? "ia" : "manual";
  const { error: origenError } = await supabase.from("compras_sigo").update({ origen }).eq("id", compraId).eq("empresa_id", empresaId);
  if (origenError) console.warn("No se pudo registrar origen de compra", origenError.message);
  return compraId;
}

export async function verificarCompraSigo(input: {
  empresaId: string;
  compraId: string;
  items: CompraItemInput[];
  stockAntes: Record<string, number>;
}): Promise<VerificacionCompraSigo> {
  try {
    const items = consolidarItemsCompra(input.items);
    if (items.length === 0) return { estado: "REVISAR", detalle: "No hay ítems válidos para conciliar la compra." };

    const productoIds = [...new Set(items.map((item) => item.producto_id))];
    const [{ data: compra, error: compraError }, { data: detalles, error: detalleError }, { data: productos, error: productoError }] = await Promise.all([
      supabase
        .from("compras_sigo")
        .select("id,empresa_id,estado")
        .eq("id", input.compraId)
        .eq("empresa_id", input.empresaId)
        .maybeSingle(),
      supabase
        .from("compra_items_sigo")
        .select("producto_id,cantidad,costo_unitario")
        .eq("compra_id", input.compraId)
        .eq("empresa_id", input.empresaId),
      supabase
        .from("productos")
        .select("id,empresa_id,nombre,stock_actual,costo_actual,costo_ultima_compra,precio_venta")
        .eq("empresa_id", input.empresaId)
        .in("id", productoIds),
    ]);

    if (compraError || detalleError || productoError) {
      return { estado: "NO_VERIFICADO", detalle: "La compra fue confirmada, pero no se pudo completar la conciliación de stock." };
    }
    if (!compra || compra.estado !== "confirmada") {
      return { estado: "REVISAR", detalle: "No aparece la cabecera confirmada de la compra en la empresa activa." };
    }

    const detalleMap = new Map((detalles ?? []).map((d) => [String(d.producto_id), d]));
    const productoMap = new Map((productos ?? []).map((p) => [String(p.id), p]));
    const sinPrecioVenta: string[] = [];

    for (const item of items) {
      const detalle = detalleMap.get(item.producto_id);
      const producto = productoMap.get(item.producto_id);
      if (!detalle || !producto) {
        return { estado: "REVISAR", detalle: "Falta el detalle de compra o el producto conciliado." };
      }
      if (producto.stock_actual == null || !Number.isFinite(Number(producto.stock_actual))) {
        return { estado: "REVISAR", detalle: "El stock persistido quedó NULL o inválido después de confirmar la compra." };
      }
      if (producto.costo_actual == null || !Number.isFinite(Number(producto.costo_actual))) {
        return { estado: "REVISAR", detalle: "El costo_actual persistido quedó NULL o inválido después de confirmar la compra." };
      }
      const stockAntesValor = input.stockAntes[item.producto_id];
      if (stockAntesValor == null || !Number.isFinite(Number(stockAntesValor))) {
        return { estado: "REVISAR", detalle: "No hay una lectura válida del stock anterior para conciliar la compra." };
      }

      const cantidadDetalle = Number(detalle.cantidad ?? 0);
      const costoDetalle = Number(detalle.costo_unitario ?? 0);
      const stockEsperado = Number(stockAntesValor) + Number(item.cantidad);
      const stockActual = Number(producto.stock_actual);
      const costoActual = Number(producto.costo_actual);
      const precioVenta = Number(producto.precio_venta ?? 0);

      if (Math.abs(cantidadDetalle - Number(item.cantidad)) > 0.0001 || Math.abs(costoDetalle - Number(item.costo_unitario)) > 0.0001) {
        return { estado: "REVISAR", detalle: "El detalle grabado no coincide con cantidades/costos enviados." };
      }
      if (Math.abs(stockActual - stockEsperado) > 0.0001) {
        return { estado: "REVISAR", detalle: `Stock inconsistente: esperado ${stockEsperado}, actual ${stockActual}.` };
      }
      if (Math.abs(costoActual - Number(item.costo_unitario)) > 0.0001) {
        return { estado: "REVISAR", detalle: "El último costo del producto no coincide con la compra confirmada." };
      }
      if (!Number.isFinite(precioVenta) || precioVenta <= 0) {
        sinPrecioVenta.push(String(producto.nombre ?? item.producto_id));
      }
    }

    if (sinPrecioVenta.length > 0) {
      const muestra = sinPrecioVenta.slice(0, 3).join(", ");
      const resto = sinPrecioVenta.length > 3 ? ` y ${sinPrecioVenta.length - 3} más` : "";
      return {
        estado: "REVISAR",
        detalle: `Compra y stock conciliados, pero ${sinPrecioVenta.length} producto${sinPrecioVenta.length === 1 ? "" : "s"} todavía no tiene${sinPrecioVenta.length === 1 ? "" : "n"} precio de venta válido: ${muestra}${resto}. Definí precio antes de vender.`,
      };
    }

    return { estado: "OK", detalle: "Compra, detalle, stock, último costo y preparación para venta conciliados correctamente." };
  } catch {
    return { estado: "NO_VERIFICADO", detalle: "La compra fue confirmada, pero la verificación posterior no pudo ejecutarse." };
  }
}
