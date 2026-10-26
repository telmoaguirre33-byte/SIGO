import type { ProductoSigo } from "./productos";

export function normalizarBusquedaCaja(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/\s+/g, " ")
    .trim();
}

// Se prepara al cambiar el catálogo, no por cada tecla. Conserva identidad y orden.
export function crearIndiceBusquedaCaja(productos: ProductoSigo[], empresaId: string) {
  return productos.filter((producto) => producto.empresa_id === empresaId).map((producto) => ({
    producto,
    nombre: normalizarBusquedaCaja(producto.nombre),
    texto: normalizarBusquedaCaja([producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca, producto.categoria].filter(Boolean).join(" ")),
    codigoInterno: normalizarBusquedaCaja(producto.codigo_interno),
    codigoBarras: normalizarBusquedaCaja(producto.codigo_barras),
  }));
}

export function buscarProductosCaja(indice: ReturnType<typeof crearIndiceBusquedaCaja>, consulta: string): ProductoSigo[] {
  const busqueda = normalizarBusquedaCaja(consulta);
  if (!busqueda) return [];
  const palabras = busqueda.split(" ");
  const codigosExactos: ProductoSigo[] = [];
  const nombresExactos: ProductoSigo[] = [];
  const frases: ProductoSigo[] = [];
  const parciales: ProductoSigo[] = [];
  for (const entrada of indice) {
    if (!palabras.every((palabra) => entrada.texto.includes(palabra))) continue;
    if (entrada.codigoInterno === busqueda || entrada.codigoBarras === busqueda) codigosExactos.push(entrada.producto);
    else if (entrada.nombre === busqueda) nombresExactos.push(entrada.producto);
    else if (entrada.nombre.includes(busqueda)) frases.push(entrada.producto);
    else parciales.push(entrada.producto);
  }
  // Todas las coincidencias permanecen disponibles; sólo se pagina su presentación.
  return codigosExactos.concat(nombresExactos, frases, parciales);
}
