import {construirSolicitud,verificarAcuse} from './contrato-pedidos.js';
/** Transporte opcional. Tokens solo en memoria, sin almacenamiento ni URLs.
 * La cola IndexedDB existente conserva el pedido ante cualquier fallo. */
export function createMayoristaClient({enabled=false,baseUrl,fetchImpl=globalThis.fetch}={}){
  let token=null,principal=null,generation=0;
  const gate=()=>{if(!enabled)throw new Error('Conexión Mayorista desactivada');const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('API HTTPS independiente inválida');return u.origin;};
  async function request(path,body,authorization=token){
    const url=gate()+path;
    const r=await fetchImpl(url,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(authorization?{Authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let value;try{value=await r.json();}catch{throw new Error('Respuesta inválida del servidor');}
    if(!r.ok){if((r.status===401||r.status===403)&&authorization===token){token=null;principal=null;}throw new Error(r.status===409?'Conflicto: revisar pedido conservado en el dispositivo':r.status===401?'Volvé a iniciar sesión':r.status===403?'Sin permisos para esta empresa':`Error de sincronización (${r.status})`);}
    return value;
  }
  return {
    login:async credentials=>{const attempt=++generation;token=null;principal=null;const session=await request('/auth/login',credentials);if(attempt!==generation)throw new Error('Inicio de sesión cancelado');if(typeof session.accessToken!=='string'||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw new Error('Sesión inválida');token=session.accessToken;try{const verified=await request('/me');if(attempt!==generation)throw new Error('Inicio de sesión cancelado');if(verified.empresaId!==credentials.empresaId||!verified.userId||verified.rol==='vendedor'&&!verified.vendedorId)throw new Error('Identidad fuera de la empresa');principal=verified;return {...principal};}catch(e){if(attempt===generation){token=null;principal=null;}throw e;}},
    logout:async()=>{const previous=token;generation++;token=null;principal=null;if(previous)await request('/auth/logout',{},previous);},
    send:async order=>{gate();if(!token||!principal)throw new Error('Iniciá sesión antes de sincronizar');if(order.empresaId!==principal.empresaId||order.vendedorId!==principal.vendedorId)throw new Error('Pedido fuera de la sesión activa');return verificarAcuse(order,await request('/orders',construirSolicitud(order)));},
    visits:()=>request('/visits'),
    sendVisit:visit=>{if(!token||!principal||visit.empresaId!==principal.empresaId||visit.vendedorId!==principal.vendedorId)throw new Error('Iniciá sesión en la empresa de la visita');return request('/visits',visit);},
    orders:()=>request('/orders'),
    cargas:()=>request('/cargas'),
    cargasCommand:command=>request('/cargas/commands',command),
    catalog:()=>request('/catalog'),
    configureSharedPricing:d=>request('/shared/pricing',d),
    reconcileLoadReturn:d=>request('/shared/returns/from-load',d),
    pendingReturns:()=>request('/shared/returns'),
    sharedReturn:d=>request('/shared/returns',d),
    inspectReturn:d=>request('/shared/returns/inspect',d),
    customerProfile:id=>request('/shared/customers/'+encodeURIComponent(id)),
    collectionPermission:()=>request('/shared/collections'),
    authorizedCollection:d=>request('/shared/collections',d),
    configureCollector:d=>request('/shared/collectors',d),
    sharedState:()=>request('/shared/commerce'),
    sharedCommand:command=>request('/shared/commerce',command),
    users:()=>request('/admin/users'),
    sharedUserCandidates:()=>request('/admin/users/candidates'),
    userCommand:command=>request('/admin/users/commands',command),
    masterState:()=>request('/admin/catalog'),
    masterCommand:command=>request('/admin/catalog/commands',command),
    assignedLoads:()=>request('/operations/loads'),
    publishLoad:input=>request('/operations/loads',input),
    loadCommand:command=>request('/operations/loads/commands',command),
    report:()=>request('/admin/reports'),
    dashboard:filters=>request('/admin/dashboard?'+new URLSearchParams(filters??{})),
    goals:()=>request('/goals'),
    goalCommand:command=>request('/admin/goals/commands',command),
    collectionCommand:command=>request('/accounts/commands',command),
    accounts:()=>request('/accounts'),
    inventory:()=>request('/inventory'),
    inventoryCommand:command=>request('/inventory/commands',command),
    adminState:()=>request('/admin/state'),
    adminCommand:command=>request('/admin/commands',command),
    fulfillment:command=>request('/admin/fulfillment',command),
    identity:()=>principal?{...principal}:null
  };
}
