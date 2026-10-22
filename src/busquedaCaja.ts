type Buscable = { nombre: string; codigo_interno?: string | null; codigo_barras?: string | null; marca?: string | null; categoria?: string | null };
export function normalizarBusquedaCaja(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').trim();
}
export function crearIndiceCaja<T extends Buscable>(productos: T[]) {
  return productos.map(producto => ({ producto, texto: normalizarBusquedaCaja([producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca, producto.categoria].filter(Boolean).join(' ')) }));
}
export function buscarIndiceCaja<T extends Buscable>(indice: ReturnType<typeof crearIndiceCaja<T>>, consulta: string): T[] {
  const q = normalizarBusquedaCaja(consulta);
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/);
  return indice.filter(fila => tokens.every(token => fila.texto.includes(token))).map(fila => fila.producto);
}
