import {createUserDirectory} from '../commercial/user-directory.mjs';
import {approvedOrigins} from '../api/origins.mjs';
import {administrative} from '../security/company-roles.mjs';
import {ApiError,createOrderReceiver} from '../api/receive-order.mjs';
import {createOrderHttpHandler} from '../api/http-handler.mjs';
import {assertIsolatedPool,createPostgresRepository} from '../api/postgres-repository.mjs';
import {createIsolatedAuth} from '../security/isolated-auth.mjs';
import {createSharedSource} from '../commercial/shared-source.mjs';

async function smallJson(request,limit=4096){
  // Límite real sobre stream, también sin Content-Length.
  const reader=request.body?.getReader();if(!reader)throw new ApiError(422,'Solicitud vacía');
  const chunks=[];let bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();throw new ApiError(413,'Solicitud demasiado grande');}chunks.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(422,'JSON inválido');}
}

/** Backend Mayorista: localhost QA o Railway QA explícito con TLS verificado. No monta rutas en SIGO.
 * Llaves Ed25519 y rate limiter son obligatorios; no contiene credenciales remotas. */
export function createIsolatedService({enabled=false,pool,privateKey,publicKey,origin,issuer,rateLimit,inventoryRequired=false,accountsEnabled=false,databasePolicy,operational=false,readSharedMetrics,integrationOrigins=[],sharedSourceEnabled=false}={}){
  if(databasePolicy&&!operational)throw new ApiError(503,'Railway requiere permisos operativos persistentes');
  if(enabled)(databasePolicy?.assertPool??assertIsolatedPool)(pool);
  const sharedSource=enabled&&sharedSourceEnabled?createSharedSource({pool,databasePolicy:databasePolicy??{assertPool:assertIsolatedPool}}):null;
  const nativeAuth=createIsolatedAuth({enabled,pool,privateKey,publicKey,issuer,databasePolicy,operational});
  const auth={...nativeAuth,verify:async token=>{const p=await nativeAuth.verify(token);return sharedSource?sharedSource.identity(p):p;}};
  const directory=operational?createUserDirectory({pool,databasePolicy}):null;
  const repository=createPostgresRepository({enabled,pool,inventoryRequired,accountsEnabled,databasePolicy,operational,readSharedMetrics,sharedSource});
  const orders=createOrderHttpHandler({enabled,allowedOrigin:origin,integrationOrigins,rateLimit,receive:createOrderReceiver({enabled,auth,repository})});
  return async request=>{
    const path=new URL(request.url).pathname;
    if(path==='/orders'&&request.method!=='GET')return orders(request);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
    if(!enabled||!rateLimit)return reply(503,{error:'Backend aislado desactivado'});
    try{
      const origins=approvedOrigins(origin,integrationOrigins);
      let requestOrigin=request.headers.get('Origin');
      if(!requestOrigin&&request.method==='GET'){try{requestOrigin=new URL(request.headers.get('Referer')).origin;}catch{}}
      if(!origins.has(requestOrigin))return reply(403,{error:'Origen no autorizado'});
      headers['Access-Control-Allow-Origin']=requestOrigin;
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
      if(await rateLimit(request)!==true)return reply(429,{error:'Demasiados intentos'});
      if(path==='/auth/login'&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')return reply(415,{error:'Se requiere JSON'});
        const body=await smallJson(request);
        return reply(200,await auth.signIn(body??{}));
      }
      const token=request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
      if(!token)throw new ApiError(401,'Sesión requerida');
      const principal=await auth.verify(token);
      if(path==='/auth/logout'&&request.method==='POST'){await auth.signOut(token);return reply(200,{revoked:true});}
      if(path==='/me'&&request.method==='GET')return reply(200,principal);
      if(principal.fuenteComercial==='sigo'&&path==='/shared/returns'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedReceipts()));
      if(principal.fuenteComercial==='sigo'&&path==='/shared/pricing'&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const d=await smallJson(request,256*1024);return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedPricing(d)));
      }
      if(principal.fuenteComercial==='sigo'&&['/shared/returns','/shared/returns/inspect'].includes(path)&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const d=await smallJson(request,256*1024);return reply(200,await repository.withPrincipal(principal,tx=>path.endsWith('/inspect')?tx.sharedInspection(d):tx.sharedReturn(d)));
      }
      if(principal.fuenteComercial==='sigo'&&path.startsWith('/shared/customers/')&&request.method==='GET'){
        const id=path.slice('/shared/customers/'.length);if(!/^[a-f0-9-]{36}$/i.test(id))throw new ApiError(422,'Cliente inválido');return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedCustomer(id)));
      }
      if(principal.fuenteComercial==='sigo'&&path==='/shared/collections'){
        if(request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedCollectionPermission()));
        if(request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const d=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedCollection(d)));}
      }
      if(principal.fuenteComercial==='sigo'&&path==='/shared/collectors'&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const d=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedCollector(d)));
      }
      if(path==='/shared/commerce'&&principal.fuenteComercial==='sigo'){
        if(request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedState()));
        if(request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request,256*1024);return reply(200,await repository.withPrincipal(principal,tx=>tx.sharedCommand(command)));}
      }
      if(operational&&['armador','chofer'].includes(principal.rol)&&!path.startsWith('/operations/'))throw new ApiError(403,'Ruta fuera del rol operativo');
      if(operational&&path==='/operations/loads'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.assignedLoads()));
      if(operational&&path==='/operations/loads'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const input=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.publishLoad(input)));}
      if(operational&&path==='/operations/loads/commands'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request,256*1024);return reply(200,await repository.withPrincipal(principal,tx=>tx.assignedLoadCommand(command)));}
      if(operational&&path==='/admin/reports'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.managementReport()));
      if(operational&&path==='/admin/dashboard'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.dashboard(Object.fromEntries(new URL(request.url).searchParams))));
      if(operational&&path==='/goals'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.goals()));
      if(operational&&path==='/admin/goals/commands'&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');
        const command=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.goalCommand(command)));
      }
      if(operational&&path==='/accounts/commands'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.collectionCommand(command)));}
      if(operational&&path==='/admin/users'&&request.method==='GET')return reply(200,await directory.list(principal));
      if(operational&&path==='/admin/users/commands'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request);return reply(200,await directory.command(principal,command));}
      if(operational&&path==='/admin/catalog'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.masterState()));
      if(operational&&path==='/admin/catalog/commands'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.masterCommand(command)));}
      if(path==='/admin/state'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.adminState()));
      if(path==='/admin/commands'&&request.method==='POST'){
        if(!administrative(principal))throw new ApiError(403,'Sin permisos administrativos');
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');
        const command=await smallJson(request);
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command?.id)||!Number.isSafeInteger(command.version))throw new ApiError(422,'Comando inválido');
        return reply(200,await repository.withPrincipal(principal,tx=>tx.adminCommand(command)));
      }
      if(path==='/cargas'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.cargasState()));
      if(path==='/cargas/commands'&&request.method==='POST'){
        if(!administrative(principal))throw new ApiError(403,'Sin permisos de cargas');
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');
        const command=await smallJson(request,256*1024);
        const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(!uuid.test(command?.id)||!Number.isSafeInteger(command.version)||command.input?.cargaId&&!uuid.test(command.input.cargaId)||command.tipo==='crear'&&!uuid.test(command.input?.id)||command.tipo==='aprobar'&&!uuid.test(command.input?.pedidoId))throw new ApiError(422,'Comando inválido');
        return reply(200,await repository.withPrincipal(principal,tx=>tx.cargasCommand(command)));
      }
      if(path==='/visits'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.visits()));
      if(path==='/visits'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const visit=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.receiveVisit(visit)));}
      if(path==='/inventory'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.inventory()));
      if(path==='/inventory/commands'&&request.method==='POST'){if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');const command=await smallJson(request);return reply(200,await repository.withPrincipal(principal,tx=>tx.inventoryCommand(command)));}
      if(path==='/accounts'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.accounts()));
      if(path==='/catalog'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.catalog()));
      if(path==='/admin/fulfillment'&&request.method==='POST'){
        if(!administrative(principal))throw new ApiError(403,'Sin permisos administrativos');
        if(request.headers.get('Content-Type')!=='application/json')throw new ApiError(415,'Se requiere JSON');
        const command=await smallJson(request);
        const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(!uuid.test(command?.pedidoId)||command.tipo&&!uuid.test(command.id))throw new ApiError(422,'Comando inválido');
        if(command.empresaId!==principal.empresaId)throw new ApiError(403,'Otra empresa');
        return reply(200,await repository.withPrincipal(principal,tx=>tx.fulfillment(command)));
      }
      if(path==='/orders'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.list()));
      return reply(404,{error:'Ruta inexistente'});
    }catch(e){const status=e instanceof ApiError?e.status:503;return reply(status,{error:status===401?'Credenciales o sesión inválidas':status===403?'Sin permisos':status===422?'Solicitud inválida':'Servicio no disponible'});}
  };
}
