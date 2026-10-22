import { supabase } from "./supabase";
import { cantidadEscaladaMedida, normalizarUnidadVenta, type UnidadVenta } from "./ventaPorMedidas";

export type ProductoSigo = {
  id: string;
  empresa_id: string;
  codigo_interno: string | null;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  marca: string | null;
  proveedor: string | null;
  costo_actual: number | null;
  costo_ultima_compra: number | null;
  precio_venta: number | null;
  margen_ganancia: number | null;
  margen_porcentaje: number | null;
  stock_actual: number | null;
  stock_minimo: number | null;
  stock_maximo: number | null;
  unidad_medida?: UnidadVenta | null;
};

export type GuardarProductoSigoInput = {
  empresaId: string;
  productoId?: string | null;
  codigoInterno?: string | null;
  codigoBarras?: string | null;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  marca?: string | null;
  proveedor?: string | null;
  costoActual?: number | null;
  costoUltimaCompra?: number | null;
  precioVenta?: number | null;
  margenGanancia?: number | null;
  margenPorcentaje?: number | null;
  stockActual?: number | null;
  stockMinimo?: number | null;
  stockMaximo?: number | null;
  unidadMedida?: UnidadVenta | null;
};

type ProductoGuardadoReadback = {
  id: string;
  empresa_id: string;
  nombre: string;
  codigo_interno: string | null;
  codigo_barras: string | null;
  costo_actual: number | null;
  costo_ultima_compra: number | null;
  precio_venta: number | null;
  stock_actual: number | null;
  activo: boolean;
};

