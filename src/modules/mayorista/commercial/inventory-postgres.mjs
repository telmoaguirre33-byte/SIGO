import {administrative} from '../security/company-roles.mjs';
import {createHash} from 'node:crypto';
import {canonical,loadProducts} from '../cargas/model.mjs';
import {ApiError} from '../api/receive-order.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Inventario exclusivamente Mayorista: jamás consulta ni escribe Stock de SIGO. */
export function createInventoryTransaction({query,principal,loads}){
 const requireAdmin=()=>{if(!administrative(principal))throw new ApiError(403,'Sin permisos de inventario independiente');};
 return {
  inventory:async()=>{requireAdmin();return {empresaId:principal.empresaId,productos:(await query('SELECT producto_id AS "productoId",unidades,reservadas,unidades-reservadas AS disponibles FROM mayorista.inventario WHERE empresa_id=$1 ORDER BY producto_id',[principal.empresaId])).rows};},
  inventoryCommand:async command=>{
   if(!(principal.rol==='armador'&&command?.tipo==='reserva'))requireAdmin();if(command?.empresaId!==principal.empresaId)throw new ApiError(403,'Otra empresa');
   if(!uuid.test(command.id)||!['ingreso','reserva','salida','devolucion'].includes(command.tipo)||!command.input)throw new ApiError(422,'Movimiento inválido');
   const hash=createHash('sha256').update(JSON.stringify(canonical({tipo:command.tipo,input:command.input}))).digest('hex');
   const old=(await query('SELECT huella,respuesta FROM mayorista.movimientos_inventario WHERE empresa_id=$1 AND comando_id=$2',[principal.empresaId,command.id])).rows[0];
   if(old){if(old.huella!==hash)throw new ApiError(409,'Identificador de inventario reutilizado');return old.respuesta;}
   let lines,source;
   if(command.tipo==='ingreso'){
    const i=command.input;if(!uuid.test(i.productoId)||!Number.isSafeInteger(i.cantidad)||i.cantidad<1||i.cantidad>1000000||typeof i.comprobante!=='string'||!i.comprobante.trim()||i.comprobante.length>160)throw new ApiError(422,'Ingreso inválido');
    if(!(await query('SELECT producto_id FROM mayorista.productos WHERE empresa_id=$1 AND producto_id=$2 AND activo',[principal.empresaId,i.productoId])).rows.length)throw new ApiError(422,'Producto no disponible');
    source=i.comprobante.trim();lines=[{productoId:i.productoId,cantidad:i.cantidad}];
   }else{
    const id=command.input.cargaId;if(!uuid.test(id))throw new ApiError(422,'Carga inválida');const state=await loads(),load=state.cargas[id];if(!load)throw new ApiError(404,'Carga no disponible');source=id;
    if(command.tipo==='reserva'&&load.estado!=='verificada'||command.tipo==='salida'&&load.estado!=='en_reparto'||command.tipo==='devolucion'&&load.estado!=='cerrada')throw new ApiError(409,'Estado de carga incompatible');
    if(command.tipo==='devolucion'){
     const totals=new Map();for(const p of Object.values(load.pedidos))for(const l of p.lineas)totals.set(l.productoId,(totals.get(l.productoId)??0)+(l.devuelto??0));
     lines=[...totals].map(([productoId,returned])=>{
      const receipt=load.recepcionDevoluciones?.lineas.find(l=>l.productoId===productoId);
      // Sin inspección explícita se conserva en revisión: jamás aumenta stock vendible.
      const cantidad=receipt?.vendible??0;
      if(!Number.isSafeInteger(cantidad)||cantidad<0||cantidad>returned)throw new ApiError(422,'Clasificación de devolución inválida');
      return {productoId,cantidad};
     });
    }
    else lines=loadProducts(load).map(l=>({productoId:l.productoId,cantidad:l.preparado}));
   }
   if((await query('SELECT comando_id FROM mayorista.movimientos_inventario WHERE empresa_id=$1 AND tipo=$2 AND origen=$3',[principal.empresaId,command.tipo,source])).rows.length)throw new ApiError(409,'Origen ya contabilizado');
   const previousType=command.tipo==='salida'?'reserva':command.tipo==='devolucion'?'salida':null;
   if(previousType&&!(await query('SELECT comando_id FROM mayorista.movimientos_inventario WHERE empresa_id=$1 AND tipo=$2 AND origen=$3',[principal.empresaId,previousType,source])).rows.length)throw new ApiError(409,'Falta movimiento anterior de la carga');
   const updates=[];
   for(const l of lines.sort((a,b)=>a.productoId.localeCompare(b.productoId))){
    if(!Number.isSafeInteger(l.cantidad)||l.cantidad<0||l.cantidad>1000000)throw new ApiError(422,'Cantidad fuera de rango');if(l.cantidad===0)continue;
    await query('INSERT INTO mayorista.inventario(empresa_id,producto_id,unidades,reservadas) VALUES($1,$2,0,0) ON CONFLICT DO NOTHING',[principal.empresaId,l.productoId]);
    const balance=(await query('SELECT unidades,reservadas FROM mayorista.inventario WHERE empresa_id=$1 AND producto_id=$2 FOR UPDATE',[principal.empresaId,l.productoId])).rows[0];let {unidades,reservadas}=balance;
    if(command.tipo==='ingreso'||command.tipo==='devolucion')unidades+=l.cantidad;
    if(command.tipo==='reserva'){if(unidades-reservadas<l.cantidad)throw new ApiError(409,'Mercadería independiente insuficiente');reservadas+=l.cantidad;}
    if(command.tipo==='salida'){if(reservadas<l.cantidad||unidades<l.cantidad)throw new ApiError(409,'Reserva insuficiente');reservadas-=l.cantidad;unidades-=l.cantidad;}
    if(!Number.isSafeInteger(unidades)||unidades>1000000000)throw new ApiError(422,'Saldo fuera de rango');
    await query('UPDATE mayorista.inventario SET unidades=$3,reservadas=$4 WHERE empresa_id=$1 AND producto_id=$2',[principal.empresaId,l.productoId,unidades,reservadas]);updates.push({productoId:l.productoId,unidades,reservadas,disponibles:unidades-reservadas});
   }
   const response={id:command.id,empresaId:principal.empresaId,tipo:command.tipo,origen:source,productos:updates};
   await query('INSERT INTO mayorista.movimientos_inventario(empresa_id,comando_id,tipo,origen,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[principal.empresaId,command.id,command.tipo,source,hash,principal.userId,JSON.stringify(response)]);return response;
  }
 };
}
