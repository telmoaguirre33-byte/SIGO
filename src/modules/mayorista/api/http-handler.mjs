import {measuredJSON} from '../backend/timing.mjs';
import {ApiError} from './receive-order.mjs';
import {approvedOrigins} from './origins.mjs';
const LIMIT=256*1024;
async function readBody(request){
  if(!request.body)throw new ApiError(422,'Pedido vacío');
  const reader=request.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>LIMIT){await reader.cancel();throw new ApiError(413,'Pedido demasiado grande');}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const c of chunks){buffer.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{throw new ApiError(422,'JSON inválido');}
}
/** Adaptador Fetch independiente, sin montaje en SIGO ni servidor que escuche puertos.
 * enabled=false y sin rate limiter/receptor implica 503. No interpreta cookies SIGO. */
export function createOrderHttpHandler({enabled=false,allowedOrigin,integrationOrigins=[],receive,rateLimit}={}){
  return async request=>{
    const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const reply=(status,body)=>new Response(measuredJSON(body),{status,headers});
    if(!enabled || !receive || !rateLimit)return reply(503,{error:'Recepción Mayorista desactivada'});
    let origins;try{origins=approvedOrigins(allowedOrigin,integrationOrigins);}catch{return reply(503,{error:'Origen no configurado'});}
    const requestOrigin=request.headers.get('Origin');
    if(!origins.has(requestOrigin))return reply(403,{error:'Origen no autorizado'});
    headers['Access-Control-Allow-Origin']=requestOrigin;
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
    if(request.method!=='POST')return reply(405,{error:'Método no permitido'});
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'Se requiere JSON'});
    const authorization=request.headers.get('Authorization')??'';
    if(!authorization.startsWith('Bearer ') || !authorization.slice(7).trim())return reply(401,{error:'Sesión requerida'});
    try{
      if(await rateLimit(request)!==true)return reply(429,{error:'Demasiados intentos'});
      const body=await readBody(request);
      const receipt=await receive({token:authorization.slice(7),body});
      return reply(200,receipt);
    }catch(e){const status=e instanceof ApiError?e.status:503;const messages={401:'Sesión inválida',403:'Sin permisos',409:'Pedido requiere revisión',413:'Pedido demasiado grande',422:'Pedido inválido',503:'Servicio no disponible'};return reply(status,{error:messages[status]??'No se pudo recibir el pedido'});}
  };
}