function normalizarTexto(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validarNumeroNoNegativo(nombre: string, valor?: number | null) {
  if (valor == null) return;
  if (!Number.isFinite(valor) || valor < 0) throw new Error(`${nombre}_INVALID`);
}

function validarProducto(input: GuardarProductoSigoInput) {
  if (input.unidadMedida != null && normalizarUnidadVenta(input.unidadMedida) !== input.unidadMedida) {
    throw new Error("Unidad de venta inválida.");
  }
  const unidadStockValidacion = input.productoId ? "kg" : input.unidadMedida ?? "unidad";
  for (const stock of [input.stockActual, input.stockMinimo, input.stockMaximo]) {
    if (stock != null) {
      try { cantidadEscaladaMedida(stock, unidadStockValidacion, true); }
      catch { throw new Error(input.productoId ? "El stock admite hasta tres decimales." : "El stock inicial debe respetar la precisión de la unidad elegida."); }
    }
  }
  validarNumeroNoNegativo("COSTO_ACTUAL", input.costoActual);
  validarNumeroNoNegativo("COSTO_ULTIMA_COMPRA", input.costoUltimaCompra);
  if (input.precioVenta != null && (!Number.isFinite(input.precioVenta) || input.precioVenta <= 0)) {
    throw new Error("El precio de venta debe ser mayor a cero.");
  }
  validarNumeroNoNegativo("MARGEN_GANANCIA", input.margenGanancia);
  validarNumeroNoNegativo("MARGEN_PORCENTAJE", input.margenPorcentaje);
  validarNumeroNoNegativo("STOCK_ACTUAL", input.stockActual);
  validarNumeroNoNegativo("STOCK_MINIMO", input.stockMinimo);
  validarNumeroNoNegativo("STOCK_MAXIMO", input.stockMaximo);

  if (input.stockMinimo != null && input.stockMaximo != null && input.stockMaximo < input.stockMinimo) {
    throw new Error("STOCK_RANGE_INVALID");
  }
  if (input.stockActual != null && input.stockMaximo != null && input.stockActual > input.stockMaximo) {
    throw new Error("STOCK_ABOVE_MAXIMUM");
  }
}

function mensajeErrorBackend(error: unknown, fallback: string) {
  const original = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : error instanceof Error ? error.message : String(error ?? "");

  if (original.includes("UNIT_CHANGE_REQUIRES_ZERO_STOCK")) return "No se puede cambiar la unidad mientras el producto tenga stock. No se guardaron los cambios.";
  if (original.includes("UNIT_CHANGE_REQUIRES_HISTORY_REVIEW")) return "No se puede cambiar la unidad de un producto con movimientos. Revisá su historial; no se guardaron los cambios.";
  if (original.includes("PRODUCT_STOCK_INVALID")) return "El stock o sus límites no respetan la precisión de la unidad. Los valores históricos sólo pueden conservarse sin cambiarlos; revisá la cantidad ingresada.";
  if (original.includes("PRODUCT_VALUE_INVALID")) return "El precio, costo o margen debe ser un número válido y no negativo.";
  if (original.includes("PRODUCT_UNIT_INVALID") || original.includes("UNIDAD_INVALIDA") || original.includes("UNIT_INVALID")) return "La unidad del producto no es válida. Revisala antes de vender.";
  if (original.includes("guardar_producto_medida_sigo") && (original.includes("Could not find") || original.includes("does not exist"))) return "La base de datos todavía no tiene habilitado el guardado seguro por unidad. No se guardó el producto.";
  if (original.includes("PRODUCT_HAS_STOCK")) {
    return "No se puede dar de baja el producto mientras tenga stock. Dejá el stock en cero mediante el circuito operativo antes de desactivarlo.";
  }
  if (original.includes("BARCODE_DUPLICATE_IN_COMPANY")) {
    return "Ese código de barras ya está asignado a otro producto de esta empresa.";
  }
  if (original.includes("INTERNAL_CODE_DUPLICATE_IN_COMPANY")) {
    return "Ese código interno ya está asignado a otro producto de esta empresa.";
  }
  if (original.includes("PRODUCT_NOT_FOUND_IN_TENANT")) {
    return "El producto no pertenece a la empresa activa o ya no está disponible.";
  }
  if (original.includes("PRODUCT_SAVE_NOT_VISIBLE")) {
    return "SIGO guardó la operación pero no pudo volver a encontrar el producto en la empresa activa. No repitas el alta hasta revisar su estado.";
  }
  if (
    original.includes("PRODUCT_SAVE_CURRENT_COST_INVALID") ||
    original.includes("PRODUCT_SAVE_LAST_COST_INVALID") ||
    original.includes("PRODUCT_SAVE_STOCK_INVALID") ||
    original.includes("PRODUCT_SAVE_PRICE_INVALID")
  ) {
    return "El producto se guardó, pero la lectura de control detectó costo, precio o stock inválido. Revisalo antes de usarlo en Compras o Ventas.";
  }
  if (original.includes("FORBIDDEN")) {
    return "Tu perfil no tiene permiso para modificar productos.";
  }
  if (original.includes("costo_actual") && original.includes("not-null")) {
    return "SIGO no pudo inicializar el costo del producto. Actualizá la aplicación y volvé a intentar; el costo inicial debe quedar en cero hasta la primera compra.";
  }

  return original || fallback;
}

function validarReadbackProducto(
  producto: ProductoGuardadoReadback | null | undefined,
  input: GuardarProductoSigoInput,
  productoId: string,
) {
  if (!producto || producto.id !== productoId || producto.empresa_id !== input.empresaId) {
    throw new Error("SIGO guardó la operación, pero no pudo certificar el producto dentro de la empresa activa. No repitas el alta hasta revisar su estado.");
  }
  if (producto.activo !== true) {
    throw new Error("El producto persistido quedó inactivo después de guardarlo.");
  }
  if (producto.costo_actual == null || !Number.isFinite(Number(producto.costo_actual)) || Number(producto.costo_actual) < 0) {
    throw new Error("El producto persistido quedó con costo_actual NULL o inválido.");
  }
  if (producto.costo_ultima_compra == null || !Number.isFinite(Number(producto.costo_ultima_compra)) || Number(producto.costo_ultima_compra) < 0) {
    throw new Error("El producto persistido quedó con costo_ultima_compra NULL o inválido.");
  }
  if (producto.stock_actual == null || !Number.isFinite(Number(producto.stock_actual)) || Number(producto.stock_actual) < 0) {
    throw new Error("El producto persistido quedó con stock_actual NULL o inválido.");
  }
  if (producto.precio_venta == null || !Number.isFinite(Number(producto.precio_venta)) || Number(producto.precio_venta) < 0) {
    throw new Error("El producto persistido quedó con precio_venta NULL o inválido.");
  }
  if (!input.productoId && input.costoActual == null && Number(producto.costo_actual) !== 0) {
    throw new Error("El alta sin costo explícito no quedó inicializada en costo_actual = 0.");
  }
}

async function verificarProductoGuardadoSigo(
  input: GuardarProductoSigoInput,
  productoId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("verificar_producto_guardado_sigo", {
    p_empresa_id: input.empresaId,
    p_producto_id: productoId,
  });

  if (!error) {
    const filas = Array.isArray(data) ? data : data ? [data] : [];
    validarReadbackProducto(filas[0] as ProductoGuardadoReadback | undefined, input, productoId);
    return;
  }

  const raw = String(error.message ?? "");
  const rpcNoDisponible = raw.includes("verificar_producto_guardado_sigo") && (
    raw.includes("Could not find") || raw.includes("does not exist") || raw.includes("PGRST202")
  );
  if (!rpcNoDisponible) {
    throw new Error(mensajeErrorBackend(error, "No se pudo verificar el producto después de guardarlo."));
  }

  // Fallback temporal seguro durante una ventana de despliegue web/DB: sólo lectura.
  const { data: fallback, error: fallbackError } = await supabase
    .from("productos")
    .select("id,empresa_id,nombre,codigo_interno,codigo_barras,costo_actual,costo_ultima_compra,precio_venta,stock_actual,activo")
    .eq("empresa_id", input.empresaId)
    .eq("id", productoId)
    .maybeSingle();
  if (fallbackError) throw new Error(mensajeErrorBackend(fallbackError, "No se pudo verificar el producto después de guardarlo."));
  validarReadbackProducto(fallback as ProductoGuardadoReadback | null, input, productoId);
}

export class ProductoGuardadoSinVerificarError extends Error {
  constructor(public readonly productoId: string | null, causa: string) {
    super(`No se pudo certificar el resultado del guardado. No repitas el alta: cerrá el formulario y revisá el catálogo. ${causa}`);
    this.name = "ProductoGuardadoSinVerificarError";
  }
}

export async function listarUnidadesProductoSigo(empresaId: string): Promise<Record<string, UnidadVenta | null>> {
  if (!empresaId) throw new Error("EMPRESA_REQUIRED");
  const mapa: Record<string, UnidadVenta | null> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.rpc("listar_unidades_producto_sigo", { p_empresa_id: empresaId })
      .order("producto_id").range(from, from + pageSize - 1);
    if (error) throw new Error("No se pudieron verificar las unidades de los productos. Actualizá el catálogo antes de vender.");
    const filas = (data ?? []) as { producto_id: string; unidad_medida: unknown }[];
    for (const fila of filas) mapa[fila.producto_id] = normalizarUnidadVenta(fila.unidad_medida);
    if (filas.length < pageSize) break;
  }
  return mapa;
}

