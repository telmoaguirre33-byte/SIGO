import {createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError} from '../api/receive-order.mjs';
import {assertIsolatedPool} from '../api/postgres-repository.mjs';
import {passwordRecord} from '../security/isolated-auth.mjs';
import {canonical} from '../cargas/model.mjs';
const derive=promisify(scrypt),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Frontera privilegiada limitada a cuentas del módulo nuevo. Contraseñas siempre
 * scrypt con salt; ni respuestas ni auditoría contienen contraseña o hash rápido de ella. */
export function createUserDirectory({pool,databasePolicy}){
 async function transaction(principal,write,fn){
  (databasePolicy?.assertPool??assertIsolatedPool)(pool);const c=await pool.connect();try{
   await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const actor=(await c.query('SELECT m.rol FROM mayorista.miembros m JOIN mayorista.empresas e USING(empresa_id) JOIN mayorista_private.usuarios u ON u.user_id=m.user_id JOIN mayorista_private.sesiones s ON s.user_id=m.user_id AND s.empresa_id=m.empresa_id WHERE m.empresa_id=$1 AND m.user_id=$2 AND s.session_id=$3 AND m.activo AND u.activo AND e.habilitada AND NOT s.revocada AND s.vence_en>now() FOR UPDATE OF m,s,u',[principal.empresaId,principal.userId,principal.sessionId])).rows[0];
   if(!actor||!(write?['gerencia']:['gerencia','administracion']).includes(actor.rol))throw new ApiError(403,'Gestión de accesos no autorizada');const result=await fn(c);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23503')throw new ApiError(422,'Vendedor de otra empresa o inexistente');if(['23505','40001','40P01'].includes(e.code))throw new ApiError(409,'Edición concurrente o usuario no disponible');throw e;}finally{c.release();}
 }
 return {
  devices:principal=>transaction(principal,true,async c=>(await c.query('SELECT s.session_id AS id,s.user_id AS "userId",u.nombre,u.email,s.vence_en AS "venceEn",s.revocada FROM mayorista_private.sesiones s JOIN mayorista_private.usuarios u ON u.user_id=s.user_id JOIN mayorista.miembros m ON m.user_id=s.user_id AND m.empresa_id=s.empresa_id WHERE s.empresa_id=$1 AND s.vence_en>now() ORDER BY s.vence_en DESC LIMIT 200',[principal.empresaId])).rows),
  revokeDevice:(principal,id)=>transaction(principal,true,async c=>{if(!uuid.test(id))throw new ApiError(422,'Dispositivo inválido');if(id===principal.sessionId)throw new ApiError(422,'Usá Cerrar sesión para salir de este dispositivo');const r=await c.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE session_id=$1 AND empresa_id=$2 RETURNING session_id',[id,principal.empresaId]);if(!r.rows.length)throw new ApiError(404,'Dispositivo no disponible');return {revoked:true};}),
  candidates:principal=>transaction(principal,false,async c=>{if(principal.fuenteComercial!=='sigo')return [];return (await c.query("SELECT eu.user_id AS id,coalesce(to_jsonb(u)->>'email',eu.user_id::text) AS email,coalesce(to_jsonb(u)->'raw_user_meta_data'->>'nombre',to_jsonb(u)->'raw_user_meta_data'->>'full_name',to_jsonb(u)->>'email',eu.user_id::text) AS nombre,eu.rol FROM public.empresa_usuarios eu JOIN auth.users u ON u.id=eu.user_id WHERE eu.empresa_id=$1 AND eu.activo AND eu.rol<>'client' AND NOT EXISTS(SELECT 1 FROM mayorista.miembros m WHERE m.empresa_id=eu.empresa_id AND m.user_id=eu.user_id) ORDER BY eu.user_id",[principal.empresaId])).rows;}),
  list:principal=>transaction(principal,false,async c=>(await c.query('SELECT m.user_id AS id,u.nombre,u.email,m.rol,m.vendedor_id AS "vendedorId",m.activo FROM mayorista.miembros m JOIN mayorista_private.usuarios u ON u.user_id=m.user_id WHERE m.empresa_id=$1 ORDER BY u.email',[principal.empresaId])).rows),
  command:(principal,command)=>transaction(principal,true,async c=>{
   if(command?.empresaId!==principal.empresaId)throw new ApiError(403,'Empresa ajena');const i=command.input;
   if(!uuid.test(command.id)||!['crear','permisos','password'].includes(command.tipo)||!i||typeof i!=='object')throw new ApiError(422,'Comando de usuario inválido');const id=command.tipo==='crear'?(principal.fuenteComercial==='sigo'?i.userId:command.id):i.userId;if(!uuid.test(id))throw new ApiError(422,'Usuario inválido');
   if(command.tipo==='permisos'&&id===principal.userId)throw new ApiError(422,'No se cambia ni desactiva el acceso de la sesión propia');
   const publicInput=command.tipo==='crear'?{...(principal.fuenteComercial==='sigo'?{userId:i.userId}:{}),nombre:i.nombre,email:i.email,rol:i.rol,vendedorId:i.vendedorId??null}:command.tipo==='permisos'?{userId:i.userId,rol:i.rol,vendedorId:i.vendedorId??null,activo:i.activo}:{userId:i.userId};const hash=createHash('sha256').update(JSON.stringify(canonical({tipo:command.tipo,input:publicInput}))).digest('hex');
   const previous=(await c.query('SELECT huella,respuesta FROM mayorista_private.user_commands WHERE empresa_id=$1 AND comando_id=$2',[principal.empresaId,command.id])).rows[0];
   if(previous){if(previous.huella!==hash)throw new ApiError(409,'UUID de usuario reutilizado');if(command.tipo==='crear'||command.tipo==='password'){const user=(await c.query('SELECT u.salt,u.password_hash FROM mayorista_private.usuarios u JOIN mayorista.miembros m ON m.user_id=u.user_id WHERE m.empresa_id=$1 AND u.user_id=$2',[principal.empresaId,id])).rows[0];if(!user||typeof i.password!=='string'||i.password.length>256||!timingSafeEqual(await derive(i.password,user.salt,64),Buffer.from(user.password_hash,'hex')))throw new ApiError(409,'El reintento no corresponde a la clave actual');}return previous.respuesta;}
   if(principal.fuenteComercial==='sigo'){
    const shared=(await c.query("SELECT eu.rol,to_jsonb(u)->>'email' AS email FROM public.empresa_usuarios eu JOIN auth.users u ON u.id=eu.user_id WHERE eu.empresa_id=$1 AND eu.user_id=$2 AND eu.activo",[principal.empresaId,id])).rows[0];
    if(!shared||!['owner','admin','seller','warehouse'].includes(shared.rol)||i.rol==='gerencia'&&shared.rol!=='owner'||i.rol==='administracion'&&!['owner','admin'].includes(shared.rol))throw new ApiError(422,'Elegí un usuario SIGO compatible de esta empresa');
    if(command.tipo==='crear'&&shared.email&&shared.email.toLowerCase()!==i.email?.trim().toLowerCase())throw new ApiError(422,'Usá el email existente de Usuarios SIGO');
   }
   if(command.tipo==='crear'||command.tipo==='permisos'){
    if(!['gerencia','administracion','vendedor','armador','chofer'].includes(i.rol)||i.rol==='vendedor'&&!uuid.test(i.vendedorId)||i.rol!=='vendedor'&&i.vendedorId!==null&&i.vendedorId!==undefined)throw new ApiError(422,'Rol o vendedor inválidos');
    if(command.tipo==='crear'){
     if(typeof i.email!=='string'||i.email.length>160||!/^\S+@\S+\.\S+$/.test(i.email.trim())||typeof i.nombre!=='string'||!i.nombre.trim()||i.nombre.length>160)throw new ApiError(422,'Nombre o email inválidos');const r=await passwordRecord(i.password),existing=principal.fuenteComercial==='sigo'?(await c.query('SELECT salt,password_hash,email FROM mayorista_private.usuarios WHERE user_id=$1',[id])).rows[0]:null;if(existing){if(existing.email!==i.email.trim().toLowerCase()||!timingSafeEqual(await derive(i.password,existing.salt,64),Buffer.from(existing.password_hash,'hex')))throw new ApiError(409,'La cuenta ya tiene clave Mayorista; usá esa clave para vincular otra empresa');}else await c.query('INSERT INTO mayorista_private.usuarios(user_id,email,nombre,salt,password_hash) VALUES($1,$2,$3,$4,$5)',[id,i.email.trim().toLowerCase(),i.nombre.trim(),r.salt,r.hash]);await c.query('INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol,activo) VALUES($1,$2,$3,$4,true)',[principal.empresaId,id,i.vendedorId??null,i.rol]);
    }else{if(typeof i.activo!=='boolean')throw new ApiError(422,'Estado inválido');const r=await c.query('UPDATE mayorista.miembros SET rol=$3,vendedor_id=$4,activo=$5 WHERE empresa_id=$1 AND user_id=$2',[principal.empresaId,id,i.rol,i.vendedorId??null,i.activo]);if(r.rowCount!==1)throw new ApiError(404,'Usuario no disponible');}
   }
   if(command.tipo==='password'){if((await c.query('SELECT count(*)::int AS n FROM mayorista.miembros WHERE user_id=$1',[id])).rows[0].n!==1)throw new ApiError(409,'Cuenta compartida: recuperación requiere un operador autorizado');const owned=await c.query('SELECT user_id FROM mayorista.miembros WHERE empresa_id=$1 AND user_id=$2',[principal.empresaId,id]);if(!owned.rows.length)throw new ApiError(404,'Usuario no disponible');const r=await passwordRecord(i.password);await c.query('UPDATE mayorista_private.usuarios SET salt=$2,password_hash=$3 WHERE user_id=$1',[id,r.salt,r.hash]);}
   if(command.tipo!=='crear')await c.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE empresa_id=$1 AND user_id=$2',[principal.empresaId,id]);
   const response={id,empresaId:principal.empresaId,tipo:command.tipo};await c.query('INSERT INTO mayorista_private.user_commands(empresa_id,comando_id,actor_id,huella,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)',[principal.empresaId,command.id,principal.userId,hash,JSON.stringify(response)]);return response;
  })
 };
}

