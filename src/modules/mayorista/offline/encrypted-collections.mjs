/** Cobros pendientes cifrados. Solo el acuse transaccional confirma Caja/cuenta. */
export async function syncEncryptedCollections(workspace,send){
 if(!navigator.locks)throw Error('Bloqueo seguro de cobranzas no disponible');
 return navigator.locks.request(JSON.stringify(['mayorista-cobros',workspace.scope]),{ifAvailable:true},async lock=>{
  let enviados=0,fallidos=0;if(!lock)return {enviados,fallidos};
  for(const record of await workspace.list('collections')){
   if(record.data.estado==='sincronizado')continue;
   const actual={...record.data,estado:'sincronizando',error:null},saved=await workspace.write('collections',record.id,actual,record.revision);
   try{
    const ack=await send(actual);
    if(ack?.estado!=='confirmado'||ack.empresaId!==actual.empresaId||ack.comandoId!==actual.id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ack.movimientoId??''))throw Error('Acuse de cobranza inválido');
    await workspace.write('collections',record.id,{...actual,estado:'sincronizado',movimientoId:ack.movimientoId},saved.revision);enviados++;
   }catch(e){await workspace.write('collections',record.id,{...actual,estado:'error',error:e.message},saved.revision);fallidos++;}
  }return {enviados,fallidos};
 });
}
