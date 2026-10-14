import {verificarResultadoEnvio} from './pedidos-locales.js';
/** Cola cifrada operativa. La demo antigua permanece intacta y no migra datos sola. */
export class EncryptedOrders{
  constructor(workspace){this.workspace=workspace;}
  async listar(){return (await this.workspace.list('orders')).map(r=>r.data);}
  async crear(clienteId,lineas,id=crypto.randomUUID(),comerciales){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!clienteId||!Array.isArray(lineas)||!lineas.length||lineas.length>200||lineas.some(l=>!l?.productoId||!Number.isSafeInteger(l.cantidad)||l.cantidad<1||!Number.isFinite(l.precioUnitario)||l.precioUnitario<0))throw new Error('Pedido inválido');
    const normalized=lineas.map(l=>({...l}));
    const existing=await this.workspace.read('orders',id);if(existing){if(existing.data.clienteId!==clienteId||JSON.stringify(existing.data.lineas)!==JSON.stringify(normalized)||JSON.stringify(existing.data.comerciales)!==JSON.stringify(comerciales))throw new Error('UUID reutilizado con contenido diferente');return existing.data;}
    const now=new Date().toISOString(),order={id,...this.workspace.scope,clienteId,lineas:normalized,...(comerciales?{comerciales}:{}),creadoEn:now,actualizadoEn:now,estado:'pendiente',intentos:0};
    try{await this.workspace.write('orders',id,order);}catch(e){const raced=await this.workspace.read('orders',id);if(!raced||raced.data.clienteId!==clienteId||JSON.stringify(raced.data.lineas)!==JSON.stringify(normalized)||JSON.stringify(raced.data.comerciales)!==JSON.stringify(comerciales))throw e;return raced.data;}return order;
  }
  async sincronizar(send){
    if(!navigator.locks)throw new Error('Sincronización segura no disponible');
    return navigator.locks.request(JSON.stringify(['mayorista-encrypted-sync',this.workspace.scope]),{ifAvailable:true},async lock=>{
      if(!lock)return {enviados:0,fallidos:0};let enviados=0,fallidos=0;
      for(const record of await this.workspace.list('orders')){
        if(record.data.estado==='sincronizado')continue;
        const active={...record.data,estado:'sincronizando',intentos:record.data.intentos+1,actualizadoEn:new Date().toISOString(),error:null};const saved=await this.workspace.write('orders',active.id,active,record.revision);
        try{const receipt=await send(active);verificarResultadoEnvio(active,receipt);await this.workspace.write('orders',active.id,{...active,estado:'sincronizado',confirmadoEn:receipt.confirmadoEn},saved.revision);enviados++;}
        catch(e){await this.workspace.write('orders',active.id,{...active,estado:'error',error:e.message??'Error de sincronización'},saved.revision);fallidos++;}
      }
      return {enviados,fallidos};
    });
  }
}
