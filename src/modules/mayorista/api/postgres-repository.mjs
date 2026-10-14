import {createCollectionsTransaction} from '../commercial/collections.mjs';
import {createDashboardTransaction} from '../commercial/dashboard.mjs';
import {createGoalsTransaction} from '../commercial/goals.mjs';
import {createReportTransaction} from '../commercial/reports.mjs';
import {createMasterTransaction,offerPrice} from '../commercial/master-data.mjs';
import {createAssignedLoadsTransaction} from '../commercial/assigned-loads.mjs';
import {administrative} from '../security/company-roles.mjs';
import {createAccountsTransaction} from '../commercial/accounts-postgres.mjs';
import {createInventoryTransaction} from '../commercial/inventory-postgres.mjs';
import {createVisitsTransaction} from '../commercial/visits.mjs';
import {createCargasTransaction} from '../cargas/postgres.mjs';
import {createHash} from 'node:crypto';
import {createAdminState,saveVehicle,saveSeller,saveRoute,assignCustomer,setGoal} from '../admin/model.mjs';
import {createFulfillment,applyFulfillment} from '../admin/fulfillment.mjs';
import {ApiError} from './receive-order.mjs';
export function assertIsolatedPool(pool){
  const o=pool?.options;
  if(!o || o.host!=='127.0.0.1' || Number(o.port)!==55471 || o.database!=='mayorista_qa')throw new ApiError(503,'Solo se permite PostgreSQL local de pruebas');
}
const columns=`empresa_id as "empresaId",pedido_id as "pedidoId",vendedor_id as "vendedorId",cliente_id as "clienteId",creado_en as "creadoEn",recibido_en as "recibidoEn",lineas,huella as hash,estado`;
function normalize(row){return row?{...row,creadoEn:row.creadoEn.toISOString(),recibidoEn:row.recibidoEn.toISOString()}:null;}
export function createPostgresRepository({enabled=false,pool,inventoryRequired=false,accountsEnabled=false,databasePolicy,operational=false,readSharedMetrics,sharedSource}={}){
  return {withPrincipal:async(principal,fn)=>{
    if(!enabled)throw new ApiError(503,'Persistencia desactivada');(databasePolicy?.assertPool??assertIsolatedPool)(pool);
    for(let attempt=0;attempt<4;attempt++){
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query('SET LOCAL ROLE authenticated');
      await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[principal.userId,JSON.stringify({sub:principal.userId,is_anonymous:false,session_id:principal.sessionId,exp:Math.floor(principal.expiresAt/1000)})]);
      const tx={
        find:async(e,id)=>normalize((await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2`,[e,id])).rows[0]),
        validateReferences:async order=>{
          const client=(await c.query(`SELECT cliente_id${operational?',lista_id':''} FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2 AND vendedor_id=$3 AND habilitado`,[order.empresaId,order.clienteId,order.vendedorId])).rows[0];
          if(!client)return ['cliente no asignado'];
          const ids=[...new Set(order.lineas.map(l=>l.productoId))];
          const products=(await c.query('SELECT producto_id FROM mayorista.productos WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[]) AND activo',[order.empresaId,ids])).rows;
          const prices=(await c.query(`SELECT producto_id,precio,unidades_base${operational?',precio_id,lista_id':''} FROM mayorista.precios WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[])${operational?' AND (lista_id IS NULL OR EXISTS(SELECT 1 FROM mayorista.listas l WHERE l.empresa_id=precios.empresa_id AND l.lista_id=precios.lista_id AND l.activa))':''}`,[order.empresaId,ids])).rows;const offers=operational?(await c.query('SELECT precio_id,descuento FROM mayorista.ofertas WHERE empresa_id=$1 AND desde<=now() AND hasta>now()',[order.empresaId])).rows:[];if(operational)for(const p of prices)p.precio=Math.min(Number(p.precio),...offers.filter(o=>o.precio_id===p.precio_id).map(o=>offerPrice(p.precio,o.descuento)));
          const issues=[];
          for(const l of order.lineas){if(!products.some(p=>p.producto_id===l.productoId))issues.push('producto inactivo');if(!prices.some(p=>p.producto_id===l.productoId && (!operational||p.lista_id===client.lista_id) && Math.abs(Number(p.precio)/p.unidades_base-l.precioUnitario)<0.000001))issues.push('precio cambiado');}
          return issues;
        },
        insertOnce:async row=>{
          const result=await c.query(`INSERT INTO mayorista.pedidos(empresa_id,pedido_id,vendedor_id,cliente_id,creado_en,recibido_en,lineas,huella,estado) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(empresa_id,pedido_id) DO NOTHING RETURNING ${columns}`,[row.empresaId,row.pedidoId,row.vendedorId,row.clienteId,row.creadoEn,row.recibidoEn,JSON.stringify(row.lineas),row.hash,row.estado]);
          return normalize(result.rows[0])??tx.find(row.empresaId,row.pedidoId);
        },
        adminState:async()=>{
          if(!administrative(principal))throw new ApiError(403,'Sin permisos administrativos');
          return (await c.query('SELECT datos FROM mayorista.administracion WHERE empresa_id=$1',[principal.empresaId])).rows[0]?.datos??createAdminState(principal.empresaId);
        },
        adminCommand:async(command)=>{
          if(!administrative(principal)||command.empresaId!==principal.empresaId)throw new ApiError(403,'Sin permisos administrativos');
          const actions={vehiculo:saveVehicle,vendedor:saveSeller,ruta:saveRoute,cliente:assignCustomer,objetivo:setGoal};
          if(!Object.hasOwn(actions,command.operacion)||!command.input||Array.isArray(command.input)||typeof command.input!=='object')throw new ApiError(422,'Operación inválida');
          const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))):value;
          const hash=createHash('sha256').update(JSON.stringify(canonical({operacion:command.operacion,input:command.input}))).digest('hex');
          const old=(await c.query('SELECT huella,respuesta FROM mayorista.comandos_administrativos WHERE empresa_id=$1 AND comando_id=$2',[principal.empresaId,command.id])).rows[0];
          if(old){if(old.huella!==hash)throw new ApiError(409,'UUID administrativo reutilizado');return old.respuesta;}
          const state=await tx.adminState();if(command.version!==state.revision)throw new ApiError(409,'Edición concurrente');
          let next;try{next=actions[command.operacion](state,{...command.input,empresaId:command.input.empresaId??principal.empresaId});}catch(e){throw new ApiError(422,e.message);}
          if(operational)await tx.publishPlanning(command,next);
          next.revision++;
          await c.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,$2,$3::jsonb) ON CONFLICT(empresa_id) DO UPDATE SET revision=excluded.revision,datos=excluded.datos',[principal.empresaId,next.revision,JSON.stringify(next)]);
          await c.query('INSERT INTO mayorista.comandos_administrativos(empresa_id,comando_id,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)',[principal.empresaId,command.id,hash,principal.userId,JSON.stringify(next)]);
          return next;
        },
        catalog:async()=>({empresaId:principal.empresaId,vendedorId:principal.vendedorId,descargadoEn:new Date().toISOString(),clientes:(await c.query('SELECT cliente_id AS id,nombre,ruta_id AS "rutaId" FROM mayorista.clientes WHERE empresa_id=$1 AND habilitado',[principal.empresaId])).rows,productos:(await c.query('SELECT producto_id AS id,nombre FROM mayorista.productos WHERE empresa_id=$1 AND activo',[principal.empresaId])).rows,precios:(await c.query('SELECT precio_id AS id,producto_id AS "productoId",unidades_base AS "unidadesBase",precio FROM mayorista.precios WHERE empresa_id=$1',[principal.empresaId])).rows}),
        fulfillment:async(command)=>{
          if(!administrative(principal))throw new ApiError(403,'Sin permisos administrativos');
          const row=await tx.find(principal.empresaId,command.pedidoId);if(!row)throw new ApiError(404,'Pedido no disponible');
          let state=createFulfillment(row);
          const events=(await c.query('SELECT comando,actor_id FROM mayorista.eventos_pedido WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY version',[principal.empresaId,row.pedidoId])).rows;
          for(const e of events)state=applyFulfillment(state,e.comando,{empresaId:principal.empresaId,userId:e.actor_id,rol:'administrador'});
          if(command.tipo&&((await c.query("SELECT empresa_id FROM mayorista.cargas_estado WHERE empresa_id=$1 AND datos->'pedidos' ? $2",[principal.empresaId,command.pedidoId])).rows.length))throw new ApiError(409,'Pedido asignado a Armado de Cargas');
          if(command.tipo){let next;try{next=applyFulfillment(state,command,{...principal,rol:'administrador'});}catch(e){throw new ApiError(409,e.message);}
            if(next.version!==state.version)await c.query('INSERT INTO mayorista.eventos_pedido(empresa_id,pedido_id,comando_id,version,comando,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[principal.empresaId,row.pedidoId,command.id,next.version,JSON.stringify(command),principal.userId]);
            state=next;
          }
          return state;
        },
        list:async()=> (await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 ORDER BY recibido_en DESC LIMIT 500`,[principal.empresaId])).rows.map(normalize)
      };
      Object.assign(tx,createVisitsTransaction({query:(sql,args)=>c.query(sql,args),principal}));
      Object.assign(tx,createCargasTransaction({query:(sql,args)=>c.query(sql,args),principal,findOrder:tx.find,fulfillment:tx.fulfillment,readCatalog:principal.fuenteComercial==='sigo'?()=>tx.sharedCatalog():undefined}));
      if(operational){Object.assign(tx,createMasterTransaction({query:(sql,args)=>c.query(sql,args),principal}));tx.catalog=tx.operationalCatalog;Object.assign(tx,createCollectionsTransaction({query:(sql,args)=>c.query(sql,args),principal}),createReportTransaction({query:(sql,args)=>c.query(sql,args),principal}));}
      if(operational){Object.assign(tx,createAssignedLoadsTransaction({query:(sql,args)=>c.query(sql,args),principal,legacyLoads:tx.cargasState,onChange:async(before,after,command)=>{if(principal.fuenteComercial!=='sigo'&&accountsEnabled&&['entregar','devolver','revisar_rendicion'].includes(command.tipo))await tx.accountLoadChanges(before,after,command);if(principal.fuenteComercial!=='sigo'&&inventoryRequired){const tipo={verificar:'reserva',salir:'salida',cerrar:'devolucion'}[command.tipo];if(tipo)await createInventoryTransaction({query:(sql,args)=>c.query(sql,args),principal,loads:async()=>after}).inventoryCommand({id:command.id,empresaId:principal.empresaId,tipo,input:{cargaId:command.input.cargaId}});}}}));const apply=tx.cargasCommand;tx.cargasCommand=async command=>{if(command.input?.cargaId&&(await c.query('SELECT carga_id FROM mayorista.cargas_operativas WHERE empresa_id=$1 AND carga_id=$2',[principal.empresaId,command.input.cargaId])).rows.length)throw new ApiError(409,'Carga publicada: usar circuito asignado');return apply(command);};}
      Object.assign(tx,createInventoryTransaction({query:(sql,args)=>c.query(sql,args),principal,loads:tx.cargasState}));
      Object.assign(tx,createAccountsTransaction({query:(sql,args)=>c.query(sql,args),principal}));
      if(accountsEnabled&&principal.fuenteComercial!=='sigo'){const apply=tx.cargasCommand;tx.cargasCommand=async command=>{const before=await tx.cargasState(),after=await apply(command);await tx.accountLoadChanges(before,after,command);return after;};}
      if(inventoryRequired&&principal.fuenteComercial!=='sigo'){const apply=tx.cargasCommand;tx.cargasCommand=async command=>{const state=await apply(command);const tipo={verificar:'reserva',salir:'salida',cerrar:'devolucion'}[command.tipo];if(tipo)await tx.inventoryCommand({id:command.id,empresaId:principal.empresaId,tipo,input:{cargaId:command.input.cargaId}});return state;};}
      if(operational){
        tx.accounts=tx.collectionsAccounts;
        const query=(sql,args)=>c.query(sql,args);
        Object.assign(tx,createDashboardTransaction({query,principal,readSharedMetrics,readSharedData:principal.fuenteComercial==='sigo'?()=>tx.sharedMetrics():undefined}));
        Object.assign(tx,createGoalsTransaction({query,principal,readMetricsData:tx.readMetricsData}));
        const dashboard=tx.dashboard;
        tx.dashboard=async raw=>{
          const report=await dashboard(raw);
          if((await query("SELECT to_regclass('mayorista.metas') AS metas")).rows[0]?.metas){
            report.objetivos=(await tx.goals()).objetivos.filter(g=>g.activa&&g.desde<report.filtros.hastaExclusivo.slice(0,10)&&g.hasta>=report.filtros.desde.slice(0,10)&&(!report.filtros.vendedorId||g.vendedorId===report.filtros.vendedorId));
            const below=new Set(report.objetivos.filter(g=>g.vendedorId&&g.real!==null&&g.real<g.objetivo).map(g=>g.vendedorId));
            if(below.size)report.alertas.push({tipo:'objetivos_bajos',cantidad:below.size});
          }
          return report;
        };
        const catalog=tx.catalog;
        tx.catalog=async()=>{
          const data=await catalog();
          // Una ampliación pendiente no interrumpe el catálogo ni los pedidos ya aprobados.
          const installed=(await query("SELECT to_regclass('mayorista.metas') AS metas")).rows[0]?.metas;
          if(installed)data.metas=(await tx.goals()).objetivos;
          return data;
        };
      }
      if(principal.fuenteComercial==='sigo'){
        if(!sharedSource)throw new ApiError(503,'Fuente compartida no instalada');
        Object.assign(tx,sharedSource.transaction({query:(sql,args)=>c.query(sql,args),principal}));
        tx.catalog=async()=>{const result=await tx.sharedCatalog();if((await c.query("SELECT to_regclass('mayorista.metas') AS metas")).rows[0]?.metas)result.metas=(await tx.goals()).objetivos;return result;};
        tx.validateReferences=async order=>{const data=await tx.sharedCatalog();if(!data.clientes.some(x=>x.id===order.clienteId&&x.vendedorId===order.vendedorId))return ['cliente no asignado'];return order.lineas.flatMap(l=>!data.productos.some(p=>p.id===l.productoId)?['producto inactivo']:!data.precios.some(p=>p.productoId===l.productoId&&Math.abs(Number(p.precio)-l.precioUnitario)<0.000001)?['precio cambiado']:[]);};
        tx.inventory=tx.sharedInventory;
        tx.accounts=async()=>{const data=await tx.sharedState();return {empresaId:principal.empresaId,cuentas:data.cuentas};};
        tx.masterState=async()=>{if(!administrative(principal))throw new ApiError(403,'Administración requerida');const data=await tx.sharedCatalog();return {empresaId:principal.empresaId,revision:0,productos:data.productos.map(p=>({...p,activo:true})),listas:[],precios:data.precios,ofertas:data.ofertas};};
        const blocked=async()=>{throw new ApiError(409,'Usar la operación compartida SIGO; escritor QA bloqueado');};
        tx.inventoryCommand=blocked;tx.collectionCommand=blocked;tx.masterCommand=blocked;
        const adminCommand=tx.adminCommand;
        tx.adminCommand=async command=>{
          if(command?.operacion!=='cliente')return adminCommand(command);
          if(!administrative(principal)||command.empresaId!==principal.empresaId)throw new ApiError(403,'Sin permisos de asignación');
          const customers=(await tx.sharedCatalog()).clientes,customer=customers.find(c=>c.id===command.input?.id);
          if(!customer)throw new ApiError(422,'Seleccioná un cliente existente de SIGO de esta empresa');
          if(command.input.listaId)throw new ApiError(422,'Lista especial compartida todavía no integrada');
          // Solo asignaciones: nombre, dirección, saldo y crédito vienen de la ficha SIGO.
          return adminCommand({...command,input:{...command.input,nombre:customer.nombre,direccion:customer.direccion||'Sin dirección registrada'}});
        };
      }
      const result=await fn(tx);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});if(!['40001','40P01','23505'].includes(e.code)||attempt===3)throw e;}finally{c.release();}
    }
  }};
}