export async function listarProductosSigo(empresaId: string): Promise<ProductoSigo[]> {
  if (!empresaId) throw new Error("EMPRESA_REQUIRED");
  // PostgREST/Supabase puede limitar una respuesta a 1000 filas. Conservamos paginación
  // y orden estable, también para unidades; nunca completar faltantes como piezas.
  const pageSize = 1000;
  const productos: ProductoSigo[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.rpc("listar_productos_sigo", { p_empresa_id: empresaId })
      .order("nombre").order("id").range(from, from + pageSize - 1);
    if (error) throw new Error(mensajeErrorBackend(error, "No se pudieron cargar los productos."));
    const pagina = (data ?? []) as ProductoSigo[];
    productos.push(...pagina);
    if (pagina.length < pageSize) break;
  }
  // Un error de unidades no oculta el catálogo, pero jamás autoriza vender por pieza.
  let unidades: Record<string, UnidadVenta | null> = {};
  try { unidades = await listarUnidadesProductoSigo(empresaId); } catch { /* fail closed por producto */ }
  return productos.map((producto) => ({ ...producto, unidad_medida: unidades[producto.id] ?? null }));
}

export async function guardarProductoSigo(input: GuardarProductoSigoInput): Promise<string> {
  if (!input.empresaId) throw new Error("EMPRESA_REQUIRED");
  if (!input.nombre.trim()) throw new Error("PRODUCT_NAME_REQUIRED");
  validarProducto(input);

  const esNuevo = !input.productoId;
  let respuesta;
  try {
    respuesta = await supabase.rpc("guardar_producto_medida_sigo", {
      p_empresa_id: input.empresaId,
      p_producto_id: input.productoId ?? null,
      p_codigo_interno: normalizarTexto(input.codigoInterno),
      p_codigo_barras: normalizarTexto(input.codigoBarras),
      p_nombre: input.nombre.trim(),
      p_descripcion: normalizarTexto(input.descripcion),
      p_categoria: normalizarTexto(input.categoria),
      p_marca: normalizarTexto(input.marca),
      p_proveedor: normalizarTexto(input.proveedor),
      p_costo_actual: input.costoActual ?? (esNuevo ? 0 : null),
      p_costo_ultima_compra: input.costoUltimaCompra ?? (esNuevo ? 0 : null),
      p_precio_venta: input.precioVenta ?? (esNuevo ? 0 : null),
      p_margen_ganancia: input.margenGanancia ?? (esNuevo ? 0 : null),
      p_margen_porcentaje: input.margenPorcentaje ?? (esNuevo ? 0 : null),
      p_stock_actual: input.stockActual ?? (esNuevo ? 0 : null),
      p_stock_minimo: input.stockMinimo ?? null,
      p_stock_maximo: input.stockMaximo ?? null,
      p_unidad_medida: input.unidadMedida ?? null,
    });
  } catch {
    throw new ProductoGuardadoSinVerificarError(input.productoId ?? null, "La conexión se interrumpió durante el guardado.");
  }
  const { data, error } = respuesta;

  if (error) {
    if (!error.code || /fetch|network|timeout/i.test(error.message ?? "")) {
      throw new ProductoGuardadoSinVerificarError(input.productoId ?? null, "La conexión se interrumpió.");
    }
    throw new Error(mensajeErrorBackend(error, "No se pudo guardar el producto."));
  }
  const productoId = String(data ?? "").trim();
  if (!productoId) throw new ProductoGuardadoSinVerificarError(input.productoId ?? null, "El servidor no devolvió el identificador.");

  // No mostramos éxito hasta releer el registro persistido y certificar costo/stock operativos.
  // Esto protege tanto el alta manual como los productos creados desde Factura IA.
  try {
    await verificarProductoGuardadoSigo(input, productoId);
    const unidades = await listarUnidadesProductoSigo(input.empresaId);
    const unidadPersistida = unidades[productoId];
    if (!unidadPersistida || (input.unidadMedida != null && unidadPersistida !== input.unidadMedida)) {
      throw new Error("La unidad persistida no coincide con la configurada.");
    }
  } catch (err) {
    throw new ProductoGuardadoSinVerificarError(productoId, err instanceof Error ? err.message : "Falló la lectura de control.");
  }
  return productoId;
}

export async function eliminarProductoSigo(empresaId: string, productoId: string): Promise<void> {
  if (!empresaId) throw new Error("EMPRESA_REQUIRED");
  if (!productoId) throw new Error("PRODUCT_REQUIRED");

  const { data, error } = await supabase.rpc("eliminar_producto_sigo", {
    p_empresa_id: empresaId,
    p_producto_id: productoId,
  });

  if (error) throw new Error(mensajeErrorBackend(error, "No se pudo dar de baja el producto."));
  if (data !== true) throw new Error("PRODUCT_DEACTIVATE_FAILED");
}
