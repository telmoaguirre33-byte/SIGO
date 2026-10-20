import {randomBytes} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {passwordRecord} from './isolated-auth.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
/** Solo entorno Auth SIGO configurado por el servidor. No se aceptan issuer/URL desde el cliente. */
export function trustedSigoVerifier(env){
 if(!env.MAYORISTA_SIGO_AUTH_URL||!env.MAYORISTA_SIGO_AUTH_ANON_KEY)return null;
 const u=new URL(env.MAYORISTA_SIGO_AUTH_URL);if(u.protocol!=='https:'||u.origin!==env.MAYORISTA_SIGO_AUTH_URL||u.username||u.password)throw Error('Origen Auth SIGO inválido');
 return async token=>{const response=await fetch(u.origin+'/auth/v1/user',{headers:{apikey:env.MAYORISTA_SIGO_AUTH_ANON_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new ApiError(401,'Sesión SIGO no válida');return response.json();};
}
export function createSigoBridge({pool,authenticateSigo,sourceRevision,auth,commercialMode=false}){
 return async(request,empresaId)=>{
  if(typeof authenticateSigo!=='function'||!/^[a-f0-9]{40}$/.test(sourceRevision??''))throw new ApiError(503,'El acceso desde SIGO requiere su entorno Auth aprobado');
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token||token.length>16000||!uuid(empresaId))throw new ApiError(401,'Sesión SIGO requerida');
  const user=await authenticateSigo(token);if(!uuid(user?.id)||typeof user.email!=='string'||!/^\S+@\S+\.\S+$/.test(user.email))throw new ApiError(401,'Identidad SIGO no válida');
  if(commercialMode){
   const r=await passwordRecord(randomBytes(32).toString('hex'));
   try{await pool.query('SELECT mayorista_private.bootstrap_commercial_identity($1,$2,$3,$4,$5,$6)',[user.id,empresaId,user.email.toLowerCase(),r.salt,r.hash,sourceRevision]);}
   catch(error){
    if(error.code==='42501'&&['COMMERCIAL_FORBIDDEN','COMMERCIAL_REVOKED'].includes(error.message))throw new ApiError(403,'Mayorista no habilitado o empresa no autorizada');
    throw error;
   }
   return auth.signInTrustedIdentity(user.id,empresaId);
  }
  const c=await pool.connect();try{
   await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
   const ready=(await c.query("SELECT to_regprocedure('public.cotizar_pedido_mayorista_sigo(uuid,uuid,jsonb)') AS price,to_regprocedure('public.leer_ficha_mayorista_sigo(uuid,uuid)') AS profile")).rows[0];if(!ready.price||!ready.profile)throw new ApiError(503,'Fuente SIGO pendiente de integrar en este entorno');
   const company=(await c.query("SELECT eu.rol,coalesce(to_jsonb(e)->>'nombre','Empresa SIGO') AS nombre FROM public.empresas e JOIN public.empresa_usuarios eu ON eu.empresa_id=e.id AND eu.user_id=$2 AND eu.activo JOIN public.sigo_empresa_modulos m ON m.empresa_id=e.id AND m.modulo_clave='mayorista_distribuidora' AND m.habilitado WHERE e.id=$1 AND e.activa AND eu.rol IN ('owner','admin') FOR UPDATE OF e",[empresaId,user.id])).rows[0];if(!company)throw new ApiError(403,'Mayorista no habilitado o empresa no autorizada');
   const source=(await c.query('SELECT fuente FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=$1',[empresaId])).rows[0];
   if(source&&source.fuente!=='sigo')throw new ApiError(409,'La fuente existente requiere conciliación antes del vínculo SIGO');
   if(!source&&(await c.query('SELECT 1 FROM mayorista.productos WHERE empresa_id=$1 UNION ALL SELECT 1 FROM mayorista.inventario WHERE empresa_id=$1 UNION ALL SELECT 1 FROM mayorista.cuenta_movimientos WHERE empresa_id=$1 LIMIT 1',[empresaId])).rows.length)throw new ApiError(409,'Conservar operaciones existentes y conciliar su fuente antes del vínculo SIGO');
   const existing=(await c.query('SELECT habilitada FROM mayorista.empresas WHERE empresa_id=$1',[empresaId])).rows[0];if(existing&&!existing.habilitada)throw new ApiError(403,'Acceso Mayorista desactivado administrativamente');
   await c.query('INSERT INTO mayorista.empresas(empresa_id,nombre,habilitada) VALUES($1,$2,true) ON CONFLICT(empresa_id) DO NOTHING',[empresaId,company.nombre]);
   const privateUser=(await c.query('SELECT activo FROM mayorista_private.usuarios WHERE user_id=$1',[user.id])).rows[0];if(privateUser&&!privateUser.activo)throw new ApiError(403,'Acceso Mayorista revocado');
   if(!privateUser){const r=await passwordRecord(randomBytes(32).toString('hex'));await c.query('INSERT INTO mayorista_private.usuarios(user_id,email,salt,password_hash,nombre) VALUES($1,$2,$3,$4,$5)',[user.id,user.email.toLowerCase(),r.salt,r.hash,user.user_metadata?.nombre??user.user_metadata?.full_name??user.email]);}
   const membership=(await c.query('SELECT activo FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[empresaId,user.id])).rows[0];if(membership&&!membership.activo)throw new ApiError(403,'Perfil Mayorista revocado');
   await c.query('INSERT INTO mayorista.miembros(empresa_id,user_id,rol,activo) VALUES($1,$2,$3,true) ON CONFLICT(empresa_id,user_id) DO NOTHING',[empresaId,user.id,company.rol==='owner'?'gerencia':'administracion']);
   await c.query("INSERT INTO public.sigo_mayorista_comercio_fuente(empresa_id,fuente,backend_revision,actor_id) VALUES($1,'sigo',$2,$3) ON CONFLICT(empresa_id) DO NOTHING",[empresaId,sourceRevision,user.id]);
   await c.query('COMMIT');return auth.signInTrustedIdentity(user.id,empresaId);
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505'||e.code==='40001')throw new ApiError(409,'Vínculo concurrente: reintentá con la misma empresa');throw e;}finally{c.release();}
 };
}

