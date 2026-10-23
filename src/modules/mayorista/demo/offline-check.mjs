import {PedidosIndexedDB} from './offline/pedidos-indexeddb.js';
import {guardarCatalogo,leerCatalogo} from './offline/catalogo-indexeddb.js';
import {sampleCatalog} from './sample.mjs';

const DB='sigo-mayorista-diagnostics-v1';
const message=document.querySelector('#message');
let busy=false;
function check(condition,text){if(!condition)throw new Error(text);}
async function operate(store,mode,fn){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('runs');r.result.createObjectStore('receipts');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Cerrá otras pestañas para actualizar el diagnóstico'));});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{fn(tx.objectStore(store),value=>{result=value;},tx);}catch(e){tx.abort();reject(e);}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Transacción de diagnóstico cancelada'));});}finally{db.close();}
}
const read=()=>operate('runs','readonly',(s,done)=>{const r=s.get('current');r.onsuccess=()=>done(r.result??null);});
const write=run=>operate('runs','readwrite',s=>s.put(run,'current'));
const queue=run=>new PedidosIndexedDB(run.scope.empresaId,run.scope.vendedorId);
const lines=[{productoId:'p1',cantidad:1,precioUnitario:2200}];
async function record(name,status,detail){
  const append=async()=>{const run=await read();if(!run)return;run.results.push({name,status,detail,date:new Date().toISOString(),online:navigator.onLine});await write(run);};
  if(navigator.locks)await navigator.locks.request('sigo-mayorista-diagnostics-evidence',append);else await append();
}
async function render(){
  document.querySelector('#connection').textContent=navigator.onLine?'Con conexión':'Sin conexión';
  const run=await read();
  document.querySelector('#run-info').textContent=run?`Prueba ${run.id} · empresa ficticia ${run.scope.empresaId}`:'Todavía no se inició una prueba.';
  const results=document.querySelector('#results');results.replaceChildren();
  for(const r of run?.results??[]){const card=document.createElement('article');card.className='card';const title=document.createElement('h2');title.textContent=r.status+' · '+r.name;const text=document.createElement('p');text.textContent=r.detail;const time=document.createElement('small');time.textContent=r.date+' · '+(r.online?'online':'offline');card.append(title,text,time);results.append(card);}
}
async function perform(name,fn,{exclusive=true}={}){
  if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;
  try{
    const execute=async()=>{const detail=await fn();await record(name,'APROBADA',detail);message.textContent=detail;};
    if(exclusive && navigator.locks)await navigator.locks.request('sigo-mayorista-diagnostics-action',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Otra pestaña está preparando/verificando esta prueba');await execute();});else await execute();
  }catch(e){message.textContent='ERROR: '+e.message;await record(name,'ERROR',e.message).catch(()=>{});}
  finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;await render();}
}
async function requireRun(){const run=await read();if(!run)throw new Error('Primero creá los pedidos ficticios');return run;}
async function receive(run,order){
  if(!navigator.onLine)throw new Error('Sin red: el diagnóstico conserva el pedido para reintentar');
  check(order.empresaId===run.scope.empresaId && order.vendedorId===run.scope.vendedorId,'Pedido fuera del ámbito de diagnóstico');
  const key=JSON.stringify([order.empresaId,order.id]);
  const fingerprint=JSON.stringify([order.clienteId,order.lineas]);
  return operate('receipts','readwrite',(s,done,tx)=>{const r=s.get(key);r.onsuccess=()=>{if(r.result && r.result.fingerprint!==fingerprint){tx.abort();return;}const receipt=r.result??{id:order.id,empresaId:order.empresaId,vendedorId:order.vendedorId,confirmadoEn:new Date().toISOString(),fingerprint};s.put(receipt,key);done(receipt);};});
}
document.querySelector('#prepare').onclick=()=>perform('Guardar 100 pedidos',async()=>{
  let run=await read();
  if(!run){const id=crypto.randomUUID();run={id,scope:{empresaId:'diagnostico-'+id,vendedorId:'vendedor-prueba'},ids:Array.from({length:100},()=>crypto.randomUUID()),createdAt:new Date().toISOString(),results:[]};await write(run);}
  // Los UUID se guardan antes de cualquier pedido; un cierre parcial se completa con los mismos IDs.
  if(!await leerCatalogo(run.scope.empresaId,run.scope.vendedorId))await guardarCatalogo(sampleCatalog(run.scope));
  const q=queue(run);for(let i=0;i<run.ids.length;i++){await q.crear('c1',lines,run.ids[i]);message.textContent=`Guardados o recuperados ${i+1}/100`;}
  const orders=await q.listar();check(run.ids.every(id=>orders.some(o=>o.id===id)),'Faltan pedidos');
  return '100 pedidos conservados con UUID estables. Repetir esta acción no crea nuevos pedidos.';
});
document.querySelector('#verify').onclick=()=>perform('Recuperar 100 UUID y contenidos',async()=>{
  const run=await requireRun(),orders=await queue(run).listar();
  for(const id of run.ids){const rows=orders.filter(o=>o.id===id);check(rows.length===1,'UUID ausente o duplicado: '+id);check(rows[0].clienteId==='c1' && JSON.stringify(rows[0].lineas)===JSON.stringify(lines),'Contenido alterado: '+id);}
  check(await leerCatalogo(run.scope.empresaId,run.scope.vendedorId),'Catálogo ausente');
  return '100 UUID únicos y contenidos originales recuperados desde IndexedDB; catálogo disponible.';
});
document.querySelector('#network-error').onclick=()=>perform('Error de envío conserva pedidos',async()=>{
  const run=await requireRun(),q=queue(run),before=await q.listar();
  const pending=before.filter(o=>o.estado!=='sincronizado').length;check(pending>0,'No hay pedidos pendientes: ejecutar antes de sincronizar');
  const result=await q.sincronizar(async()=>{throw new Error('Error de red simulado');});
  const after=await q.listar();check(after.length===before.length,'Se perdió un pedido');check(result.fallidos===pending,'No se registraron todos los errores');
  return `${pending} errores simulados. Todos los pedidos permanecen guardados para reintentar.`;
});
document.querySelector('#sync').onclick=()=>perform('Sincronización ficticia local',async()=>{
  check(navigator.onLine,'Volvé a conectar internet antes de esta acción');const run=await requireRun();
  const result=await queue(run).sincronizar(order=>receive(run,order));check(result.fallidos===0,'Hay errores; revisar resultados');
  return `${result.enviados} acuses locales. Si otra pestaña tiene el lock, esta llamada devuelve 0 sin enviar. No hay recepción remota.`;
},{exclusive:false});
document.querySelector('#after-receive').onclick=()=>perform('Caída posterior a recepción ficticia',async()=>{
  check(navigator.onLine,'Esta simulación necesita conexión indicada por el navegador');const run=await requireRun(),q=queue(run);
  if(!run.recoveryId){run.recoveryId=crypto.randomUUID();await write(run);}
  await q.crear('c1',lines,run.recoveryId);
  await q.sincronizar(async order=>{const receipt=await receive(run,order);if(order.id===run.recoveryId)throw new Error('Caída simulada después de recibir');return receipt;});
  check((await q.listar()).find(o=>o.id===run.recoveryId)?.estado==='error','El pedido de recuperación no quedó pendiente de reintento');
  return 'Receptor ficticio recibió el pedido, pero la cola conserva error y el mismo UUID.';
});
document.querySelector('#retry').onclick=()=>perform('Reintento conserva UUID y acuse',async()=>{
  const run=await requireRun();check(run.recoveryId,'Primero simulá la caída posterior a recepción');
  const key=JSON.stringify([run.scope.empresaId,run.recoveryId]);
  const before=await operate('receipts','readonly',(s,done)=>{const r=s.get(key);r.onsuccess=()=>done(r.result);});check(before,'Falta acuse previo');
  const q=queue(run);await q.sincronizar(order=>receive(run,order));
  const after=await operate('receipts','readonly',(s,done)=>{const r=s.get(key);r.onsuccess=()=>done(r.result);});
  check(after.confirmadoEn===before.confirmadoEn,'Acuse duplicado o reemplazado');check((await q.listar()).find(o=>o.id===run.recoveryId)?.estado==='sincronizado','No se confirmó el reintento');
  return 'Mismo UUID y fecha de acuse; pedido sincronizado con el receptor ficticio, sin una segunda recepción.';
});
document.querySelector('#inventory').onclick=()=>perform('Inventario de IDs y acuses',async()=>{
  const run=await requireRun(),orders=await queue(run).listar();const receipts=await operate('receipts','readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>done(r.result);});
  const own=receipts.filter(r=>r.empresaId===run.scope.empresaId && r.vendedorId===run.scope.vendedorId);
  check(new Set(orders.map(o=>o.id)).size===orders.length,'Pedidos duplicados');check(new Set(own.map(r=>r.id)).size===own.length,'Acuses duplicados');
  return `${orders.length} pedidos y ${own.length} acuses ficticios únicos. Esto no demuestra que cada cola haya intentado un solo envío concurrente; la suite CDP registra ese contador.`;
});
document.querySelector('#export').onclick=async()=>{try{const run=await requireRun(),orders=await queue(run).listar();const content=JSON.stringify({...run,exportedAt:new Date().toISOString(),userAgent:navigator.userAgent,orders,limitations:['recepción local ficticia','cierre físico debe acreditarlo tester','no valida PostgreSQL/RLS','no demuestra Android desde headless']},null,2);const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mayorista-diagnostico-'+run.id+'.json';a.click();URL.revokeObjectURL(url);}catch(e){message.textContent=e.message;}};
window.addEventListener('online',()=>void render());window.addEventListener('offline',()=>void render());
try{await render();if('serviceWorker'in navigator)await navigator.serviceWorker.register('./sw.js');}catch(e){message.textContent='No se pudo iniciar diagnóstico: '+e.message;}
