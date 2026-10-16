import {randomBytes} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {passwordRecord} from './isolated-auth.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Solo lecturas Auth/membresía/flag. Ninguna RPC comercial remota está permitida. */
export function createSigoReadOnlyVerifier({origin,anonKey,fetcher=fetch}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||!anonKey)throw Error('Auth SIGO de QA no configurado');
 return async(token,empresaId)=>{
  const headers={apikey:anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const budget=AbortSignal.timeout(15000);
  const read=async(path,body)=>{
   // Solo lecturas canónicas: un reintento acotado ante red/timeout/5xx/429.
   // Nunca usar permisos almacenados si la fuente de identidad no responde.
   for(let attempt=0;attempt<2;attempt++){
    let r;
    try{r=await fetcher(origin+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([budget,AbortSignal.timeout(4000)])});}
    catch{if(!attempt&&!budget.aborted)continue;throw new ApiError(503,'Verificación SIGO temporalmente no disponible');}
    if(r.status===401||r.status===403)throw new ApiError(r.status,'No se pudo verificar el acceso SIGO');
    if(r.status===429||r.status>=500){if(!attempt&&!budget.aborted)continue;throw new ApiError(503,'Verificación SIGO temporalmente no disponible');}
    if(!r.ok)throw new ApiError(503,'Respuesta de verificación SIGO no disponible');
    try{return await r.json();}catch{throw new ApiError(503,'Respuesta de verificación SIGO inválida');}
   }
  };
  const user=await read('/auth/v1/user');if(!UUID.test(user?.id)||typeof user.email!=='string'||!/^\S+@\S+\.\S+$/.test(user.email))throw new ApiError(401,'Identidad SIGO inválida');
  const companies=await read('/rest/v1/rpc/mis_empresas_sigo',{}),company=Array.isArray(companies)?companies.find(c=>c.empresa_id===empresaId):null;
  if(!company||!['owner','admin'].includes(company.rol))throw new ApiError(403,'La sesión no administra la empresa SIGO autorizada');
  const modules=await read('/rest/v1/rpc/listar_modulos_empresa_sigo',{p_empresa_id:empresaId});
  if(!Array.isArray(modules)||!modules.some(m=>m.clave==='mayorista_distribuidora'&&m.habilitado===true))throw new ApiError(403,'Mayorista desactivado en SIGO');
  return {user,company};
 };
}
/** Vínculo explícito y reversible. Token SIGO solo en memoria; reinicio exige nuevo ingreso.
 * Cada solicitud verifica identidad/rol/flag en origen; nunca escribe allí. */
