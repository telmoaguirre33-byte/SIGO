import {createAccountsTransaction} from '../commercial/accounts-postgres.mjs';
import {createInventoryTransaction} from '../commercial/inventory-postgres.mjs';
import {createVisitsTransaction} from '../commercial/visits.mjs';
import {createCargasTransaction} from '../cargas/postgres.mjs';
import {createHash} from 'node:crypto';
import {createAdminState,saveSeller,saveRoute,assignCustomer,setGoal} from '../admin/model.mjs';
import {createFulfillment,applyFulfillment} from '../admin/fulfillment.mjs';
import {ApiError} from './receive-order.mjs';
export function assertIsolatedPool(pool){
  const o=pool?.options;
  if(!o || o.host!=='127.0.0.1' || Number(o.port)!==55471 || o.database!=='mayorista_qa')throw new ApiError(503,'Solo se permite PostgreSQL local de pruebas');
}
const columns=`empresa_id as "empresaId",pedido_id as "pedidoId",vendedor_id as "vendedorId",cliente_id as "clienteId",creado_en as "creadoEn",recibido_en as "recibidoEn",lineas,huella as hash,estado`;
function normalize(row){return row?{...row,creadoEn:row.creadoEn.toISOString(),recibidoEn:row.recibidoEn.toISOString()}:null;}
export function createPostgresRepository({enabled=false,pool,inventoryRequired=false,accountsEnabled=false}={}){
  return {withPrincipal:async(principal,fn)=>{
    if(!enabled)throw new ApiError(503,'Persistencia desactivada');assertIsolatedPool(pool);
    for(let attempt=0;attempt<4;attempt++){
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query('SET LOCAL ROLE authenticated');
      await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[principal.userId,JSON.stringify({sub:principal.userId,is_anonymous:false,session_id:principal.sessionId})]);
      const tx={
        find:async(e,id)=>normalize((await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2`,[e,id])).rows[0]),
        validateReferences:async order=>{
          const client=(await c.query('SELECT cliente_id FROM mayorista.clientes WHERE empresa_id=$1 AND cliente_id=$2 AND vendedor_id=$3 AND habilitado',[order.empresaId,order.clienteId,order.vendedorId])).rows[0];
          if(!client)return ['cliente no asignado'];
          const ids=[...new Set(order.lineas.map(l=>l.productoId))];
          const products=(await c.query('SELECT producto_id FROM mayorista.productos WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[]) AND activo',[order.empresaId,ids])).rows;
          const prices=(await c.query('SELECT producto_id,precio,unidades_base FROM mayorista.precios WHERE empresa_id=$1 AND producto_id=ANY($2::uuid[])',[order.empresaId,ids])).rows;
          const issues=[];
          for(const l of order.lineas){if(!products.some(p=>p.producto_id===l.productoId))issues.push('producto inactivo');if(!prices.some(p=>p.producto_id===l.productoId && Math.abs(Number(p.precio)/p.unidades_base-l.precioUnitario)<0.000001))issues.push('precio cambiado');}
          return issues;
        },
        insertOnce:async row=>{
          const result=await c.query(`INSERT INTO mayorista.pedidos(empresa_id,pedido_id,vendedor_id,cliente_id,creado_en,recibido_en,lineas,huella,estado) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(empresa_id,pedido_id) DO NOTHING RETURNING ${columns}`,[row.empresaId,row.pedidoId,row.vendedorId,row.clienteId,row.creadoEn,row.recibidoEn,JSON.stringify(row.lineas),row.hash,row.estado]);
          return normalize(result.rows[0])??tx.find(row.empresaId,row.pedidoId);
        },
        adminState:async()=>{
          if(principal.rol!=='administrador')throw new ApiError(403,'Sin permisos administrativos');
          return (await c.query('SELECT datos FROM mayorista.administracion WHERE empresa_id=$1',[principal.empresaId])).rows[0]?.datos??createAdminState(principal.empresaId);
        },
        adminCommand:async(command)=>{
          if(principal.rol!=='administrador'||command.empresaId!==principal.empresaId)throw new ApiError(403,'Sin permisos administrativos');
          const actions={vendedor:saveSeller,ruta:saveRoute,cliente:assignCustomer,objetivo:setGoal};
          if(!Object.hasOwn(actions,command.operacion)||!command.input||Array.isArray(command.input)||typeof command.input!=='object')throw new ApiError(422,'Operación inválida');
          const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))):value;
          const hash=createHash('sha256').update(JSON.stringify(canonical({operacion:command.operacion,input:command.input}))).digest('hex');
          const old=(await c.query('SELECT huella,respuesta FROM mayorista.comandos_administrativos WHERE empresa_id=$1 AND comando_id=$2',[principal.empresaId,command.id])).rows[0];
          if(old){if(old.huella!==hash)throw new ApiError(409,'UUID administrativo reutilizado');return old.respuesta;}
          const state=await tx.adminState();if(command.version!==state.revision)throw new ApiError(409,'Edición concurrente');
          let next;try{next=actions[command.operacion](state,{...command.input,empresaId:command.input.empresaId??principal.empresaId});}catch(e){throw new ApiError(422,e.message);}
          next.revision++;
          await c.query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,$2,$3::jsonb) ON CONFLICT(empresa_id) DO UPDATE SET revision=excluded.revision,datos=excluded.datos',[principal.empresaId,next.revision,JSON.stringify(next)]);
          await c.query('INSERT INTO mayorista.comandos_administrativos(empresa_id,comando_id,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)',[principal.empresaId,command.id,hash,principal.userId,JSON.stringify(next)]);
          return next;
        },
        catalog:async()=>({empresaId:principal.empresaId,vendedorId:principal.vendedorId,descargadoEn:new Date().toISOString(),clientes:(await c.query('SELECT cliente_id AS id,nombre,ruta_id AS "rutaId" FROM mayorista.clientes WHERE empresa_id=$1 AND habilitado',[principal.empresaId])).rows,productos:(await c.query('SELECT producto_id AS id,nombre FROM mayorista.productos WHERE empresa_id=$1 AND activo',[principal.empresaId])).rows,precios:(await c.query('SELECT precio_id AS id,producto_id AS "productoId",unidades_base AS "unidadesBase",precio FROM mayorista.precios WHERE empresa_id=$1',[principal.empresaId])).rows}),
        fulfillment:async(command)=>{
          if(principal.rol!=='administrador')throw new ApiError(403,'Sin permisos administrativos');
          const row=await tx.find(principal.empresaId,command.pedidoId);if(!row)throw new ApiError(404,'Pedido no disponible');
          let state=createFulfillment(row);
          const events=(await c.query('SELECT comando,actor_id FROM mayorista.eventos_pedido WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY version',[principal.empresaId,row.pedidoId])).rows;
          for(const e of events)state=applyFulfillment(state,e.comando,{empresaId:principal.empresaId,userId:e.actor_id,rol:'administrador'});
          if(command.tipo&&((await c.query("SELECT empresa_id FROM mayorista.cargas_estado WHERE empresa_id=$1 AND datos->'pedidos' ? $2",[principal.empresaId,command.pedidoId])).rows.length))throw new ApiError(409,'Pedido asignado a Armado de Cargas');
          if(command.tipo){let next;try{next=applyFulfillment(state,command,principal);}catch(e){throw new ApiError(409,e.message);}
            if(next.version!==state.version)await c.query('INSERT INTO mayorista.eventos_pedido(empresa_id,pedido_id,comando_id,version,comando,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[principal.empresaId,row.pedidoId,command.id,next.version,JSON.stringify(command),principal.userId]);
            state=next;
          }
          return state;
        },
        list:async()=> (await c.query(`SELECT ${columns} FROM mayorista.pedidos WHERE empresa_id=$1 ORDER BY recibido_en DESC LIMIT 500`,[principal.empresaId])).rows.map(normalize)
      };
      Object.assign(tx,createVisitsTransaction({query:(sql,args)=>c.query(sql,args),principal}));
      Object.assign(tx,createCargasTransaction({query:(sql,args)=>c.query(sql,args),principal,findOrder:tx.find,fulfillment:tx.fulfillment}));
      Object.assign(tx,createInventoryTransaction({query:(sql,args)=>c.query(sql,args),principal,loads:tx.cargasState}));
      Object.assign(tx,createAccountsTransaction({query:(sql,args)=>c.query(sql,args),principal}));
      if(accountsEnabled){const apply=tx.cargasCommand;tx.cargasCommand=async command=>{const before=await tx.cargasState(),after=await apply(command);await tx.accountLoadChanges(before,after,command);return after;};}
      if(inventoryRequired){const apply=tx.cargasCommand;tx.cargasCommand=async command=>{const state=await apply(command);const tipo={verificar:'reserva',salir:'salida',cerrar:'devolucion'}[command.tipo];if(tipo)await tx.inventoryCommand({id:command.id,empresaId:principal.empresaId,tipo,input:{cargaId:command.input.cargaId}});return state;};}
      const result=await fn(tx);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});if(!['40001','40P01','23505'].includes(e.code)||attempt===3)throw e;}finally{c.release();}
    }
  }};
}
