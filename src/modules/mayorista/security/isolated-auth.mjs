import {administrative} from './company-roles.mjs';
import {randomBytes,randomUUID,scrypt,sign,verify,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError} from '../api/receive-order.mjs';
import {assertIsolatedPool} from '../api/postgres-repository.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const derive=promisify(scrypt), encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
export async function passwordRecord(password){if(typeof password!=='string'||password.length<12||password.length>256)throw new ApiError(422,'Contraseña inválida');const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(password,salt,64)).toString('hex')};}
export function createIsolatedAuth({enabled=false,pool,privateKey,publicKey,issuer,now=Date.now,databasePolicy,operational=false}={}){
  const gate=()=>{if(!enabled||!privateKey||!publicKey||!issuer)throw new ApiError(503,'Identidad aislada no configurada');(databasePolicy?.assertPool??assertIsolatedPool)(pool);};
  const member=async(userId,empresaId)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[userId,JSON.stringify({sub:userId,is_anonymous:false})]);const row=(await c.query('SELECT vendedor_id,rol FROM mayorista.miembros WHERE user_id=$1 AND empresa_id=$2 AND activo',[userId,empresaId])).rows[0];if(row&&operational){const company=(await c.query('SELECT empresa_id,nombre FROM mayorista.empresas WHERE empresa_id=$1 AND habilitada',[empresaId])).rows[0];if(!['gerencia','administracion','vendedor','armador','chofer'].includes(row.rol)||!company)throw new ApiError(403,'Empresa o rol no habilitados');row.empresaNombre=company.nombre;if(row.rol==='vendedor'){const seller=(await c.query('SELECT nombre FROM mayorista.vendedores WHERE empresa_id=$1 AND vendedor_id=$2 AND activo',[empresaId,row.vendedor_id])).rows[0];if(!seller)throw new ApiError(403,'Vendedor inactivo');row.nombre=seller.nombre;}}await c.query('COMMIT');return row;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}};
  const principal=async claims=>{
    const session=(await pool.query(`SELECT s.user_id,s.empresa_id${operational?',u.nombre,u.email':''} FROM mayorista_private.sesiones s JOIN mayorista_private.usuarios u ON u.user_id=s.user_id WHERE session_id=$1 AND s.user_id=$2 AND empresa_id=$3 AND NOT revocada AND vence_en>now() AND u.activo`,[claims.sid,claims.sub,claims.empresaId])).rows[0];
    if(!session)throw new ApiError(401,'Sesión revocada o vencida');
    const m=await member(claims.sub,claims.empresaId);if(!m)throw new ApiError(403,'Membresía revocada');
    return {userId:claims.sub,sessionId:claims.sid,empresaId:claims.empresaId,vendedorId:m.vendedor_id,rol:m.rol,...(operational?{nombre:session.nombre||m.nombre||session.email,empresaNombre:m.empresaNombre}:{}),expiresAt:claims.exp*1000,permissions:[...(m.rol==='vendedor'||!operational&&m.rol==='administrador'?['pedidos:crear','catalogo:leer']:[]),...(administrative(m)?['admin:gestionar']:[])]};
  };
  const api={
    signIn:async({email,password,empresaId})=>{
      gate();if(typeof email!=='string'||email.length>160||typeof password!=='string'||password.length>256||!UUID.test(empresaId))throw new ApiError(401,'Credenciales inválidas');
      const u=(await pool.query('SELECT user_id,salt,password_hash FROM mayorista_private.usuarios WHERE email=$1 AND activo',[email.trim().toLowerCase()])).rows[0];
      const candidate=await derive(password,u?.salt??'cuenta-inexistente',64);const expected=Buffer.from(u?.password_hash??'0'.repeat(128),'hex');
      if(!u||expected.length!==candidate.length||!timingSafeEqual(candidate,expected))throw new ApiError(401,'Credenciales inválidas');
      if(!await member(u.user_id,empresaId))throw new ApiError(403,'Empresa no autorizada');
      const sid=randomUUID(),exp=Math.floor(now()/1000)+3600;
      await pool.query('INSERT INTO mayorista_private.sesiones(session_id,user_id,empresa_id,vence_en) VALUES($1,$2,$3,$4)',[sid,u.user_id,empresaId,new Date(exp*1000)]);
      const header=encode({alg:'EdDSA',typ:'JWT'}),payload=encode({iss:issuer,aud:'sigo-mayorista-isolated',sub:u.user_id,sid,empresaId,iat:Math.floor(now()/1000),exp});const signing=header+'.'+payload;
      return {accessToken:signing+'.'+sign(null,Buffer.from(signing),privateKey).toString('base64url'),expiresAt:exp*1000};
    },
    verify:async token=>{
      gate();if(typeof token!=='string'||token.length>16000)throw new ApiError(401,'Token inválido');
      const parts=token.split('.');let h,c;try{if(parts.length!==3||!verify(null,Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw new Error();h=JSON.parse(Buffer.from(parts[0],'base64url'));c=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw new ApiError(401,'Token inválido');}
      if(h.alg!=='EdDSA'||h.typ!=='JWT'||c.iss!==issuer||c.aud!=='sigo-mayorista-isolated'||!Number.isFinite(c.exp)||c.exp*1000<=now()||!UUID.test(c.sub)||!UUID.test(c.sid)||!UUID.test(c.empresaId))throw new ApiError(401,'Token inválido');
      return principal(c);
    },
    signOut:async token=>{const p=await api.verify(token);await pool.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE session_id=$1 AND user_id=$2',[p.sessionId,p.userId]);},
    validateSession:async session=>api.verify(session.accessToken)
  };
  return api;
}
