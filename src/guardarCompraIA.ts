import type { FacturaCompraIA } from "./facturaIA";
import type { ProductoSigo } from "./productos";

export type GuardarCompraIAInput = {
  factura: FacturaCompraIA;
  productos: ProductoSigo[];
  vinculos: Record<number, string>;
  barras: Record<number, string>;
  codigos: Record<number, string>;
  precios: Record<number, string>;
  margenes: Record<number, string>;
};

const texto = (v: unknown): string | null => String(v ?? "").trim() || null;
const normalizar = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function resolverProductoCompraIA(input: GuardarCompraIAInput, index: number): ProductoSigo | undefined {
  const item = input.factura.items[index];
  const elegido = input.vinculos[index];
  if (elegido) {
    const existente = input.productos.find(p => p.id === elegido);
    if (!existente) throw new Error(`El producto vinculado a ${item.descripcion} ya no está disponible. Volvé a seleccionarlo.`);
    return existente;
  }
  const barras = texto(input.barras[index] ?? item.codigo_barras);
  const codigo = texto(input.codigos[index] ?? item.codigo);
  const porCodigo = input.productos.filter(p =>
    (barras && (texto(p.codigo_barras) === barras || texto(p.codigo_interno) === barras)) ||
    (codigo && (texto(p.codigo_interno) === codigo || texto(p.codigo_barras) === codigo)));
  const candidatos = porCodigo.length ? porCodigo : input.productos.filter(p => normalizar(p.nombre) === normalizar(item.descripcion));
  if (candidatos.length > 1) throw new Error(`Hay más de un producto que coincide con ${item.descripcion}. Vinculá el correcto en Revisar / Corregir.`);
  return candidatos[0];
}

export function construirCompraIA(input: GuardarCompraIAInput) {
  const { factura } = input;
  if (!factura.items.length || factura.items.length > 300) throw new Error("La compra debe tener entre 1 y 300 productos.");
  const proveedor = texto(factura.proveedor.razon_social);
  if (!proveedor || /^(proveedor sin identificar|proveedor pendiente de revisión|no le[ií]do)$/i.test(proveedor)) throw new Error("Completá el nombre real del proveedor antes de guardar la compra.");
  if (!factura.fecha) throw new Error("Completá la fecha real del comprobante antes de guardar la compra.");
  return {
    proveedor_nombre: proveedor,
    proveedor_cuit: texto(factura.proveedor.cuit),
    fecha: texto(factura.fecha),
    tipo_comprobante: texto(factura.tipo_comprobante),
    numero_comprobante: texto(factura.numero_comprobante),
    total_comprobante: factura.total ?? null,
    advertencias: factura.advertencias ?? [],
    items: factura.items.map((item, index) => {
      const existente = resolverProductoCompraIA(input, index);
      const nombre = texto(item.descripcion);
      const cantidad = Number(item.cantidad), costo = Number(item.costo_unitario);
      if (!nombre) throw new Error(`Completá el nombre del producto ${index + 1}.`);
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1_000_000) throw new Error(`Revisá la cantidad de ${nombre}.`);
      if (!Number.isFinite(costo) || costo <= 0 || costo > 1_000_000_000) throw new Error(`Revisá el costo unitario de ${nombre}.`);
      const margenIngresado = input.margenes[index];
      const margen = margenIngresado === undefined || margenIngresado === "" ? 30 : Number(margenIngresado);
      const precioIngresado = input.precios[index];
      const precio = existente && !texto(precioIngresado) ? null : precioIngresado === undefined || precioIngresado === ""
        ? Math.round(costo * (1 + margen / 100) * 100) / 100 : Number(precioIngresado);
      if ((!existente || precio !== null) && (!Number.isFinite(precio) || Number(precio) < costo || Number(precio) > 1_000_000_000)) throw new Error(`Definí un precio de venta válido para ${nombre}.`);
      return {
        producto_id: existente?.id ?? null,
        nombre,
        codigo_interno: existente ? texto(existente.codigo_interno) : texto(input.codigos[index] ?? item.codigo),
        codigo_barras: existente ? texto(existente.codigo_barras) : texto(input.barras[index] ?? item.codigo_barras),
        cantidad,
        costo_unitario: costo,
        precio_venta: precio,
      };
    }),
  };
}

export function errorGuardadoCompraIA(raw: string): string {
  const mensajes: Record<string, string> = {
    AUTH_REQUIRED: "La sesión venció. Volvé a ingresar; la compra sigue en el borrador.",
    FORBIDDEN: "Tu usuario no tiene los permisos necesarios para guardar esta compra.",
    STOCK_WRITE_REQUIRED: "Tu usuario no tiene permiso para ingresar stock.",
    PURCHASE_DOCUMENT_DUPLICATE: "Este comprobante ya está guardado. No se volvió a sumar stock.",
    IDEMPOTENCY_CONFLICT: "Esta compra ya se guardó con otros valores. Revisá el historial antes de volver a cargarla.",
    PRODUCT_AMBIGUOUS: "Hay productos con códigos o nombres coincidentes. Vinculá el producto correcto antes de guardar.",
    PRODUCT_NOT_FOUND: "Un producto vinculado ya no está disponible en esta empresa.",
    PRODUCT_LEGACY_PENDING: "Un producto tiene un código duplicado pendiente de revisión. Vinculá el producto correcto.",
    SUPPLIER_AMBIGUOUS: "Hay más de un proveedor coincidente. Revisá su nombre y CUIT.",
    SUPPLIER_REQUIRED: "Completá el nombre del proveedor.",
    SUPPLIER_CUIT_INVALID: "Revisá el CUIT del proveedor o dejalo vacío si no figura en el comprobante.",
    INVALID_ITEM: "Revisá nombre, cantidad, costo y precio de los productos.",
    PRODUCT_VALUES_INVALID: "Un producto existente tiene stock o costo inválido. Revisalo antes de guardar.",
    PRICE_PERMISSION_REQUIRED: "Tu usuario necesita permiso para guardar el costo y precio de los productos nuevos.",
  };
  for (const [codigo, mensaje] of Object.entries(mensajes)) if (raw.includes(codigo)) return mensaje;
  if (raw.includes("guardar_compra_ia_sigo") && (raw.includes("schema cache") || raw.includes("does not exist"))) return "El guardado definitivo todavía no está disponible en el servidor. El borrador se conserva.";
  return raw || "No se pudo confirmar el guardado. Conservamos el borrador: reintentá sin cargar otra vez el comprobante.";
}
