import {construirSolicitud,verificarAcuse} from './contrato-pedidos.js';
/** Transporte opcional. Tokens solo en memoria, sin almacenamiento ni URLs.
 * La cola IndexedDB existente conserva el pedido ante cualquier fallo. */
export function createMayoristaClient({enabled=false,baseUrl,fetchImpl=globalThis.fetch}={}){
  let token=null,principal=null;
  const gate=()=>{if(!enabled)throw new Error('Conexión Mayorista desactivada');const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('API HTTPS independiente inválida');return u.origin;};
  async function request(path,body){
    const url=gate()+path;
    const r=await fetchImpl(url,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let value;try{value=await r.json();}catch{throw new Error('Respuesta inválida del servidor');}
    if(!r.ok){if(r.status===401||r.status===403){token=null;principal=null;}throw new Error(r.status===409?'Conflicto: revisar pedido conservado en el dispositivo':r.status===401?'Volvé a iniciar sesión':r.status===403?'Sin permisos para esta empresa':`Error de sincronización (${r.status})`);}
    return value;
  }
  return {
    login:async credentials=>{token=null;principal=null;const session=await request('/auth/login',credentials);if(typeof session.accessToken!=='string'||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw new Error('Sesión inválida');token=session.accessToken;try{principal=await request('/me');if(principal.empresaId!==credentials.empresaId||!principal.vendedorId)throw new Error('Identidad fuera de la empresa');return {...principal};}catch(e){token=null;principal=null;throw e;}},
    logout:async()=>{try{if(token)await request('/auth/logout',{});}finally{token=null;principal=null;}},
    send:async order=>{gate();if(!token||!principal)throw new Error('Iniciá sesión antes de sincronizar');if(order.empresaId!==principal.empresaId||order.vendedorId!==principal.vendedorId)throw new Error('Pedido fuera de la sesión activa');return verificarAcuse(order,await request('/orders',construirSolicitud(order)));},
    visits:()=>request('/visits'),
    sendVisit:visit=>{if(!token||!principal||visit.empresaId!==principal.empresaId||visit.vendedorId!==principal.vendedorId)throw new Error('Iniciá sesión en la empresa de la visita');return request('/visits',visit);},
    orders:()=>request('/orders'),
    cargas:()=>request('/cargas'),
    cargasCommand:command=>request('/cargas/commands',command),
    catalog:()=>request('/catalog'),
    adminState:()=>request('/admin/state'),
    adminCommand:command=>request('/admin/commands',command),
    fulfillment:command=>request('/admin/fulfillment',command),
    identity:()=>principal?{...principal}:null
  };
}
