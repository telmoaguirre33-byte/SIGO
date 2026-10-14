import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
/** Fuente por empresa. Solo se instala en un backend con conexión SIGO validada.
 * No habilita una empresa por variables, por datos del navegador ni por licencia. */
export function createSharedSource({pool,databasePolicy}){
 databasePolicy.assertPool(pool);
 return {
  identity:async principal=>{
   databasePolicy.assertPool(pool);
   const installed=(await pool.query("SELECT to_regclass('public.sigo_mayorista_comercio_fuente') AS source")).rows[0]?.source;
   if(!installed)return principal;
   const binding=(await pool.query('SELECT fuente FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=$1',[principal.empresaId])).rows[0];
   if(binding?.fuente!=='sigo')return principal;
   const row=(await pool.query(`SELECT f.fuente,u.rol FROM public.sigo_mayorista_comercio_fuente f
    JOIN public.empresas e ON e.id=f.empresa_id AND e.activa
    JOIN public.sigo_empresa_modulos m ON m.empresa_id=f.empresa_id AND m.modulo_clave='mayorista_distribuidora' AND m.habilitado
    JOIN public.empresa_usuarios u ON u.empresa_id=f.empresa_id AND u.user_id=$2 AND u.activo
    WHERE f.empresa_id=$1 AND f.fuente='sigo'`,[principal.empresaId,principal.userId])).rows[0];
   const roles={gerencia:'owner',administracion:'admin',vendedor:'vendedor',armador:'armador',chofer:'chofer'};
   if(!row||row.rol!==roles[principal.rol])throw new ApiError(403,'Fuente compartida deshabilitada o rol divergente');
   return {...principal,fuenteComercial:'sigo'};
  },
  transaction:({query,principal})=>{
   if(principal.fuenteComercial!=='sigo')throw new ApiError(503,'Fuente compartida no confirmada');
   const E=principal.empresaId,admin=()=>{if(!administrative(principal))throw new ApiError(403,'Solo administración comercial');};
   const rpc=async(name,args)=>{const names={registrar_entrega_mayorista_sigo:'$1,$2,$3::jsonb',autorizar_credito_mayorista_sigo:'$1,$2,$3,$4',registrar_cobro_mayorista_sigo:'$1,$2,$3,$4,$5,$6,$7',leer_comercio_mayorista_sigo:'$1'};if(!Object.hasOwn(names,name))throw new ApiError(422,'RPC inválida');try{return (await query(`SELECT public.${name}(${names[name]}) AS r`,args)).rows[0].r;}catch(e){if(e.code==='P0001')throw new ApiError(/FORBIDDEN|MANAGEMENT_REQUIRED/.test(e.message)?403:/CONFLICT|ALREADY_REGISTERED|STATE_INVALID/.test(e.message)?409:/SESSION_|AUTH_REQUIRED/.test(e.message)?401:422,'Operación compartida rechazada');throw e;}};
   return {
    sharedState:()=>{admin();return rpc('leer_comercio_mayorista_sigo',[E]);},
    sharedCommand:async command=>{
     admin();if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');
     if(command.tipo==='entrega')return rpc('registrar_entrega_mayorista_sigo',[E,command.id,JSON.stringify(command.datos)]);
     if(command.tipo==='credito')return rpc('autorizar_credito_mayorista_sigo',[E,command.id,command.aprobar,command.motivo]);
     if(command.tipo==='cobro'){const d=command.datos??{};return rpc('registrar_cobro_mayorista_sigo',[E,command.id,d.clienteId,d.pedidoId??null,d.centavos,d.medio,d.comprobante]);}
     throw new ApiError(422,'Operación compartida inválida');
    },
    sharedCatalog:async()=> (await query('SELECT public.leer_catalogo_mayorista_sigo($1) AS r',[E])).rows[0].r,
    sharedInventory:async()=>{admin();return (await query('SELECT public.leer_stock_mayorista_sigo($1) AS r',[E])).rows[0].r;},
   };
  }
 };
}
