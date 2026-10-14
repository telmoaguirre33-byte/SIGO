import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
import {canonical} from '../cargas/model.mjs';
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
   const employee=['owner','admin','seller','warehouse'],roles={gerencia:['owner'],administracion:['owner','admin'],vendedor:employee,armador:employee,chofer:employee};
   if(!row||!roles[principal.rol]?.includes(row.rol))throw new ApiError(403,'Fuente compartida deshabilitada o rol divergente');
   return {...principal,fuenteComercial:'sigo'};
  },
  transaction:({query,principal})=>{
   if(principal.fuenteComercial!=='sigo')throw new ApiError(503,'Fuente compartida no confirmada');
   const E=principal.empresaId,admin=()=>{if(!administrative(principal))throw new ApiError(403,'Solo administración comercial');};
   const rpc=async(name,args)=>{const names={registrar_entrega_mayorista_sigo:'$1,$2,$3::jsonb',autorizar_credito_mayorista_sigo:'$1,$2,$3,$4',registrar_cobro_mayorista_sigo:'$1,$2,$3,$4,$5,$6,$7',leer_comercio_mayorista_sigo:'$1',leer_ficha_mayorista_sigo:'$1,$2',permiso_cobro_mayorista_sigo:'$1',configurar_cobrador_mayorista_sigo:'$1,$2,$3,$4',cobrar_mayorista_autorizado_sigo:'$1,$2,$3,$4,$5,$6,$7',devolver_mayorista_sigo:'$1,$2,$3::jsonb',clasificar_devolucion_mayorista_sigo:'$1,$2,$3,$4,$5',configurar_precio_mayorista_sigo:'$1,$2::jsonb',cotizar_pedido_mayorista_sigo:'$1,$2,$3::jsonb',leer_recepciones_mayorista_sigo:'$1'};if(!Object.hasOwn(names,name))throw new ApiError(422,'RPC inválida');try{return (await query(`SELECT public.${name}(${names[name]}) AS r`,args)).rows[0].r;}catch(e){if(e.code==='P0001')throw new ApiError(/FORBIDDEN|MANAGEMENT_REQUIRED/.test(e.message)?403:/CONFLICT|ALREADY_REGISTERED|STATE_INVALID|PRESENTATION_NOT_AVAILABLE|PRICE_LIST_REQUIRED|PRICE_LIST_INACTIVE|PRICE_NOT_AVAILABLE/.test(e.message)?409:/SESSION_|AUTH_REQUIRED/.test(e.message)?401:422,'Operación compartida rechazada');throw e;}};
   return {
    sharedPricing:command=>{admin();if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');return rpc('configurar_precio_mayorista_sigo',[E,JSON.stringify(command.datos)]);},
    sharedQuote:(cliente,lineas)=>rpc('cotizar_pedido_mayorista_sigo',[E,cliente,JSON.stringify(lineas)]),
    sharedReturn:command=>{admin();if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');return rpc('devolver_mayorista_sigo',[E,command.id,JSON.stringify(command.datos)]);},
    sharedReceipts:()=>rpc('leer_recepciones_mayorista_sigo',[E]),
    sharedInspection:command=>{if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');return rpc('clasificar_devolucion_mayorista_sigo',[E,command.devolucionId,command.ventaItemId,command.disposicion,command.motivo]);},
    sharedCustomer:id=>rpc('leer_ficha_mayorista_sigo',[E,id]),
    sharedCollectionPermission:()=>rpc('permiso_cobro_mayorista_sigo',[E]),
    sharedCollector:command=>{admin();if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');return rpc('configurar_cobrador_mayorista_sigo',[E,command.usuario,command.activo,command.limiteCentavos]);},
    sharedCollection:command=>{if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');const d=command.datos??{};return rpc('cobrar_mayorista_autorizado_sigo',[E,command.id,d.clienteId,d.pedidoId??null,d.centavos,d.medio,d.comprobante]);},
    sharedState:()=>{admin();return rpc('leer_comercio_mayorista_sigo',[E]);},
    sharedCommand:async command=>{
     admin();if(command?.empresaId!==E)throw new ApiError(403,'Otra empresa');
     if(command.tipo==='entrega'){
      const d=command.datos??{},loads=(await query('SELECT datos FROM mayorista.cargas_operativas WHERE empresa_id=$1',[E])).rows;
      const load=loads.map(r=>r.datos).find(l=>l.historial?.some(h=>h.id===command.id&&h.tipo==='entregar'&&h.input?.pedidoId===d.pedidoId));
      const event=load?.historial.find(h=>h.id===command.id),p=load?.pedidos[d.pedidoId];
      if(!p?.entrega||p.clienteId!==d.clienteId)throw new ApiError(409,'La venta requiere una entrega registrada');
      const lines=event.input.lineas.filter(l=>l.entregado>0).map(l=>({productoId:l.productoId,cantidad:l.entregado,precioUnitario:p.lineas.find(x=>x.productoId===l.productoId)?.precioUnitario}));
      const normalized=x=>JSON.stringify(canonical([...(x??[])].sort((a,b)=>a.productoId.localeCompare(b.productoId))));
      if(!Array.isArray(d.lineas)||normalized(d.lineas)!==normalized(lines))throw new ApiError(409,'El detalle no coincide con la entrega');
      const order=(await query('SELECT vendedor_id FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2',[E,d.pedidoId])).rows[0];
      if(!order||d.vendedorId&&d.vendedorId!==order.vendedor_id||d.rutaId&&d.rutaId!==p.rutaId)throw new ApiError(409,'Atribución ajena a la entrega');
      const split=[];
      for(const delivered of lines){const group=p.lineas.find(l=>l.productoId===delivered.productoId);let remaining=delivered.cantidad;for(const part of group.desglosePrecios??[{cantidad:group.cantidad,precioUnitario:group.precioUnitario}]){const cantidad=Math.min(remaining,part.cantidad);if(cantidad>0)split.push({productoId:group.productoId,cantidad,precioUnitario:part.precioUnitario,...(part.precioId?{precioId:part.precioId}:{})});remaining-=cantidad;if(!remaining)break;}if(remaining)throw new ApiError(409,'Entrega fuera de los renglones autorizados');}
      const grouped=new Map();for(const part of split){const k=part.productoId+':'+(part.precioId??part.productoId);const old=grouped.get(k);if(old){if(old.precioUnitario!==part.precioUnitario)throw new ApiError(409,'Precio de presentación divergente');old.cantidad+=part.cantidad;}else grouped.set(k,{...part});}
      const trusted={pedidoId:d.pedidoId,clienteId:p.clienteId,vendedorId:order.vendedor_id,...(p.rutaId?{rutaId:p.rutaId}:{}),medioPago:p.comerciales?.condicionPago??d.medioPago,lineas:[...grouped.values()]};
      return rpc('registrar_entrega_mayorista_sigo',[E,command.id,JSON.stringify(trusted)]);
     }
     if(command.tipo==='credito')return rpc('autorizar_credito_mayorista_sigo',[E,command.id,command.aprobar,command.motivo]);
     if(command.tipo==='cobro'){const d=command.datos??{};return rpc('registrar_cobro_mayorista_sigo',[E,command.id,d.clienteId,d.pedidoId??null,d.centavos,d.medio,d.comprobante]);}
     throw new ApiError(422,'Operación compartida inválida');
    },
    sharedCatalog:async()=> (await query('SELECT public.leer_catalogo_mayorista_sigo($1) AS r',[E])).rows[0].r,
    sharedMetrics:async()=> (await query('SELECT public.leer_metricas_mayorista_sigo($1) AS r',[E])).rows[0].r,
    sharedInventory:async()=>{admin();return (await query('SELECT public.leer_stock_mayorista_sigo($1) AS r',[E])).rows[0].r;},
   };
  }
 };
}
