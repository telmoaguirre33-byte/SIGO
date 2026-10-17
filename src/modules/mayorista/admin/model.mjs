// Modelo administrativo nuevo. Se utiliza solo con datos demo hasta configurar auth/API.
function required(value,label) {if(typeof value!=='string' || !value.trim() || value.length>160)throw new Error(label+' inválido');return value.trim();}
export function createAdminState(empresaId) {return {empresaId:required(empresaId,'Empresa'),revision:0,vendedores:[],clientes:[],rutas:[],objetivos:[],vehiculos:[]};}
function scoped(state,input) {if(input.empresaId && input.empresaId!==state.empresaId)throw new Error('Registro de otra empresa');return structuredClone(state);}
function upsert(list,item) {const i=list.findIndex(x=>x.id===item.id);if(i<0)list.push(item);else list[i]=item;}
export function saveSeller(state,input) {
  const next=scoped(state,input), id=required(input.id,'Vendedor');
  if(input.activo===false && next.clientes.some(c=>c.vendedorId===id))throw new Error('Reasigná los clientes antes de desactivar al vendedor');
  upsert(next.vendedores,{id,nombre:required(input.nombre,'Nombre'),zona:required(input.zona,'Zona'),activo:input.activo!==false});return next;
}
export function saveRoute(state,input) {
  const next=scoped(state,input),dias=input.dias??[];if(!Array.isArray(dias)||dias.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('Días de ruta inválidos');upsert(next.rutas,{id:required(input.id,'Ruta'),nombre:required(input.nombre,'Nombre'),zona:required(input.zona,'Zona'),dias:[...new Set(dias)].sort()});return next;
}
export function assignCustomer(state,input) {
  const next=scoped(state,input);
  if(input.orden!==undefined&&(!Number.isSafeInteger(input.orden)||input.orden<0))throw new Error('Orden de recorrido inválido');
  if(!next.vendedores.some(v=>v.id===input.vendedorId && v.activo))throw new Error('Vendedor no habilitado en esta empresa');
  if(!next.rutas.some(r=>r.id===input.rutaId))throw new Error('Ruta no pertenece a esta empresa');
  upsert(next.clientes,{id:required(input.id,'Cliente'),nombre:required(input.nombre,'Nombre'),direccion:required(input.direccion,'Dirección'),vendedorId:input.vendedorId,rutaId:input.rutaId,orden:input.orden??0});return next;
}
export function setGoal(state,input) {
  const next=scoped(state,input);
  if(!next.vendedores.some(v=>v.id===input.vendedorId && v.activo))throw new Error('Vendedor no habilitado');
  if(!Number.isFinite(input.importe) || input.importe<=0 || !Number.isSafeInteger(input.visitas) || input.visitas<1)throw new Error('Objetivo inválido');
  upsert(next.objetivos,{id:input.vendedorId,vendedorId:input.vendedorId,importe:input.importe,visitas:input.visitas});return next;
}
export function managementReport(state,orders,visits) {
  const visible=orders.filter(p=>p.empresaId===state.empresaId);
  const unique=new Map();for(const p of visible)unique.set(p.id,p);
  return state.vendedores.map(v=>{
    const pedidos=[...unique.values()].filter(p=>p.vendedorId===v.id);
    const importe=pedidos.reduce((sum,p)=>sum+p.lineas.reduce((s,l)=>s+l.cantidad*l.precioUnitario,0),0);
    const goal=state.objetivos.find(o=>o.vendedorId===v.id);
    return {vendedor:v.nombre,zona:v.zona,clientes:state.clientes.filter(c=>c.vendedorId===v.id).length,pedidos:pedidos.length,recibidosSimulador:pedidos.filter(p=>p.estado==='sincronizado').length,importe,visitas:visits.filter(x=>x.empresaId===state.empresaId && x.vendedorId===v.id).length,objetivo:goal?.importe??0,avance:goal?Math.round(importe/goal.importe*100):0};
  });
}
export function reportCsv(rows) {
  const fields=['vendedor','zona','clientes','pedidos','recibidosSimulador','importe','visitas','objetivo','avance'];
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[fields.map(cell).join(';'),...rows.map(row=>fields.map(f=>cell(row[f])).join(';'))].join('\r\n');
}

export function saveVehicle(state,input){
 const next=scoped(state,input),capacity=Number(input.capacidad??0);
 if(!Number.isFinite(capacity)||capacity<0)throw new Error('Capacidad inválida');
 next.vehiculos??=[];upsert(next.vehiculos,{id:required(input.id,'Vehículo'),nombre:required(input.nombre,'Nombre'),patente:required(input.patente,'Patente').toUpperCase(),capacidad:capacity,chofer:required(input.chofer,'Chofer'),activo:input.activo!==false});return next;
}
