import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export async function verifyCargasApi({call,token,empresaId,otraEmpresa,productoId,pool,makeOrder}){
  const results=[];let state=(await call('/cargas',{token})).body;
  async function check(name,fn){await fn();results.push({name,status:'pass'});console.log('PASS:',name);}
  const make=(tipo,input)=>({id:randomUUID(),empresaId,version:state.revision,tipo,input});
  const send=async(tipo,input)=>{const body=make(tipo,input),r=await call('/cargas/commands',{token,body});assert.equal(r.status,200,JSON.stringify(r.body));state=r.body;return body;};
  const a=makeOrder(),b=makeOrder();for(const o of [a,b])assert.equal((await call('/orders',{token,body:o})).status,200);
  await check('Cargas recibe pedidos reales y no confía en aprobación/precios del cliente',async()=>{
    const c=await send('aprobar',{pedidoId:a.pedidoId,pedido:{...a,estado:'aprobado',lineas:[{productoId,precioUnitario:1,cantidad:999}]}});
    assert.equal(state.pedidos[a.pedidoId].lineas[0].cantidad,2);assert.equal(state.pedidos[a.pedidoId].lineas[0].precioUnitario,10);
    const revision=state.revision;assert.equal((await call('/cargas/commands',{token,body:c})).body.revision,revision);
    await send('aprobar',{pedidoId:b.pedidoId});
  });
  await check('Aprobación de cargas impide despacho por el flujo individual paralelo',async()=>{assert.equal((await call('/admin/fulfillment',{token,body:{empresaId,pedidoId:a.pedidoId,id:randomUUID(),version:0,tipo:'estado',estado:'preparacion',nota:'QA'}})).status,409);});
  const cargo=randomUUID(),other=randomUUID();
  await send('crear',{id:cargo,modo:'consolidada',camion:'AA123BB',ruta:'QA-R1',chofer:'QA-CHOFER',responsable:'QA-ARMADOR'});
  await send('crear',{id:other,modo:'individual',camion:'BB456CC',ruta:'QA-R2',chofer:'QA-CHOFER2',responsable:'QA-ARMADOR'});
  await check('Asignación concurrente a dos cargas produce un solo destino y reserva única',async()=>{
    const version=state.revision,commands=[cargo,other].map(cargaId=>({id:randomUUID(),empresaId,version,tipo:'asignar',input:{cargaId,pedidoId:a.pedidoId}}));
    const rs=await Promise.all(commands.map(body=>call('/cargas/commands',{token,body})));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);state=rs.find(r=>r.status===200).body;
    assert.equal((await pool.query('SELECT carga_id FROM mayorista.cargas_asignaciones WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,a.pedidoId])).rows.length,1);
  });
  // Si ganó la modalidad individual, cancelar antes de picking y reagrupar sin duplicación.
  if(state.pedidos[a.pedidoId].cargaId===other){await send('cancelar',{cargaId:other,nota:'Reagrupar QA'});await send('asignar',{cargaId:cargo,pedidoId:a.pedidoId});}
  await send('asignar',{cargaId:cargo,pedidoId:b.pedidoId});await send('codigo',{productoId,codigo:'9780201379624',unidadesBase:1});await send('iniciar',{cargaId:cargo});
  await check('Barcode ajeno y salida no verificada se rechazan en API',async()=>{assert.equal((await call('/cargas/commands',{token,body:make('escanear',{cargaId:cargo,codigo:'NO-CODE',cantidad:4,modo:'picking'})})).status,409);assert.equal((await call('/cargas/commands',{token,body:make('salir',{cargaId:cargo,nota:'QA'})})).status,409);});
  await check('Picking consolidado real, entrega por cliente y rendición auditada',async()=>{
    const scan=await send('escanear',{cargaId:cargo,codigo:'9780201379624',cantidad:4,modo:'picking'});const revision=state.revision;
    assert.equal((await call('/cargas/commands',{token,body:scan})).body.revision,revision);
    await send('verificar',{cargaId:cargo});await send('salir',{cargaId:cargo,nota:'Remito carga QA'});
    for(const pedidoId of [a.pedidoId,b.pedidoId]){await send('entregar',{cargaId:cargo,pedidoId,lineas:[{productoId,entregado:1,devuelto:1}],nota:'Firma cliente QA'});await send('rendir',{cargaId:cargo,pedidoId,centavos:1000,nota:'Recibo QA'});await send('revisar_rendicion',{cargaId:cargo,pedidoId,nota:'Revisión QA'});}
    await send('cerrar',{cargaId:cargo});assert.equal(state.cargas[cargo].estado,'cerrada');assert.ok(state.historial.every(e=>e.responsable&&e.fecha));
    assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.cargas_asignaciones WHERE empresa_id=$1',[empresaId])).rows[0].count),2);
  });
  await check('Reapertura del servicio conserva carga y pedidos originales recibidos',async()=>{const r=await call('/cargas',{token});assert.deepEqual(r.body,state);assert.equal((await call('/orders',{token,body:a})).status,200);assert.equal((await pool.query('SELECT estado FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,a.pedidoId])).rows[0].estado,'recibido');});
  await check('Cargas rechaza otra empresa y RLS oculta filas ajenas',async()=>{
    assert.equal((await call('/cargas/commands',{token,body:{...make('crear',{id:randomUUID(),modo:'individual',camion:'X',ruta:'R',chofer:'C',responsable:'A'}),empresaId:otraEmpresa}})).status,403);
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');const actor=state.historial[0].responsable;await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor,JSON.stringify({sub:actor,is_anonymous:false})]);assert.equal((await c.query('SELECT empresa_id FROM mayorista.cargas_estado WHERE empresa_id=$1',[otraEmpresa])).rows.length,0);}finally{await c.query('ROLLBACK');c.release();}
  });
  return results;
}
