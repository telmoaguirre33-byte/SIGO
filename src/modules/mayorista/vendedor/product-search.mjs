/** Índice efímero: solo datos del catálogo local, sin red ni almacenamiento adicional. */
export const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export function buildProductIndex(products = [], prices = []) {
  const byProduct = new Map();
  for (const price of prices) {
    if (!Number.isFinite(Number(price.precio)) || Number(price.precio) < 0 || !Number.isSafeInteger(price.unidadesBase) || price.unidadesBase < 1) continue;
    const list = byProduct.get(price.productoId) ?? [];
    list.push(price); byProduct.set(price.productoId, list);
  }
  return products.filter(p => p.activo !== false).map(product => {
    const codes = [product.codigo, product.codigoInterno, product.ean, product.codigoBarras, product.id].filter(Boolean).map(normalizeSearch);
    return {product, prices: byProduct.get(product.id) ?? [], codes,
      text: normalizeSearch([product.nombre, product.descripcion, product.marca, ...codes].join(' '))};
  }).filter(entry => entry.prices.length);
}
/** Una compra por pedido: distintas presentaciones no inflan la frecuencia. */
export function customerFrequencies(orders = [], customerId) {
  const counts = new Map();
  for (const order of orders) {
    if (!customerId || order.clienteId !== customerId) continue;
    for (const id of new Set(order.lineas.map(line => line.productoId))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
export function searchProducts(index, query, frequencies = new Map(), limit = 10) {
  const normalized = normalizeSearch(query), tokens = normalized.split(/\s+/).filter(Boolean);
  const best = [];
  // Inserción acotada: nunca ordenar/renderizar miles de coincidencias.
  for (const entry of index) {
    if (!tokens.every(token => entry.text.includes(token))) continue;
    const frequency = frequencies.get(entry.product.id) ?? 0;
    const score = (normalized && entry.codes.includes(normalized) ? 1e9 : 0) + Math.min(frequency, 100000) * 100 + (normalized && entry.text.startsWith(normalized) ? 1 : 0);
    const result = {...entry, frequency, score};
    const at = best.findIndex(other => other.score < score);
    if (at < 0) { if (best.length < Math.min(10, limit)) best.push(result); }
    else { best.splice(at, 0, result); if (best.length > Math.min(10, limit)) best.pop(); }
  }
  return best;
}
