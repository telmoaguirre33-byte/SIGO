import {ApiError} from './receive-order.mjs';

/** Solo para un proyecto de pruebas expresamente aprobado. No lee configuración SIGO.
 * lookupMembership y isSessionActive consultan la base aislada con JWT/RLS del usuario.
 * No basta decodificar JWT ni tomar roles de user_metadata. */
export function createTestProjectAuth({enabled=false,projectUrl,approvedTestProjectRef,publishableKey,empresaId,lookupMembership,isSessionActive,fetchImpl=fetch,now=Date.now}={}) {
  const validTarget=()=>{
    if(!enabled || !approvedTestProjectRef || !empresaId || !publishableKey?.startsWith('sb_publishable_') || !lookupMembership || !isSessionActive) return false;
    try{const url=new URL(projectUrl);return url.protocol==='https:' && url.origin===projectUrl && !url.username && !url.password && url.hostname===approvedTestProjectRef+'.supabase.co';}catch{return false;}
  };
  return {verify:async token=>{
    if(!validTarget())throw new ApiError(503,'Autenticación de pruebas no configurada');
    if(typeof token!=='string' || token.length>16000 || token.split('.').length!==3)throw new ApiError(401,'Token inválido');
    // getUser verifica el token contra el proyecto aprobado antes de usar cualquier claim.
    const response=await fetchImpl(projectUrl+'/auth/v1/user',{headers:{apikey:publishableKey,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw new ApiError(401,'Sesión inválida');
    const user=await response.json();
    let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{throw new ApiError(401,'Token inválido');}
    const expiresAt=Number(claims.exp)*1000;
    if(!user.id || claims.sub!==user.id || user.is_anonymous || claims.is_anonymous || !claims.session_id ||
        !(claims.aud==='authenticated'||Array.isArray(claims.aud)&&claims.aud.includes('authenticated')) ||
        !Number.isFinite(expiresAt) || expiresAt<=now())throw new ApiError(401,'Sesión inválida');
    if(await isSessionActive({userId:user.id,sessionId:claims.session_id},token)!==true)throw new ApiError(401,'Sesión revocada');
    const member=await lookupMembership({userId:user.id,empresaId},token);
    if(!member?.activo || member.userId!==user.id || member.empresaId!==empresaId || !member.vendedorId || !['vendedor','administrador'].includes(member.rol))throw new ApiError(403,'Sin pertenencia activa a esta empresa');
    return {userId:user.id,sessionId:claims.session_id,empresaId,vendedorId:member.vendedorId,expiresAt,permissions:['pedidos:crear']};
  }};
}
