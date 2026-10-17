import {createHash} from 'node:crypto';
import {ApiError} from '../api/receive-order.mjs';
import {administrative} from '../security/company-roles.mjs';
import {canonical} from '../cargas/model.mjs';
import {METRICS,goalProgress,normalizeReportFilters,calculateManagementMetrics} from './management-metrics.mjs';
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function normalizeGoal(input) {
  if (!uuid(input?.id) || input.vendedorId !== null && !uuid(input.vendedorId) || !Object.hasOwn(METRICS,input.metrica) || !['diario','semanal','mensual','personalizado'].includes(input.periodo) || !Number.isSafeInteger(input.objetivo) || input.objetivo <= 0 || typeof input.activa !== 'boolean') throw new ApiError(422,'Objetivo inválido');
  let filters; try { filters=normalizeReportFilters({periodo:'personalizado',desde:input.desde,hasta:input.hasta}); } catch { throw new ApiError(422,'Período inválido'); }
  const start=new Date(filters.desde),end=new Date(filters.hastaExclusivo),days=(end-start)/86400000;
  if (input.periodo==='diario'&&days!==1 || input.periodo==='semanal'&&(days!==7||start.getUTCDay()!==1) || input.periodo==='mensual'&&(start.getUTCDate()!==1||end.getUTCDate()!==1||end.getUTCMonth()!==(start.getUTCMonth()+1)%12)) throw new ApiError(422,'El período no concilia con las fechas');
  return {id:input.id,vendedorId:input.vendedorId,metrica:input.metrica,periodo:input.periodo,desde:input.desde,hasta:input.hasta,objetivo:input.objetivo,activa:input.activa};
}
export function createGoalsTransaction({query,principal,readMetricsData}) {
  const E=principal.empresaId;
  const fields='meta_id AS id,vendedor_id AS "vendedorId",metrica,periodo,desde::text,hasta::text,objetivo::text,activa,version';
  return {
    goals:async()=>{
      if (!administrative(principal)&&principal.rol!=='vendedor') throw new ApiError(403,'Sin permisos de objetivos');
      const rows=(await query(`SELECT ${fields} FROM mayorista.metas WHERE empresa_id=$1 ORDER BY desde DESC,meta_id`,[E])).rows;
      if(!rows.length)return {empresaId:E,objetivos:[]};
      const data=await readMetricsData({personal:principal.rol==='vendedor'});
      const computed=new Map();
      const objetivos=rows.map(row=>{
        const filters=normalizeReportFilters({periodo:'personalizado',desde:row.desde,hasta:row.hasta,vendedorId:row.vendedorId??''});
        const key=JSON.stringify(filters);if(!computed.has(key))computed.set(key,calculateManagementMetrics(data,filters).resumen);const metrics=computed.get(key);
        // Personal no tiene acceso al libro de otros roles; no confundir ausencia de acceso con cero cobrado.
        const actual=principal.rol==='vendedor'&&data.personalLedgerAvailable!==true&&['cobrado','deuda_recuperada'].includes(row.metrica)?null:metrics[row.metrica];
        return {...row,objetivo:Number(row.objetivo),nombre:METRICS[row.metrica],...goalProgress(Number(row.objetivo),actual)};
      });
      return {empresaId:E,objetivos};
    },
    goalCommand:async command=>{
      if(!administrative(principal)||command?.empresaId!==E)throw new ApiError(403,'Sin permisos de objetivos');
      if(!uuid(command.id)||!Number.isSafeInteger(command.version)||command.version<0)throw new ApiError(422,'Comando inválido');
      const input=normalizeGoal(command.input),hash=createHash('sha256').update(JSON.stringify(canonical({tipo:'meta',input}))).digest('hex');
      const previous=(await query('SELECT huella,respuesta FROM mayorista.comandos_administrativos WHERE empresa_id=$1 AND comando_id=$2',[E,command.id])).rows[0];
      if(previous){if(previous.huella!==hash)throw new ApiError(409,'UUID reutilizado');return previous.respuesta;}
      const old=(await query('SELECT version FROM mayorista.metas WHERE empresa_id=$1 AND meta_id=$2 FOR UPDATE',[E,input.id])).rows[0];
      if((old?.version??0)!==command.version)throw new ApiError(409,'Objetivo editado en otra sesión');
      if(input.vendedorId&&!(await query('SELECT vendedor_id FROM mayorista.vendedores WHERE empresa_id=$1 AND vendedor_id=$2',[E,input.vendedorId])).rows.length)throw new ApiError(422,'Vendedor ajeno o inexistente');
      const version=command.version+1;
      await query(`INSERT INTO mayorista.metas(empresa_id,meta_id,vendedor_id,metrica,periodo,desde,hasta,objetivo,activa,version,actualizado_por)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(empresa_id,meta_id) DO UPDATE SET vendedor_id=excluded.vendedor_id,metrica=excluded.metrica,periodo=excluded.periodo,desde=excluded.desde,hasta=excluded.hasta,objetivo=excluded.objetivo,activa=excluded.activa,version=excluded.version,actualizado_por=excluded.actualizado_por,actualizado_en=now()`,[E,input.id,input.vendedorId,input.metrica,input.periodo,input.desde,input.hasta,input.objetivo,input.activa,version,principal.userId]);
      const response={empresaId:E,id:input.id,version};
      await query('INSERT INTO mayorista.comandos_administrativos(empresa_id,comando_id,huella,actor_id,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)',[E,command.id,hash,principal.userId,JSON.stringify(response)]);
      return response;
    }
  };
}

