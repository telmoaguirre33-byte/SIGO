import fs from "node:fs";

const path = "src/VentaRapidaOperativa.tsx";
let source = fs.readFileSync(path, "utf8");
if (source.includes("// SIGO_OFERTAS_CAJA")) {
  console.log("SIGO_OFERTAS_CAJA_OK");
  process.exit(0);
}

function replaceOnce(before, after) {
  if (!source.includes(before)) throw new Error(`OFFER_SALE_PATCH_TARGET_NOT_FOUND: ${before.slice(0, 85)}`);
  source = source.replace(before, after);
}

replaceOnce('import { listarClientesSigo, type ClienteSigo } from "./clientes";',
  'import { listarClientesSigo, type ClienteSigo } from "./clientes";\nimport { listarOfertasProductos, ofertaVigente, precioConOferta, type OfertaProducto } from "./ofertasProductos";');
replaceOnce('  const [catalogo, setCatalogo] = useState<ProductoSigo[]>([]);',
  '  const [catalogo, setCatalogo] = useState<ProductoSigo[]>([]);\n  const [ofertas, setOfertas] = useState<OfertaProducto[]>([]); // SIGO_OFERTAS_CAJA\n  const [ofertasListas, setOfertasListas] = useState(false);\n  const [ofertasError, setOfertasError] = useState("");');
replaceOnce('    setCatalogo([]);\n    setBusquedaProducto("");',
  '    setCatalogo([]);\n    setOfertas([]);\n    setOfertasListas(false);\n    setOfertasError("");\n    setBusquedaProducto("");');
replaceOnce('const [clientesResultado, catalogoResultado] = await Promise.allSettled([\n        listarClientesSigo(empresaId),\n        listarProductosSigo(empresaId),\n      ]);',
  'const [clientesResultado, catalogoResultado, ofertasResultado] = await Promise.allSettled([\n        listarClientesSigo(empresaId),\n        listarProductosSigo(empresaId),\n        listarOfertasProductos(empresaId),\n      ]);');
replaceOnce('        if (catalogoResultado.status === "fulfilled") setCatalogo(catalogoResultado.value);',
  '        if (ofertasResultado.status === "fulfilled") { setOfertas(ofertasResultado.value); setOfertasListas(true); }\n        else { setOfertasError("No se pudieron cargar las ofertas. Actualizá Caja antes de confirmar una venta."); }\n        if (catalogoResultado.status === "fulfilled") setCatalogo(catalogoResultado.value);');
replaceOnce('  const total = useMemo(\n    () => items.reduce((suma, item) => suma + Number(item.producto.precio_venta ?? 0) * item.cantidad, 0),\n    [items],\n  );',
  '  function precioVigente(producto: BarcodeProduct): number {\n    const habitual = Number(producto.precio_venta ?? 0);\n    const oferta = ofertaVigente(ofertas, producto.id);\n    return oferta && habitual > 0 ? precioConOferta(habitual, Number(oferta.descuento_porcentaje)) : habitual;\n  }\n\n  const total = items.reduce((suma, item) => suma + precioVigente(item.producto) * item.cantidad, 0);');
replaceOnce('  const puedeConfirmar = items.length > 0',
  '  const puedeConfirmar = ofertasListas && items.length > 0');
replaceOnce('      const precio = Number(item.producto.precio_venta);',
  '      const precio = precioVigente(item.producto);');
replaceOnce('        {catalogoError ? <p className="form-error" role="alert">Catálogo: {catalogoError}</p> : null}',
  '        {catalogoError ? <p className="form-error" role="alert">Catálogo: {catalogoError}</p> : null}\n        {ofertasError && <p className="form-error" role="alert">{ofertasError}</p>}');
replaceOnce('        {superaLimite && <p className="form-error" role="alert">La operación supera el límite de crédito configurado para el cliente.</p>}',
  '        {superaLimite && <p className="form-error" role="alert">La operación supera el límite de crédito configurado para el cliente.</p>}\n        {!ofertasListas && <p className="form-error" role="alert">{ofertasError || "Cargando ofertas antes de confirmar la venta…"}</p>}');
replaceOnce('{Number(producto.precio_venta || 0) > 0 ? `$ ${Number(producto.precio_venta).toLocaleString("es-AR")}` : "Sin precio"}',
  '{Number(producto.precio_venta || 0) > 0 ? <>$ {precioVigente(producto).toLocaleString("es-AR")}{ofertaVigente(ofertas, producto.id) && <small>Oferta vigente</small>}</> : "Sin precio"}');
replaceOnce('Number(item.producto.precio_venta) * item.cantidad', 'precioVigente(item.producto) * item.cantidad');
replaceOnce('<span>$ {Number(item.producto.precio_venta).toLocaleString("es-AR")} c/u</span>',
  '<span>$ {precioVigente(item.producto).toLocaleString("es-AR")} c/u{ofertaVigente(ofertas, item.producto.id) && " · Oferta vigente"}</span>');

fs.writeFileSync(path, source);
console.log("SIGO_OFERTAS_CAJA_OK");
