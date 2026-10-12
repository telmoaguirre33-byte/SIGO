/** Outbox cifrada con UUID estable; nunca confirma sin acuse del servidor. */
export async function syncEncryptedVisits(workspace,send){
  if(!navigator.locks)throw new Error('Bloqueo seguro de visitas no disponible');
  return navigator.locks.request(JSON.stringify(['mayorista-encrypted-visits',workspace.scope]),{ifAvailable:true},async lock=>{
    let enviados=0,fallidos=0;if(!lock)return {enviados,fallidos};
    for(const r of await workspace.list('visits')){
      if(r.data.estado==='sincronizado')continue;
      const visit={...r.data,estado:'sincronizando',intentos:(r.data.intentos??0)+1};const saved=await workspace.write('visits',r.id,visit,r.revision);
      try{const ack=await send(visit);if(ack?.id!==visit.id||ack.empresaId!==visit.empresaId||ack.vendedorId!==visit.vendedorId||!Number.isFinite(Date.parse(ack.recibidaEn)))throw new Error('Acuse de visita inválido');await workspace.write('visits',r.id,{...visit,estado:'sincronizado',recibidaEn:ack.recibidaEn,error:null},saved.revision);enviados++;}
      catch(e){await workspace.write('visits',r.id,{...visit,estado:'error',error:e.message},saved.revision);fallidos++;}
    }
    return {enviados,fallidos};
  });
}