export function createQaSigoLink({pool,externalEmpresaId,qaEmpresaId,verifyRemote,allowLocalAccounts=false,now=Date.now}){
 if(!UUID.test(externalEmpresaId)||!UUID.test(qaEmpresaId)||typeof verifyRemote!=='function')throw Error('Vínculo QA inválido');
 const sessions=new Map(),inFlight=new Map();
 const scope=async()=>{const r=(await pool.query('SELECT external_empresa_id,qa_empresa_id FROM mayorista_private.qa_interactive_scope WHERE id=true')).rows[0];if(r?.external_empresa_id!==externalEmpresaId||r.qa_empresa_id!==qaEmpresaId)throw new ApiError(503,'Binding QA no verificado');};
 const access=async(token)=>{await scope();if(inFlight.has(token))return inFlight.get(token);const promise=verifyRemote(token,externalEmpresaId).finally(()=>inFlight.delete(token));inFlight.set(token,promise);return promise;};
 return {
  signInLocal:async(input,auth)=>{
   if(!allowLocalAccounts)throw new ApiError(403,'Acceso local QA no habilitado');
   await scope();
   if(input?.empresaId!==qaEmpresaId)throw new ApiError(403,'Empresa fuera del vínculo QA');
   const result=await auth.signIn(input);
   try{
    const p=await auth.verify(result.accessToken);
    const allowed=(await pool.query('SELECT user_id FROM mayorista_private.qa_local_accounts WHERE user_id=$1 AND empresa_id=$2 AND activo',[p.userId,qaEmpresaId])).rows[0];
    if(!allowed)throw new ApiError(403,'Cuenta local fuera de la demostración QA');
    await pool.query('INSERT INTO mayorista_private.qa_local_sessions(session_id,user_id,empresa_id) VALUES($1,$2,$3)',[p.sessionId,p.userId,qaEmpresaId]);
    return result;
   }catch(e){await auth.signOut(result.accessToken).catch(()=>{});throw e;}
  },
  signIn:async(request,id,auth)=>{
   if(id!==externalEmpresaId)throw new ApiError(403,'Esta empresa no está vinculada al QA');
   const token=request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];if(!token||token.length>16000)throw new ApiError(401,'Sesión SIGO requerida');
   const {user,company}=await access(token),role=company.rol==='owner'?'gerencia':'administracion',c=await pool.connect();
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const existing=(await c.query('SELECT activo FROM mayorista_private.usuarios WHERE user_id=$1',[user.id])).rows[0];
    if(existing&&!existing.activo)throw new ApiError(403,'Acceso QA revocado');
    await c.query('INSERT INTO auth.users(id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
    await c.query('INSERT INTO public.empresa_usuarios(empresa_id,user_id,activo,rol) SELECT $1,$2,true,$3 WHERE NOT EXISTS(SELECT 1 FROM public.empresa_usuarios WHERE empresa_id=$1 AND user_id=$2)',[qaEmpresaId,user.id,company.rol]);
    await c.query('UPDATE public.empresa_usuarios SET rol=$3 WHERE empresa_id=$1 AND user_id=$2 AND activo',[qaEmpresaId,user.id,company.rol]);
    if(!existing){const p=await passwordRecord(randomBytes(32).toString('hex'));await c.query('INSERT INTO mayorista_private.usuarios(user_id,email,nombre,salt,password_hash) VALUES($1,$2,$3,$4,$5)',[user.id,user.email.toLowerCase(),user.user_metadata?.nombre??user.email,p.salt,p.hash]);}
    const member=(await c.query('SELECT activo FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[qaEmpresaId,user.id])).rows[0];if(member&&!member.activo)throw new ApiError(403,'Perfil QA revocado');
    await c.query('INSERT INTO mayorista.miembros(empresa_id,user_id,rol,activo) VALUES($1,$2,$3,true) ON CONFLICT(empresa_id,user_id) DO UPDATE SET rol=excluded.rol',[qaEmpresaId,user.id,role]);
    await c.query('INSERT INTO mayorista_private.qa_link_audit(external_empresa_id,qa_empresa_id,user_id,rol) VALUES($1,$2,$3,$4)',[externalEmpresaId,qaEmpresaId,user.id,role]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');if(['23505','40001'].includes(e.code))throw new ApiError(409,'Ingreso concurrente: volvé a intentar');throw e;}finally{c.release();}
   const result=await auth.signInTrustedIdentity(user.id,qaEmpresaId),principal=await auth.verify(result.accessToken);
   // Nunca guardar el token SIGO en DB, respuestas, logs o navegador persistente.
   for(const [key,value] of sessions)if(value.until<=now())sessions.delete(key);
   if(sessions.size>=1000)throw new ApiError(503,'Capacidad de sesiones QA alcanzada');
   sessions.set(principal.sessionId,{token,userId:user.id,role,until:result.expiresAt});return result;
  },
  verify:async principal=>{
   if(principal.empresaId!==qaEmpresaId)throw new ApiError(403,'Empresa fuera del vínculo QA');
   const session=sessions.get(principal.sessionId);
   if(!session&&allowLocalAccounts){
    await scope();
    const local=(await pool.query('SELECT s.session_id FROM mayorista_private.qa_local_sessions s JOIN mayorista_private.qa_local_accounts a ON a.user_id=s.user_id AND a.empresa_id=s.empresa_id AND a.activo WHERE s.session_id=$1 AND s.user_id=$2 AND s.empresa_id=$3',[principal.sessionId,principal.userId,qaEmpresaId])).rows[0];
    if(local)return {...principal,qaAislado:true,sigoEmpresaId:externalEmpresaId};
   }
   if(!session||session.until<=now()||session.userId!==principal.userId)throw new ApiError(401,'Volvé a ingresar desde SIGO para abrir QA');
   const {user,company}=await access(session.token),role=company.rol==='owner'?'gerencia':'administracion';
   if(user.id!==principal.userId||principal.rol!==role||session.role!==role)throw new ApiError(403,'Permisos SIGO modificados; volvé a ingresar');
   return {...principal,qaAislado:true,sigoEmpresaId:externalEmpresaId};
  },
  forget:principal=>sessions.delete(principal.sessionId)
 };
}

