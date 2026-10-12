import {ApiError,createOrderReceiver} from '../api/receive-order.mjs';
import {createOrderHttpHandler} from '../api/http-handler.mjs';
import {assertIsolatedPool,createPostgresRepository} from '../api/postgres-repository.mjs';
import {createIsolatedAuth} from '../security/isolated-auth.mjs';

/** Backend real exclusivamente local/efímero. No monta rutas en SIGO.
 * Llaves Ed25519 y rate limiter son obligatorios; no contiene credenciales remotas. */
export function createIsolatedService({enabled=false,pool,privateKey,publicKey,origin,issuer,rateLimit}={}){
  if(enabled)assertIsolatedPool(pool);
  const auth=createIsolatedAuth({enabled,pool,privateKey,publicKey,issuer});
  const repository=createPostgresRepository({enabled,pool});
  const orders=createOrderHttpHandler({enabled,allowedOrigin:origin,rateLimit,receive:createOrderReceiver({enabled,auth,repository})});
  return async request=>{
    const path=new URL(request.url).pathname;
    if(path==='/orders'&&request.method!=='GET')return orders(request);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
    if(!enabled||!rateLimit)return reply(503,{error:'Backend aislado desactivado'});
    try{
      const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)return reply(503,{error:'Origen no configurado'});
      if(request.headers.get('Origin')!==origin)return reply(403,{error:'Origen no autorizado'});
      headers['Access-Control-Allow-Origin']=origin;
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
      if(await rateLimit(request)!==true)return reply(429,{error:'Demasiados intentos'});
      if(path==='/auth/login'&&request.method==='POST'){
        if(request.headers.get('Content-Type')!=='application/json')return reply(415,{error:'Se requiere JSON'});
        // Límite real sobre stream, también sin Content-Length.
        const reader=request.body?.getReader();if(!reader)throw new ApiError(422,'Solicitud vacía');
        const chunks=[];let bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();throw new ApiError(413,'Solicitud demasiado grande');}chunks.push(value);}}finally{reader.releaseLock();}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(422,'JSON inválido');}
        return reply(200,await auth.signIn(body??{}));
      }
      const token=request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
      if(!token)throw new ApiError(401,'Sesión requerida');
      const principal=await auth.verify(token);
      if(path==='/auth/logout'&&request.method==='POST'){await auth.signOut(token);return reply(200,{revoked:true});}
      if(path==='/me'&&request.method==='GET')return reply(200,principal);
      if(path==='/orders'&&request.method==='GET')return reply(200,await repository.withPrincipal(principal,tx=>tx.list()));
      return reply(404,{error:'Ruta inexistente'});
    }catch(e){const status=e instanceof ApiError?e.status:503;return reply(status,{error:status===401?'Credenciales o sesión inválidas':status===403?'Sin permisos':status===422?'Solicitud inválida':'Servicio no disponible'});}
  };
}
