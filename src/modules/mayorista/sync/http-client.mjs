import {construirSolicitud,verificarAcuse} from './contrato-pedidos.js';
/** Transporte opcional. Tokens solo en memoria, sin almacenamiento ni URLs.
 * La cola IndexedDB existente conserva el pedido ante cualquier fallo. */
export function createMayoristaClient({enabled=false,baseUrl,qaAislado=false,getSigoToken,expectedEmpresaId,fetchImpl=globalThis.fetch}={}){
  let token=null,principal=null,generation=0,renewing=null,closed=0,sessionExpiry=0;
  const gate=()=>{if(!enabled)throw new Error('Conexión Mayorista desactivada');const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('API HTTPS independiente inválida');return u.origin;};
  const failure=(message,status,path)=>Object.assign(new Error(message),{status,path});
  async function request(path,body,authorization=token,recovered=false){
    const url=gate()+path,isAuth=path.startsWith('/auth/'),epoch=closed;let r;
    try{r=await fetchImpl(url,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(authorization?{Authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw failure('No se pudo conectar con Mayorista. Conservamos la operación; volvé a intentar.',0,path);}
    let value;try{value=await r.json();}catch{throw failure('Respuesta inválida del servidor',r.status,path);}
    if(!r.ok){
      if(r.status===401){
        if(getSigoToken&&expectedEmpresaId&&!isAuth&&!recovered&&epoch===closed&&(authorization===token||renewing||principal)){
          const previous=principal;
          if(!renewing)renewing=(async()=>{const sigoToken=await getSigoToken();if(epoch!==closed)throw failure('Acceso cancelado',401,path);const verified=await api.loginSigo(expectedEmpresaId,sigoToken);if(previous&&['empresaId','userId','rol'].some(k=>verified[k]!==previous[k])){await api.logout();throw failure('La identidad o los permisos cambiaron. Revalidá el acceso desde SIGO.',403,path);}})().catch(e=>{if(epoch===closed){token=null;principal=null;}throw e;}).finally(()=>{renewing=null;});
          await renewing;if(epoch!==closed)throw failure('Acceso cancelado',401,path);return request(path,body,token,true);
        }
        if(authorization===token){token=null;principal=null;}
      }
      if(path.startsWith('/admin/launch')||path.startsWith('/admin/reports/export')){const messages={409:'Los datos cambiaron en otra sesión. Actualizá y revisá antes de reintentar.',422:value.error||'Revisá los datos ingresados.',413:'El archivo supera el tamaño permitido. Dividilo en archivos más pequeños.',429:'Hay muchas solicitudes. Esperá unos segundos y volvé a intentar.'};if(messages[r.status])throw failure(messages[r.status],r.status,path);}
      // Un 403 de una función no revoca una sesión válida para otras funciones.
      throw failure(r.status===409?'Conflicto: revisar pedido conservado en el dispositivo':r.status===401?'Revalidá tu acceso desde SIGO':r.status===403?'Sin permisos para esta empresa o función':`Error de sincronización (${r.status}). Conservamos la operación; volvé a intentar.`,r.status,path);
    }
    return value;
  }
  const api={
    savedSession:()=>token&&principal?{accessToken:token,expiresAt:sessionExpiry,empresaId:principal.empresaId,userId:principal.userId,vendedorId:principal.vendedorId}:null,
    resume:async session=>{const attempt=++generation;token=null;principal=null;if(typeof session?.accessToken!=='string'||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw failure('Tu acceso venció. Ingresá nuevamente; los pedidos están conservados.',401,'/me');token=session.accessToken;sessionExpiry=session.expiresAt;try{const verified=await request('/me');if(attempt!==generation||['empresaId','userId','vendedorId'].some(k=>verified[k]!==session[k]))throw failure('El acceso del dispositivo cambió',403,'/me');principal=verified;return {...verified};}catch(e){if(attempt===generation){token=null;principal=null;}throw e;}},
    sellerCompanies:credentials=>request('/auth/companies',credentials,null),
    login:async credentials=>{const attempt=++generation;token=null;principal=null;const session=await request('/auth/login',credentials);if(attempt!==generation)throw new Error('Inicio de sesión cancelado');if(typeof session.accessToken!=='string'||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw new Error('Sesión inválida');token=session.accessToken;sessionExpiry=session.expiresAt;try{const verified=await request('/me');if(attempt!==generation)throw new Error('Inicio de sesión cancelado');if(verified.empresaId!==credentials.empresaId||!verified.userId||verified.rol==='vendedor'&&!verified.vendedorId)throw new Error('Identidad fuera de la empresa');principal=verified;return {...principal};}catch(e){if(attempt===generation){token=null;principal=null;}throw e;}},
    loginSigo:async(empresaId,sigoToken)=>{const attempt=++generation;token=null;principal=null;const session=await request('/auth/sigo',{empresaId},sigoToken);if(attempt!==generation)throw Error('Acceso cancelado');if(typeof session.accessToken!=='string'||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw Error('Sesión SIGO no validada');token=session.accessToken;sessionExpiry=session.expiresAt;try{const verified=await request('/me',undefined,token,true);if(attempt!==generation)throw Error('Acceso cancelado');if(verified.empresaId!==empresaId&&!(qaAislado&&verified.qaAislado===true&&verified.sigoEmpresaId===empresaId)||!verified.userId)throw Error('Empresa SIGO no validada');principal=verified;return {...principal};}catch(e){if(attempt===generation){token=null;principal=null;}throw e;}},
    logout:async()=>{const previous=token;closed++;generation++;token=null;principal=null;if(previous)await request('/auth/logout',{},previous);},
    send:async order=>{gate();if(!token||!principal)throw new Error('Iniciá sesión antes de sincronizar');if(order.empresaId!==principal.empresaId||order.vendedorId!==principal.vendedorId)throw new Error('Pedido fuera de la sesión activa');return verificarAcuse(order,await request('/orders',construirSolicitud(order)));},
    visits:()=>request('/visits'),
    sendVisit:visit=>{if(!token||!principal||visit.empresaId!==principal.empresaId||visit.vendedorId!==principal.vendedorId)throw new Error('Iniciá sesión en la empresa de la visita');return request('/visits',visit);},
    exportReport:filters=>request('/admin/reports/export?'+new URLSearchParams(filters)),
    subscriptionState:()=>request('/admin/launch/subscription'),
    subscriptionCommand:c=>request('/admin/launch/subscription',c),
    launchState:()=>request('/admin/launch'),
    launchCommand:c=>request('/admin/launch',c),
    customersPage:filters=>request('/admin/launch/customers?'+new URLSearchParams(filters)),
    assignCustomers:c=>request('/admin/launch/customers',c),
    importState:(id,filters={})=>request('/admin/launch/imports?'+new URLSearchParams({...filters,id})),
    prepareImport:c=>request('/admin/launch/imports',c),
    processImport:c=>request('/admin/launch/imports/process',c),
    orderHistory:filters=>request('/orders/history?'+new URLSearchParams(filters)),
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
    devices:()=>request('/auth/devices'),
    revokeDevice:sessionId=>request('/auth/devices',{sessionId}),
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
  return api;
}

