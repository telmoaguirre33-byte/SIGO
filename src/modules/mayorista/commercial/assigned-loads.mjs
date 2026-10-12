import {createHash} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
import {createLoadsState,applyLoadCommand,canonical} from '../cargas/model.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workerActions={armador:['iniciar','contar','escanear','autorizar_faltante','verificar','recibir_devoluciones'],chofer:['entregar','devolver','rendir']};
export function createAssignedLoadsTransaction({query,principal,legacyLoads,onChange}){
 const project=row=>{const load=structuredClone(row.datos);if(principal.rol==='armador')for(const p of Object.values(load.pedidos)){delete p.rendicion;delete p.entrega;for(const l of p.lineas){delete l.precioUnitario;delete l.totalCentavos;delete l.desglosePrecios;}}return {cargaId:row.carga_id,version:row.version,load};};
 const one=async id=>(await query('SELECT carga_id,armador_user_id,chofer_user_id,version,datos FROM mayorista.cargas_operativas WHERE empresa_id=$1 AND carga_id=$2',[principal.empresaId,id])).rows[0];
 return {
  assignedLoads:async()=>({empresaId:principal.empresaId,cargas:(await query('SELECT carga_id,version,datos FROM mayorista.cargas_operativas WHERE empresa_id=$1 ORDER BY carga_id',[principal.empresaId])).rows.map(project)}),
  publishLoad:async input=>{
   if(!administrative(principal))throw new ApiError(403,'Publicación administrativa requerida');
   if(![input?.cargaId,input?.armadorUserId,input?.choferUserId].every(v=>uuid.test(v)))throw new ApiError(422,'Asignación inválida');
   const existing=await one(input.cargaId);if(existing){if(existing.armador_user_id!==input.armadorUserId||existing.chofer_user_id!==input.choferUserId)throw new ApiError(409,'Carga ya publicada con responsables distintos');return project(existing);}
   const source=await legacyLoads(),load=source.cargas[input.cargaId];if(load?.estado!=='planificada'||!Object.keys(load.pedidos).length)throw new ApiError(409,'Solo cargas con pedidos aprobados, antes de picking');
   const copy={...load,requiereRecepcion:true,responsable:input.armadorUserId,chofer:input.choferUserId,historial:[]};
   for(const [codigo,p] of Object.entries(source.codigos))await query('INSERT INTO mayorista.codigos_operativos(empresa_id,codigo,producto_id,unidades_base) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,codigo) DO NOTHING',[principal.empresaId,codigo,p.productoId,p.unidadesBase]);
   try{await query('INSERT INTO mayorista.cargas_operativas(empresa_id,carga_id,armador_user_id,chofer_user_id,version,datos) VALUES($1,$2,$3,$4,0,$5::jsonb)',[principal.empresaId,input.cargaId,input.armadorUserId,input.choferUserId,JSON.stringify(copy)]);}catch(e){if(e.code==='23503')throw new ApiError(422,'Responsables no pertenecen a los roles de esta empresa');throw e;}
   return project(await one(input.cargaId));
  },
  assignedLoadCommand:async command=>{
   if(command?.empresaId!==principal.empresaId)throw new ApiError(403,'Empresa ajena');
   if(!uuid.test(command.id)||!uuid.test(command.input?.cargaId)||!Number.isSafeInteger(command.version)||command.version<0)throw new ApiError(422,'Comando inválido');
   const row=await one(command.input.cargaId);if(!row)throw new ApiError(404,'Carga no asignada');
   if(!administrative(principal)&&!workerActions[principal.rol]?.includes(command.tipo))throw new ApiError(403,'Función fuera de este rol');
   if(['crear','aprobar','asignar','codigo'].includes(command.tipo))throw new ApiError(403,'La composición publicada no se reemplaza');
   const hash=createHash('sha256').update(JSON.stringify(canonical({tipo:command.tipo,input:command.input}))).digest('hex');
   const previous=(await query('SELECT carga_id,huella,respuesta FROM mayorista.operaciones_carga WHERE empresa_id=$1 AND comando_id=$2',[principal.empresaId,command.id])).rows[0];
   if(previous){if(previous.carga_id!==row.carga_id||previous.huella!==hash)throw new ApiError(409,'UUID operativo reutilizado');return project({...row,...previous.respuesta});}
   if(command.version!==row.version)throw new ApiError(409,'Carga editada en otro dispositivo');
   const base=createLoadsState(principal.empresaId);base.revision=row.version;base.cargas[row.carga_id]=row.datos;base.historial=row.datos.historial??[];
   for(const [id,p] of Object.entries(row.datos.pedidos))base.pedidos[id]={...p,cargaId:row.carga_id};
   for(const c of (await query('SELECT codigo,producto_id,unidades_base FROM mayorista.codigos_operativos WHERE empresa_id=$1',[principal.empresaId])).rows)base.codigos[c.codigo]={productoId:c.producto_id,unidadesBase:c.unidades_base};
   let next;try{next=applyLoadCommand(base,command,{...principal,rol:'administrador'});}catch(e){throw new ApiError(409,e.message);}
   const data={...next.cargas[row.carga_id],historial:next.historial};
   const updated=await query('UPDATE mayorista.cargas_operativas SET version=$3,datos=$4::jsonb WHERE empresa_id=$1 AND carga_id=$2 AND version=$5 RETURNING carga_id,version,datos',[principal.empresaId,row.carga_id,next.revision,JSON.stringify(data),row.version]);if(updated.rows.length!==1)throw new ApiError(409,'Conflicto de carga');
   if(command.tipo==='cancelar'){const source=await legacyLoads(),rootCommand={...command,version:source.revision};let legacy;try{legacy=applyLoadCommand(source,rootCommand,{...principal,rol:'administrador'});}catch(e){throw new ApiError(409,e.message);}await query('UPDATE mayorista.cargas_estado SET revision=$2,datos=$3::jsonb WHERE empresa_id=$1',[principal.empresaId,legacy.revision,JSON.stringify(legacy)]);await query('DELETE FROM mayorista.cargas_asignaciones WHERE empresa_id=$1 AND carga_id=$2',[principal.empresaId,row.carga_id]);}
   if(onChange)await onChange(base,next,command);
   await query('INSERT INTO mayorista.operaciones_carga(empresa_id,carga_id,comando_id,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[principal.empresaId,row.carga_id,command.id,hash,principal.userId,JSON.stringify(updated.rows[0])]);
   return project(updated.rows[0]);
  }
 };
}
