import {administrative} from './company-roles.mjs';
import {randomBytes,randomUUID,scrypt,sign,verify,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError} from '../api/receive-order.mjs';
import {assertIsolatedPool} from '../api/postgres-repository.mjs';
import {createCompanyAllowlist} from './company-allowlist.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const derive=promisify(scrypt), encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
export async function passwordRecord(password){if(typeof password!=='string'||password.length<12||password.length>256)throw new ApiError(422,'Contraseña inválida');const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(password,salt,64)).toString('hex')};}
export function createIsolatedAuth({enabled=false,pool,privateKey,publicKey,issuer,now=Date.now,databasePolicy,operational=false,requireSharedCompany=false,commercialMode=false,allowedCompanyIds}={}){
  const companyAllowlist=createCompanyAllowlist(allowedCompanyIds);
  const gate=()=>{if(!enabled||!privateKey||!publicKey||!issuer)throw new ApiError(503,'Identidad aislada no configurada');(databasePolicy?.assertPool??assertIsolatedPool)(pool);};
  const member=async(userId,empresaId)=>{companyAllowlist.assertAllowed(empresaId);const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[userId,JSON.stringify({sub:userId,is_anonymous:false})]);const row=(await c.query('SELECT vendedor_id,rol FROM mayorista.miembros WHERE user_id=$1 AND empresa_id=$2 AND activo',[userId,empresaId])).rows[0];if(row&&operational){const company=(await c.query('SELECT empresa_id,nombre FROM mayorista.empresas WHERE empresa_id=$1 AND habilitada',[empresaId])).rows[0];if(!['gerencia','administracion','vendedor','armador','chofer'].includes(row.rol)||!company)throw new ApiError(403,'Empresa o rol no habilitados');row.empresaNombre=company.nombre;if(row.rol==='vendedor'){const seller=(await c.query('SELECT nombre FROM mayorista.vendedores WHERE empresa_id=$1 AND vendedor_id=$2 AND activo',[empresaId,row.vendedor_id])).rows[0];if(!seller)throw new ApiError(403,'Vendedor inactivo');row.nombre=seller.nombre;}}await c.query('COMMIT');return row;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}};
  const principal=async claims=>{
    companyAllowlist.assertAllowed(claims.empresaId);
    const session=(await pool.query(`SELECT s.user_id,s.empresa_id${operational?',u.nombre,u.email':''} FROM mayorista_private.sesiones s JOIN mayorista_private.usuarios u ON u.user_id=s.user_id WHERE session_id=$1 AND s.user_id=$2 AND empresa_id=$3 AND NOT revocada AND vence_en>now() AND u.activo`,[claims.sid,claims.sub,claims.empresaId])).rows[0];
    if(!session)throw new ApiError(401,'Sesión revocada o vencida');
    const m=await member(claims.sub,claims.empresaId);if(!m)throw new ApiError(403,'Membresía revocada');
    return {userId:claims.sub,sessionId:claims.sid,empresaId:claims.empresaId,vendedorId:m.vendedor_id,rol:m.rol,...(operational?{nombre:session.nombre||m.nombre||session.email,empresaNombre:m.empresaNombre}:{}),expiresAt:claims.exp*1000,permissions:[...(m.rol==='vendedor'||!operational&&m.rol==='administrador'?['pedidos:crear','catalogo:leer']:[]),...(administrative(m)?['admin:gestionar']:[])]};
  };
  async function issue(userId,empresaId,seconds=3600){
      companyAllowlist.assertAllowed(empresaId);
      const sid=randomUUID(),exp=Math.floor(now()/1000)+seconds;
      await pool.query('INSERT INTO mayorista_private.sesiones(session_id,user_id,empresa_id,vence_en) VALUES($1,$2,$3,$4)',[sid,userId,empresaId,new Date(exp*1000)]);
      const header=encode({alg:'EdDSA',typ:'JWT'}),payload=encode({iss:issuer,aud:'sigo-mayorista-isolated',sub:userId,sid,empresaId,iat:Math.floor(now()/1000),exp});const signing=header+'.'+payload;
      return {accessToken:signing+'.'+sign(null,Buffer.from(signing),privateKey).toString('base64url'),expiresAt:exp*1000};
  }
  async function authenticatePassword({email,password}={}){
    gate();if(typeof email!=='string'||email.length>160||typeof password!=='string'||password.length>256)throw new ApiError(401,'Credenciales inválidas');
    const u=(await pool.query('SELECT user_id,salt,password_hash FROM mayorista_private.usuarios WHERE email=$1 AND activo',[email.trim().toLowerCase()])).rows[0];
    const candidate=await derive(password,u?.salt??'cuenta-inexistente',64),expected=Buffer.from(u?.password_hash??'0'.repeat(128),'hex');
    if(!u||expected.length!==candidate.length||!timingSafeEqual(candidate,expected))throw new ApiError(401,'Credenciales inválidas');return u;
  }
  const api={
    sellerCompanies:async credentials=>{
      const u=await authenticatePassword(credentials);
      if(!operational)return {empresas:(await pool.query(`SELECT empresa_id AS "empresaId",'Empresa' AS nombre FROM mayorista.miembros WHERE user_id=$1 AND activo AND rol='vendedor' ${companyAllowlist.ids?"AND empresa_id=ANY($2::uuid[])":""} ORDER BY empresa_id LIMIT 50`,[u.user_id,...(companyAllowlist.ids?[companyAllowlist.ids]:[])])).rows.filter(row=>companyAllowlist.allows(row.empresaId))};
      const c=await pool.connect();let rows;try{await c.query('BEGIN');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[u.user_id]);rows=(await c.query(`SELECT m.empresa_id AS "empresaId",e.nombre FROM mayorista.miembros m JOIN mayorista.empresas e USING(empresa_id) JOIN mayorista.vendedores v ON v.empresa_id=m.empresa_id AND v.vendedor_id=m.vendedor_id WHERE m.user_id=$1 AND m.activo AND m.rol='vendedor' AND e.habilitada AND v.activo ${commercialMode?"AND mayorista_private.commercial_principal(m.user_id,m.empresa_id,m.rol)":requireSharedCompany?"AND EXISTS(SELECT 1 FROM public.empresas se JOIN public.empresa_usuarios su ON su.empresa_id=se.id AND su.user_id=m.user_id AND su.activo JOIN public.sigo_empresa_modulos sm ON sm.empresa_id=se.id AND sm.modulo_clave='mayorista_distribuidora' AND sm.habilitado JOIN public.sigo_mayorista_comercio_fuente sf ON sf.empresa_id=se.id AND sf.fuente='sigo' WHERE se.id=m.empresa_id AND se.activa AND su.rol IN ('owner','admin','seller','warehouse'))":""} ${companyAllowlist.ids?"AND m.empresa_id=ANY($2::uuid[])":""} ORDER BY e.nombre,m.empresa_id LIMIT 51`,[u.user_id,...(companyAllowlist.ids?[companyAllowlist.ids]:[])])).rows;await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      rows=rows.filter(row=>companyAllowlist.allows(row.empresaId));if(!rows.length)throw new ApiError(403,'No tenés una empresa habilitada como vendedor');if(rows.length>50)throw new ApiError(409,'Revisá tus accesos con Administración');return {empresas:rows};
    },
    signIn:async({email,password,empresaId,rememberDevice=false})=>{
      if(!UUID.test(empresaId))throw new ApiError(401,'Credenciales inválidas');companyAllowlist.assertAllowed(empresaId);const u=await authenticatePassword({email,password});
      const membership=await member(u.user_id,empresaId);if(!membership)throw new ApiError(403,'Empresa no autorizada');
      // Opt-in exclusivo de vendedor operativo: vence a los siete días, revocable
      // con los controles de sesión/usuario/membresía ya aplicados en cada request.
      return issue(u.user_id,empresaId,rememberDevice===true&&operational&&membership.rol==='vendedor'?7*86400:3600);
    },
    signInTrustedIdentity:async(userId,empresaId)=>{gate();companyAllowlist.assertAllowed(empresaId);if(!UUID.test(userId)||!UUID.test(empresaId)||!await member(userId,empresaId)||!(await pool.query('SELECT user_id FROM mayorista_private.usuarios WHERE user_id=$1 AND activo',[userId])).rows.length)throw new ApiError(403,'Identidad no autorizada');return issue(userId,empresaId);},
    verify:async token=>{
      gate();if(typeof token!=='string'||token.length>16000)throw new ApiError(401,'Token inválido');
      const parts=token.split('.');let h,c;try{if(parts.length!==3||!verify(null,Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw new Error();h=JSON.parse(Buffer.from(parts[0],'base64url'));c=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw new ApiError(401,'Token inválido');}
      if(h.alg!=='EdDSA'||h.typ!=='JWT'||c.iss!==issuer||c.aud!=='sigo-mayorista-isolated'||!Number.isFinite(c.exp)||c.exp*1000<=now()||!UUID.test(c.sub)||!UUID.test(c.sid)||!UUID.test(c.empresaId))throw new ApiError(401,'Token inválido');
      companyAllowlist.assertAllowed(c.empresaId);return principal(c);
    },
    signOut:async token=>{const p=await api.verify(token);await pool.query('UPDATE mayorista_private.sesiones SET revocada=true WHERE session_id=$1 AND user_id=$2',[p.sessionId,p.userId]);},
    validateSession:async session=>api.verify(session.accessToken)
  };
  return api;
}

