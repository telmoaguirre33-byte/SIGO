/** Matriz autorizada el 12/10/2026. Usar membresías consultadas en servidor,
 * no roles ni permisos enviados por el navegador ni user_metadata del JWT.
 * No sustituye por sí sola las políticas RLS ni las comprobaciones del backend. */
const permissions=Object.freeze({
  gerencia:['*'],
  administracion:['clientes','vendedores','productos','precios','rutas','pedidos','cargas','cobranzas'],
  vendedor:['clientes_asignados','rutas_asignadas','pedidos_propios','visitas_propias','objetivos_propios'],
  armador:['preparacion','picking','control_cargas'],
  chofer:['rutas_asignadas','entregas_asignadas','devoluciones_asignadas','rendiciones_propias']
});
export const MAYORISTA_ROLES=Object.freeze(Object.keys(permissions));
export function authorizeMayorista({principal,membership,activation,permission,resource}){
  if(!principal?.userId||!principal.empresaId||membership?.userId!==principal.userId||membership.empresaId!==principal.empresaId||membership.activo!==true||activation?.empresaId!==principal.empresaId||activation.enabled!==true)throw new Error('Acceso Mayorista no habilitado para esta membresía');
  const grants=permissions[membership.rol];if(!grants||typeof permission!=='string'||!permission||(!grants.includes('*')&&!grants.includes(permission)))throw new Error('Función no autorizada');
  if(!resource||resource.empresaId!==principal.empresaId)throw new Error('Recurso de otra empresa o sin ámbito');
  if(membership.rol==='vendedor'&&(!membership.vendedorId||resource.vendedorId!==membership.vendedorId))throw new Error('Recurso no asignado al vendedor');
  if(membership.rol==='chofer'&&(!membership.choferId||resource.choferId!==membership.choferId))throw new Error('Recurso no asignado al chofer');
  if(membership.rol==='armador'&&(!membership.armadorId||!Array.isArray(resource.armadoresIds)||!resource.armadoresIds.includes(membership.armadorId)))throw new Error('Carga no asignada al armador');
  return true;
}
export function listMayoristaPermissions(role){return [...(permissions[role]??[])];}
