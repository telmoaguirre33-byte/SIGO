import {assignCustomer} from '../admin/model.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
import {canonical} from '../cargas/model.mjs';
import {launchConfig,normalizeImport,normalizeSubscription,subscriptionAccess,IMPORT_KINDS,UUID} from './launch-model.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
/** Reutiliza la transacción autenticada: todo cambio comparte rollback, RLS y reintentos. */
export function createLaunchTransaction({query,principal,tx}){
 const E=principal.empresaId;
 const admin=()=>{if(!administrative(principal))throw new ApiError(403,'Administración requerida');};
 const shared=()=>{admin();if(principal.fuenteComercial!=='sigo')throw new ApiError(409,'La importación requiere la fuente comercial compartida');};
 const rows=async(sql,args=[E])=>(await query(sql,args)).rows;
 const requireId=id=>{if(!UUID.test(id))throw new ApiError(422,'Registro inválido');};
 async function job(id){requireId(id);const j=(await rows('SELECT importacion_id AS id,tipo,estado FROM mayorista.importaciones WHERE empresa_id=$1 AND importacion_id=$2 FOR UPDATE',[E,id]))[0];if(!j)throw new ApiError(404,'Importación no encontrada');return j;}
 async function state(id,raw={}){const j=await job(id),offset=Number(raw.offset??0),estado=raw.estado??'';if(!Number.isSafeInteger(offset)||offset<0||offset>10000||!['','error','pendiente','aplicada'].includes(estado))throw new ApiError(422,'Paginación inválida');return {...j,resumen:await rows('SELECT estado,count(*)::int AS cantidad FROM mayorista.importacion_filas WHERE empresa_id=$1 AND importacion_id=$2 GROUP BY estado',[E,id]),acciones:await rows("SELECT resultado->>'accion' AS accion,count(*)::int AS cantidad FROM mayorista.importacion_filas WHERE empresa_id=$1 AND importacion_id=$2 AND estado='aplicada' GROUP BY resultado->>'accion'",[E,id]),filas:await rows("SELECT fila,datos,estado,resultado FROM mayorista.importacion_filas WHERE empresa_id=$1 AND importacion_id=$2 AND ($3='' AND estado<>'aplicada' OR estado=$3) ORDER BY fila OFFSET $4 LIMIT 100",[E,id,estado,offset])};}

 async function journal(command,action){
  if(command?.empresaId!==E||!UUID.test(command?.id))throw new ApiError(403,'Operación fuera de empresa');
  const hash=digest(command),old=(await rows('SELECT huella,respuesta FROM mayorista.comandos_administrativos WHERE empresa_id=$1 AND comando_id=$2',[E,command.id]))[0];
  if(old){if(old.huella!==hash)throw new ApiError(409,'Operación reutilizada con otros datos');return old.respuesta;}
  const result=await action();await query('INSERT INTO mayorista.comandos_administrativos(empresa_id,comando_id,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)',[E,command.id,hash,principal.userId,JSON.stringify(result)]);return result;
 }
 return {
  subscriptionState:async()=>{admin();const row=(await rows('SELECT version,datos FROM mayorista.suscripciones WHERE empresa_id=$1'))[0];return row?{...row,vigencia:subscriptionAccess(row.datos),modo:'preparacion',aplicarSuspension:false,cobrosReales:false}:{version:0,datos:null,modo:'preparacion',aplicarSuspension:false,cobrosReales:false};},
  subscriptionCommand:async command=>{admin();if(principal.rol!=='gerencia')throw new ApiError(403,'Gerencia requerida');return journal(command,async()=>{const old=(await rows('SELECT version,datos FROM mayorista.suscripciones WHERE empresa_id=$1 FOR UPDATE'))[0];if((old?.version??0)!==command.version)throw new ApiError(409,'La suscripción cambió en otra sesión');let datos;try{datos=normalizeSubscription(command.input,old?.datos);}catch(e){throw new ApiError(422,e.message);}const version=command.version+1;await query('INSERT INTO mayorista.suscripciones(empresa_id,version,datos,actualizado_por) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id) DO UPDATE SET version=excluded.version,datos=excluded.datos,actualizado_por=excluded.actualizado_por,actualizado_en=now()',[E,version,datos,principal.userId]);return {version,datos};});},
  launchState:async()=>{admin();const config=(await rows('SELECT version,datos FROM mayorista.puesta_marcha WHERE empresa_id=$1'))[0]??{version:0,datos:{}};
   const counts=(await rows(`SELECT (SELECT count(*)::int FROM mayorista.vendedores WHERE empresa_id=$1 AND activo) AS vendedores,(SELECT count(*)::int FROM mayorista.rutas WHERE empresa_id=$1) AS rutas,(SELECT count(*)::int FROM mayorista.listas WHERE empresa_id=$1 AND activa) AS listas,(SELECT count(*)::int FROM mayorista.metas WHERE empresa_id=$1 AND activa) AS objetivos,(SELECT count(DISTINCT rol)::int FROM mayorista.miembros WHERE empresa_id=$1 AND activo) AS roles`))[0];
   const catalogCounts=principal.fuenteComercial==='sigo'?(await rows('SELECT mayorista.resumen_puesta_marcha($1) AS r'))[0].r:{};counts.roles=catalogCounts.roles??counts.roles;
   return {empresaId:E,...config,counts,catalogCounts,listas:await rows('SELECT lista_id AS id,nombre FROM mayorista.listas WHERE empresa_id=$1 AND activa'),importaciones:await rows('SELECT importacion_id AS id,tipo,estado,creado_en AS fecha FROM mayorista.importaciones WHERE empresa_id=$1 ORDER BY creado_en DESC LIMIT 20'),suscripcion:{modeloPreparado:true,cobrosReales:false,aplicada:false},modulo:'mayorista_distribuidora'};},
  launchCommand:async command=>{admin();if(principal.rol!=='gerencia')throw new ApiError(403,'Gerencia requerida');return journal(command,async()=>{
   let input;try{input=launchConfig(command.input);}catch(e){throw new ApiError(422,e.message);}
   const old=(await rows('SELECT version FROM mayorista.puesta_marcha WHERE empresa_id=$1 FOR UPDATE'))[0];if((old?.version??0)!==command.version)throw new ApiError(409,'La configuración cambió en otra sesión');
   const version=command.version+1;await query('INSERT INTO mayorista.puesta_marcha(empresa_id,version,datos,actualizado_por) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id) DO UPDATE SET version=excluded.version,datos=excluded.datos,actualizado_por=excluded.actualizado_por,actualizado_en=now()',[E,version,input,principal.userId]);return {empresaId:E,version,datos:input};
  });},
  customersPage:async raw=>{shared();const limit=Number(raw.limit??30),offset=Number(raw.offset??0);if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1e6||String(raw.q??'').length>160||[raw.vendedorId,raw.rutaId].some(v=>v&&!UUID.test(v)))throw new ApiError(422,'Filtros inválidos');return (await rows('SELECT mayorista.padron_clientes($1,$2,$3,$4,$5,$6,$7) AS r',[E,raw.q??'',raw.vendedorId||null,raw.rutaId||null,raw.zona??'',offset,limit]))[0].r;},
  assignCustomers:async command=>{shared();return journal(command,async()=>{
   const {clientes,vendedorId,rutaId,listaId}=command.input??{};
   if(!Array.isArray(clientes)||!clientes.length||clientes.length>100||new Set(clientes).size!==clientes.length||clientes.some(id=>!UUID.test(id))||!UUID.test(vendedorId)||!UUID.test(rutaId)||listaId!==null&&!UUID.test(listaId))throw new ApiError(422,'Seleccioná de 1 a 100 clientes, vendedor, ruta y lista');
   const customers=(await rows('SELECT mayorista.fichas_asignacion($1,$2::uuid[]) AS r',[E,clientes]))[0].r;
   if(customers.length!==clientes.length)throw new ApiError(422,'Hay clientes inactivos o ajenos a esta empresa');
   if(listaId&&!(await rows('SELECT lista_id FROM mayorista.listas WHERE empresa_id=$1 AND lista_id=$2 AND activa',[E,listaId])).length)throw new ApiError(422,'Lista no disponible');
   let plan=await tx.adminState();if(command.version!==plan.revision)throw new ApiError(409,'El padrón cambió en otra sesión. Actualizá antes de asignar.');
   for(const customer of customers){
    const input={...customer,vendedorId,rutaId,listaId,habilitado:true};
    try{plan=assignCustomer(plan,input);}catch(e){throw new ApiError(422,e.message);}
    await tx.publishPlanning({operacion:'cliente',input},plan);
   }
   plan.revision++;
   await query('INSERT INTO mayorista.administracion(empresa_id,revision,datos) VALUES($1,$2,$3::jsonb) ON CONFLICT(empresa_id) DO UPDATE SET revision=excluded.revision,datos=excluded.datos',[E,plan.revision,JSON.stringify(plan)]);
   return {asignados:customers.length,revision:plan.revision};
  });},
  importState:async input=>{admin();return typeof input==='string'?state(input):state(input.id,input);},
  prepareImport:async command=>{shared();return journal(command,async()=>{
   if(!IMPORT_KINDS.includes(command.tipo)||!Array.isArray(command.matrix))throw new ApiError(422,'Archivo inválido');let validated;try{validated=normalizeImport(command.tipo,command.matrix);}catch(e){throw new ApiError(422,e.message);}
   const hash=digest({tipo:command.tipo,matrix:command.matrix}),existing=(await rows('SELECT importacion_id AS id FROM mayorista.importaciones WHERE empresa_id=$1 AND tipo=$2 AND huella=$3',[E,command.tipo,hash]))[0];if(existing)return state(existing.id);
   const id=randomUUID();await query('INSERT INTO mayorista.importaciones(empresa_id,importacion_id,tipo,huella,creado_por) VALUES($1,$2,$3,$4,$5)',[E,id,command.tipo,hash,principal.userId]);
   // Una única inserción acotada, sin viajes SQL por cada fila del archivo.
   await query(`INSERT INTO mayorista.importacion_filas(empresa_id,importacion_id,fila,datos,estado,resultado) SELECT $1,$2,(r->>'fila')::int,r->'row',CASE WHEN jsonb_array_length(r->'errors')>0 THEN 'error' ELSE 'pendiente' END,jsonb_build_object('errores',r->'errors') FROM jsonb_array_elements($3::jsonb) r`,[E,id,JSON.stringify(validated)]);
   return state(id);
  });},
  processImport:async command=>{shared();return journal(command,async()=>{
   const j=await job(command.importacionId);
   if(command.tipo==='corregir'){
    const rowsToFix=normalizeImport(j.tipo,[command.encabezados,command.fila]);const fixed=rowsToFix[0];if(!fixed||fixed.errors.length)throw new ApiError(422,fixed?.errors.join('. ')??'Fila vacía');
    const r=await query("UPDATE mayorista.importacion_filas SET datos=$4::jsonb,estado='pendiente',resultado=null WHERE empresa_id=$1 AND importacion_id=$2 AND fila=$3 AND estado<>'aplicada' RETURNING fila",[E,j.id,command.numero,JSON.stringify(fixed.row)]);if(!r.rows.length)throw new ApiError(409,'Fila aplicada o no disponible');
   }else if(command.tipo==='aplicar'){
    const batch=await rows("SELECT fila,datos FROM mayorista.importacion_filas WHERE empresa_id=$1 AND importacion_id=$2 AND estado='pendiente' ORDER BY fila LIMIT 25 FOR UPDATE",[E,j.id]);
    for(const item of batch){
     await query('SAVEPOINT import_row');let result,status='aplicada';
     try{const normalized=normalizeImport(j.tipo,[Object.keys(item.datos),Object.values(item.datos)])[0];if(normalized.errors.length)throw Error(normalized.errors.join('. '));result=(await rows('SELECT mayorista.importar_fila($1,$2,$3,$4::jsonb) AS r',[E,j.tipo,normalized.identity,JSON.stringify(item.datos)]))[0].r;}
     catch(e){await query('ROLLBACK TO SAVEPOINT import_row');if(['40001','40P01'].includes(e.code))throw e;status='error';result={errores:[e.code==='42501'?'Sin permisos para esta operación':String(e.message).slice(0,250)]};}
     await query('RELEASE SAVEPOINT import_row');await query('UPDATE mayorista.importacion_filas SET estado=$4,resultado=$5::jsonb WHERE empresa_id=$1 AND importacion_id=$2 AND fila=$3',[E,j.id,item.fila,status,JSON.stringify(result)]);
    }
   }else throw new ApiError(422,'Acción inválida');
   await query("UPDATE mayorista.importaciones SET estado=CASE WHEN EXISTS(SELECT 1 FROM mayorista.importacion_filas f WHERE f.empresa_id=$1 AND f.importacion_id=$2 AND f.estado='pendiente') THEN 'en_progreso' WHEN EXISTS(SELECT 1 FROM mayorista.importacion_filas f WHERE f.empresa_id=$1 AND f.importacion_id=$2 AND f.estado='error') THEN 'requiere_revision' ELSE 'completada' END WHERE empresa_id=$1 AND importacion_id=$2",[E,j.id]);return state(j.id);
  });}
 };
}
