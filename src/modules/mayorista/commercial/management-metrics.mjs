/** Eventos distintos: recepción no es venta, entrega no es cobro, factura requiere comprobante. */
export const METRICS = Object.freeze({
  vendido: 'Monto vendido', facturado: 'Monto facturado', pedidos: 'Pedidos recibidos',
  visitados: 'Clientes visitados', compradores: 'Clientes con compra', nuevos: 'Clientes nuevos',
  recuperados: 'Clientes recuperados', cobrado: 'Monto cobrado', deuda_recuperada: 'Recuperación de deuda',
  unidades: 'Unidades vendidas'
});
export const MONEY_METRICS = new Set(['vendido', 'facturado', 'cobrado', 'deuda_recuperada']);
const instant = v => v instanceof Date ? v.getTime() : Date.parse(v);
const sum = (items, field) => items.reduce((s, i) => {const next=s+signed(i[field]);if(!Number.isSafeInteger(next))throw new Error('Total fuera de rango');return next;}, 0);
const unique = (items, field) => new Set(items.map(i => i[field]).filter(Boolean));
const signed = v => { const n = Number(v ?? 0); if (!Number.isSafeInteger(n)) throw new Error('Importe fuera de rango'); return n; };
export function normalizeReportFilters(raw = {}, now = new Date()) {
  const preset = raw.periodo ?? 'mes', today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  let from = new Date(today), to = new Date(today); to.setUTCDate(to.getUTCDate() + 1);
  if (preset === 'semana') from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7);
  else if (preset === 'mes') from.setUTCDate(1);
  else if (preset === 'personalizado') {
    const valid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
    try { if (!valid(raw.desde) || !valid(raw.hasta)) throw new Error(); }
    catch { throw new Error('Fechas inválidas'); }
    from = new Date(raw.desde + 'T00:00:00Z'); to = new Date(raw.hasta + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() + 1);
  } else if (preset !== 'hoy') throw new Error('Período inválido');
  if (from >= to || to - from > 366 * 86400000) throw new Error('Elegí un período de hasta un año');
  const optional = key => { const v = raw[key] ?? ''; if (typeof v !== 'string' || v.length > 160) throw new Error('Filtro inválido'); return v; };
  return { periodo: preset, desde: from.toISOString(), hastaExclusivo: to.toISOString(), vendedorId: optional('vendedorId'), rutaId: optional('rutaId'), zona: optional('zona') };
}
/** Convierte el historial persistente de cargas, conservando la fecha de cada entrega/devolución. */
export function loadCommercialEvents(loads, orders) {
  const byOrder = new Map(orders.map(o => [o.pedidoId, o])), events = [], seen = new Set();
  for (const load of loads) for (const h of load.historial ?? []) {
    if (!['entregar', 'devolver', 'revisar_rendicion'].includes(h.tipo)) continue;
    const id = `${load.id}:${h.id}:${h.tipo}`; if (seen.has(id)) continue; seen.add(id);
    const p = load.pedidos?.[h.input?.pedidoId], o = byOrder.get(h.input?.pedidoId);
    if (!p || !o) continue;
    const base = { id, pedidoId: o.pedidoId, clienteId: o.clienteId, vendedorId: o.vendedorId, rutaId: p.rutaId ?? load.ruta, fecha: h.fecha };
    if (h.tipo === 'entregar') {
      const lines = (h.input.lineas ?? []).map(d => {
        const l = p.lineas.find(x => x.productoId === d.productoId);
        return { productoId: d.productoId, unidades: d.entregado, centavos: Math.round((l?.totalCentavos ?? Math.round((l?.precioUnitario ?? 0) * l?.cantidad * 100)) * d.entregado / l?.cantidad) };
      });
      events.push({ ...base, tipo: 'entrega', lineas: lines, centavos: sum(lines, 'centavos'), unidades: sum(lines, 'unidades'), estado: lines.every(l => l.unidades === 0) ? 'fallida' : (h.input.lineas ?? []).some(l => l.devuelto > 0) || p.lineas.some(l => l.preparado < l.cantidad) ? 'parcial' : 'entregada' });
    } else if (h.tipo === 'devolver') {
      const l = p.lineas.find(x => x.productoId === h.input.productoId), qty = h.input.cantidad;
      // Usar diferencias de importes redondeados: una devolución completa anula exactamente la entrega.
      const initial = (load.historial ?? []).find(x => x.tipo === 'entregar' && x.input?.pedidoId === o.pedidoId);
      const original = initial?.input.lineas.find(x => x.productoId === l?.productoId)?.entregado ?? 0;
      const prior = (load.historial ?? []).slice(0, (load.historial ?? []).indexOf(h)).filter(x => x.tipo === 'devolver' && x.input?.pedidoId === o.pedidoId && x.input.productoId === l?.productoId).reduce((s, x) => s + x.input.cantidad, 0);
      const amount = l?.totalCentavos ?? Math.round((l?.precioUnitario ?? 0) * l?.cantidad * 100);
      const cents = Math.round(amount * (original - prior) / l?.cantidad) - Math.round(amount * (original - prior - qty) / l?.cantidad);
      events.push({ ...base, tipo: 'devolucion', centavos: cents, unidades: qty, lineas: [{ productoId: l?.productoId, unidades: qty, centavos: cents }] });
    }
  }
  return events;
}
export function goalProgress(target, actual) {
  if (actual === null) return { objetivo: target, real: null, cumplimiento: null, falta: null };
  return { objetivo: target, real: actual, cumplimiento: Math.round(actual * 10000 / target) / 100, falta: Math.max(0, target - actual) };
}
export function calculateManagementMetrics({ empresaId, orders = [], customers = [], sellers = [], routes = [], visits = [], loads = [], ledger = [], collections = [], products = [], inventory = [], sales = null, invoices = null, costs = null, dueBalances = null, goals = [] }, filters, now = new Date()) {
  const from = instant(filters.desde), to = instant(filters.hastaExclusivo), routeMap = new Map(routes.map(r => [r.id, r]));
  const customerMap = new Map(customers.map(c => [c.id, c])), orderMap = new Map(orders.map(o => [o.pedidoId, o]));
  const inPeriod = e => instant(e.fecha) >= from && instant(e.fecha) < to;
  const matches = e => {
    const c = customerMap.get(e.clienteId), o = orderMap.get(e.pedidoId), seller = e.vendedorId ?? o?.vendedorId ?? c?.vendedorId;
    const route = e.rutaId ?? o?.rutaId ?? c?.rutaId;
    return (!filters.vendedorId || seller === filters.vendedorId) && (!filters.rutaId || route === filters.rutaId) && (!filters.zona || routeMap.get(route)?.zona === filters.zona);
  };
  const allEvents = loadCommercialEvents(loads, orders), events = allEvents.filter(e => inPeriod(e) && matches(e));
  const delivered = events.filter(e => e.tipo === 'entrega'), returns = events.filter(e => e.tipo === 'devolucion');
  const effective = delivered.filter(e => e.unidades > 0);
  const receipts = orders.filter(o => matches(o) && inPeriod({ fecha: o.recibidoEn }));
  const periodVisits = visits.filter(v => matches(v) && inPeriod({ fecha: v.registradaEn }));
  // Cobros SOLO asentados: una rendición presentada aún no es un asiento revisado.
  const payments = ledger.filter(e => e.tipo === 'cobranza').map(e => ({ ...e, centavos: -signed(e.centavos) })).concat(collections.filter(e => e.tipo === 'cobro').map(e => ({ ...e, centavos: signed(e.centavos) }))).filter(e => matches(e) && inPeriod(e));
  const balances = new Map();
  for (const e of [...ledger, ...collections.map(e => ({ ...e, centavos: (e.tipo === 'cobro' ? -1 : 1) * signed(e.centavos) }))]) if (matches(e) && instant(e.fecha) < to) balances.set(e.clienteId, (balances.get(e.clienteId) ?? 0) + signed(e.centavos));
  const confirmedSales = sales === null ? null : sales.filter(e => e.estado === 'confirmada' && matches(e) && inPeriod(e));
  const buyers = unique(confirmedSales ?? [], 'clienteId'), visited = unique(periodVisits, 'clienteId');
  const fresh = new Set(), recovered = new Set();
  for (const id of buyers) {
    const before = (sales ?? []).filter(e => e.clienteId === id && e.estado === 'confirmada' && instant(e.fecha) < from);
    if (!before.length) fresh.add(id);
    else if (Math.max(...before.map(e => instant(e.fecha))) < from - 60 * 86400000) recovered.add(id);
  }
  const billed = invoices === null ? null : invoices.filter(e => e.estado === 'confirmada' && matches(e) && inPeriod(e));
  const sold = confirmedSales === null ? null : sum(confirmedSales, 'centavos'), collected = sum(payments, 'centavos');
  const activeCustomers = customers.filter(c => c.habilitado !== false && matches(c));
  // Recuperación de deuda: se calcula con saldos de apertura y se limita por cliente.
  const opening = new Map();
  for (const e of [...ledger, ...collections.map(e => ({ ...e, centavos: (e.tipo === 'cobro' ? -1 : 1) * signed(e.centavos) }))]) if (matches(e) && instant(e.fecha) < from) opening.set(e.clienteId, (opening.get(e.clienteId) ?? 0) + signed(e.centavos));
  const recovery = [...opening].reduce((total, [id, balance]) => total + Math.min(Math.max(0, balance), sum(payments.filter(e => e.clienteId === id), 'centavos')), 0);
  const summary = { vendido: sold, facturado: billed === null ? null : sum(billed, 'centavos'), margen: costs === null || sold === null ? null : sold - sum(costs.filter(e => matches(e) && inPeriod(e)), 'centavos'), pedidos: receipts.length,
    ticketPromedio: confirmedSales === null ? null : confirmedSales.length ? Math.round(sold / confirmedSales.length) : 0, mercaderiaEntregada: sum(delivered, 'unidades'), importeEntregado: sum(delivered, 'centavos') - sum(returns, 'centavos'), unidades: confirmedSales === null ? null : sum(confirmedSales, 'unidades'), cobrado: collected, deuda_recuperada: recovery,
    deudaPendiente: [...balances.values()].reduce((s, v) => s + Math.max(0, v), 0), deudaVencida: dueBalances === null ? null : sum(dueBalances.filter(e => matches(e) && instant(e.vencimiento) < Math.min(to, instant(now)) && e.centavos > 0), 'centavos'),
    clientesActivos: activeCustomers.length, nuevos: confirmedSales === null ? null : fresh.size, recuperados: confirmedSales === null ? null : recovered.size, visitados: visited.size, compradores: confirmedSales === null ? null : buyers.size, clientesSinCompra: confirmedSales === null ? null : activeCustomers.filter(c => !buyers.has(c.id)).length,
    entregas: delivered.length, entregasFallidas: delivered.filter(e => e.estado === 'fallida').length, entregasParciales: delivered.filter(e => e.estado === 'parcial').length, devoluciones: returns.length, unidadesDevueltas: sum(returns, 'unidades') };
  const group = (items, key, labels) => [...new Set(items.map(i => key(i)))].filter(Boolean).map(id => ({ id, nombre: labels(id), centavos: items.filter(i => key(i) === id).reduce((s, i) => s + (i.tipo === 'devolucion' ? -1 : 1) * i.centavos, 0), unidades: items.filter(i => key(i) === id).reduce((s, i) => s + (i.tipo === 'devolucion' ? -1 : 1) * i.unidades, 0) })).sort((a, b) => b.centavos - a.centavos);
  const ranking = sellers.filter(s => !filters.vendedorId || s.id === filters.vendedorId).map(s => ({ id: s.id, nombre: s.nombre, vendido: confirmedSales === null ? null : sum(confirmedSales.filter(e => e.vendedorId === s.id), 'centavos'), importeEntregado: events.filter(e => e.vendedorId === s.id).reduce((a, e) => a + (e.tipo === 'devolucion' ? -e.centavos : e.centavos), 0), pedidos: receipts.filter(o => o.vendedorId === s.id).length, visitas: periodVisits.filter(v => v.vendedorId === s.id).length, clientesConCompra: confirmedSales === null ? null : unique(confirmedSales.filter(e => e.vendedorId === s.id), 'clienteId').size })).sort((a, b) => (b.vendido ?? b.importeEntregado) - (a.vendido ?? a.importeEntregado));
  const productEvents = events.flatMap(e => e.lineas.map(l => ({ ...e, ...l })));
  const topProducts = group(productEvents, e => e.productoId, id => products.find(p => p.id === id)?.nombre ?? id);
  const slow = topProducts.filter(p => p.unidades > 0).sort((a, b) => a.unidades - b.unidades).slice(0, 10);
  const quiet = products.filter(p => p.activo !== false && !topProducts.some(x => x.id === p.id && x.unidades > 0)).map(p => ({ id: p.id, nombre: p.nombre }));
  const pending = orders.filter(o => matches(o) && !loads.some(l => l.estado !== 'cancelada' && l.pedidos?.[o.pedidoId]?.entrega));
  const alerts = [
    { tipo: 'pedidos_pendientes', cantidad: pending.length }, { tipo: 'pedidos_demorados', cantidad: pending.filter(o => instant(now) - instant(o.recibidoEn) > 48 * 3600000).length },
    { tipo: 'cargas_pendientes', cantidad: loads.filter(l => ['planificada', 'picking', 'verificada'].includes(l.estado) && Object.keys(l.pedidos).some(id => matches({ pedidoId: id }))).length },
    { tipo: 'entregas_fallidas', cantidad: summary.entregasFallidas },
    { tipo: 'rendiciones_pendientes', cantidad: loads.flatMap(l => Object.values(l.pedidos ?? {})).filter(p => p.entrega && p.rendicion?.estado !== 'revisada' && matches(p)).length },
    { tipo: 'devoluciones_pendientes', cantidad: loads.filter(l => !l.recepcionDevoluciones && Object.values(l.pedidos ?? {}).some(p => matches(p) && p.lineas.some(x => x.devuelto > 0))).length },
    { tipo: 'clientes_inactivos', cantidad: activeCustomers.filter(c => { const last = allEvents.filter(e => e.clienteId === c.id && e.tipo === 'entrega' && e.unidades > 0); return last.length && Math.max(...last.map(e => instant(e.fecha))) < instant(now) - 60 * 86400000; }).length },
    { tipo: 'stock_bajo', cantidad: inventory.filter(p => topProducts.slice(0, 10).some(x => x.id === p.productoId) && Number(p.disponibles) <= 0).length }
  ].filter(a => a.cantidad > 0);
  const daily = group(events, e => new Date(e.fecha).toISOString().slice(0, 10), id => id).sort((a, b) => a.id.localeCompare(b.id));
  return { empresaId, filtros: filters, resumen: summary, vendedores: ranking,
    zonas: group(events, e => routeMap.get(e.rutaId)?.zona, id => id), rutas: group(events, e => e.rutaId, id => routeMap.get(id)?.nombre ?? id),
    productosMasVendidos: topProducts.slice(0, 10), bajaRotacion: slow, sinMovimiento: quiet.slice(0, 50), cantidadSinMovimiento: quiet.length, diario: daily, alertas: alerts,
    criterios: { nuevos: 'Primera venta confirmada registrada', recuperados: 'Compra luego de 60 días sin venta', venta: 'Venta confirmada en SIGO; pedido y entrega se informan por separado', cobro: 'Asiento confirmado, no rendición presentada', rotacion: 'Unidades efectivamente entregadas menos devoluciones', calendario: 'UTC; desde inclusive, hasta exclusive' },
    fuentes: { ventas: confirmedSales !== null, facturacion: billed !== null, costos: costs !== null, vencimientos: dueBalances !== null }, objetivos: goals };
}
