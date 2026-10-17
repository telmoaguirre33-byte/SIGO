import {createHash} from 'node:crypto';
import {normalizeReportFilters,calculateManagementMetrics,loadCommercialEvents} from './management-metrics.mjs';
export const REPORT_TYPES=Object.freeze({ventas:'Ventas',facturacion:'Facturación',cobranzas:'Cobranzas',deuda:'Deuda',vendedores:'Vendedores',objetivos:'Objetivos',clientes:'Clientes',rutas:'Rutas',productos:'Productos entregados',entregas:'Entregas',devoluciones:'Devoluciones'});
/** Exportación usa los mismos períodos UTC, atribución y fuentes del panel. */
export function exportReport(data,raw){
 const type=raw.tipo;if(!Object.hasOwn(REPORT_TYPES,type))throw Error('Informe inválido');
 const filters=normalizeReportFilters(raw),report=calculateManagementMetrics(data,filters),customers=new Map(data.customers.map(c=>[c.id,c])),routes=new Map(data.routes.map(r=>[r.id,r])),sellers=new Map(data.sellers.map(s=>[s.id,s])),orders=new Map(data.orders.map(o=>[o.pedidoId,o]));
 const inPeriod=e=>Date.parse(e.fecha)>=Date.parse(filters.desde)&&Date.parse(e.fecha)<Date.parse(filters.hastaExclusivo);
 const matches=e=>{const c=customers.get(e.clienteId),o=orders.get(e.pedidoId),seller=e.vendedorId??o?.vendedorId??c?.vendedorId,route=e.rutaId??o?.rutaId??c?.rutaId;return (!filters.vendedorId||seller===filters.vendedorId)&&(!filters.rutaId||route===filters.rutaId)&&(!filters.zona||routes.get(route)?.zona===filters.zona);};
 const customer=id=>customers.get(id)?.nombre??'Cliente',seller=id=>sellers.get(id)?.nombre??'Sin asignar',route=id=>routes.get(id)?.nombre??'Sin ruta';
 const cents=n=>n===null||n===undefined?'Sin datos confirmados':Number(n)/100;
 let headers=[],rows=[],available=true;
 if(['ventas','facturacion'].includes(type)){
  const source=type==='ventas'?data.sales:data.invoices;available=source!==null;
  headers=['Fecha','Cliente','Vendedor','Ruta','Estado','Importe ARS'];rows=(source??[]).filter(e=>e.estado==='confirmada'&&inPeriod(e)&&matches(e)).map(e=>[e.fecha,customer(e.clienteId),seller(e.vendedorId),route(e.rutaId),e.estado,cents(e.centavos)]);
 }
 const events=[...loadCommercialEvents(data.loads,data.orders).filter(e=>e.tipo!=='devolucion'||!(data.confirmedReturns??[]).some(r=>r.pedidoId===e.pedidoId&&r.eventoId&&e.id.endsWith(':'+r.eventoId+':devolver'))),...(data.confirmedReturns??[])].filter(e=>inPeriod(e)&&matches(e));
 if(['entregas','devoluciones'].includes(type)){headers=['Fecha','Pedido','Cliente','Vendedor','Ruta','Estado','Unidades','Importe ARS'];rows=events.filter(e=>e.tipo===(type==='entregas'?'entrega':'devolucion')).map(e=>[e.fecha,'Pedido '+e.pedidoId.slice(0,8),customer(e.clienteId),seller(e.vendedorId),route(e.rutaId),e.estado??'Registrada',e.unidades,cents(e.centavos)]);}
 if(type==='cobranzas'){
  headers=['Fecha','Cliente','Vendedor','Importe ARS'];const payments=data.ledger.filter(e=>e.tipo==='cobranza').map(e=>({...e,centavos:-Number(e.centavos)})).concat(data.collections.filter(e=>e.tipo==='cobro'));
  rows=payments.filter(e=>inPeriod(e)&&matches(e)).map(e=>[e.fecha,customer(e.clienteId),seller(e.vendedorId??customers.get(e.clienteId)?.vendedorId),cents(e.centavos)]);
 }
 if(type==='deuda'){
  headers=['Cliente','Vendedor','Saldo ARS al cierre','Deuda vencida ARS'];
  const balances=new Map();for(const e of [...data.ledger,...data.collections.map(e=>({...e,centavos:(e.tipo==='cobro'?-1:1)*Number(e.centavos)}))])if(matches(e)&&Date.parse(e.fecha)<Date.parse(filters.hastaExclusivo))balances.set(e.clienteId,(balances.get(e.clienteId)??0)+Number(e.centavos));
  rows=[...balances].map(([id,n])=>[customer(id),seller(customers.get(id)?.vendedorId),cents(n),data.dueBalances===null?'Sin datos confirmados':cents(data.dueBalances.filter(e=>e.clienteId===id&&Date.parse(e.vencimiento)<Date.parse(filters.hastaExclusivo)).reduce((s,e)=>s+Number(e.centavos),0))]);
 }
 if(type==='vendedores'){headers=['Vendedor','Ventas ARS','Entregado ARS','Pedidos','Visitas','Clientes con compra'];rows=report.vendedores.map(v=>[v.nombre,cents(v.vendido),cents(v.importeEntregado),v.pedidos,v.visitas,v.clientesConCompra]);}
 if(type==='objetivos'){headers=['Vendedor','Métrica','Desde','Hasta','Objetivo','Real','Cumplimiento %','Falta'];rows=(data.goals??[]).filter(g=>(!filters.vendedorId||g.vendedorId===filters.vendedorId)&&g.desde<filters.hastaExclusivo&&g.hasta>=filters.desde.slice(0,10)).map(g=>[g.vendedorId?seller(g.vendedorId):'Empresa',g.nombre,g.desde,g.hasta,g.objetivo,g.real,g.cumplimiento,g.falta]);}
 if(type==='clientes'){headers=['Cliente','Documento','Dirección','Vendedor','Zona','Ruta','Lista'];rows=data.customers.filter(c=>matches({clienteId:c.id})).map(c=>[c.nombre,c.documento,c.direccion,seller(c.vendedorId),routes.get(c.rutaId)?.zona,route(c.rutaId),c.listaId?'Lista asignada':'General']);}
 if(type==='rutas'){headers=['Ruta','Zona','Unidades entregadas netas','Importe entregado neto ARS'];rows=report.rutas.map(r=>[r.nombre,routes.get(r.id)?.zona,r.unidades,cents(r.centavos)]);}
 if(type==='productos'){
  headers=['Producto','Unidades entregadas netas','Importe entregado neto ARS'];const aggregate=new Map();for(const e of events)for(const l of e.lineas??[]){const a=aggregate.get(l.productoId)??{unidades:0,centavos:0},sign=e.tipo==='devolucion'?-1:1;a.unidades+=sign*l.unidades;a.centavos+=sign*l.centavos;aggregate.set(l.productoId,a);}const products=new Map(data.products.map(p=>[p.id,p.nombre]));rows=[...aggregate].map(([id,a])=>[products.get(id)??'Producto',a.unidades,cents(a.centavos)]);
 }
 rows.sort((a,b)=>String(a[0]??'').localeCompare(String(b[0]??''),'es'));
 const offset=Number(raw.offset??0),limit=Number(raw.limit??100);if(!Number.isSafeInteger(offset)||offset<0||offset>1e6||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Paginación inválida');
 return {revision:createHash('sha256').update(JSON.stringify({headers,rows,filters,available})).digest('hex'),empresaId:data.empresaId,tipo:type,titulo:REPORT_TYPES[type],filtros:filters,available,headers,total:rows.length,offset,limit,rows:rows.slice(offset,offset+limit)};
}
