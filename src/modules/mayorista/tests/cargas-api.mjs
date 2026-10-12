import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export async function verifyCargasApi({call,token,empresaId,otraEmpresa,productoId,pool,makeOrder,restart}){
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
    const ingreso={id:randomUUID(),empresaId,tipo:'ingreso',input:{productoId,cantidad:10,comprobante:'INGRESO-QA-1'}};
    assert.equal((await call('/inventory/commands',{token,body:ingreso})).status,200);assert.equal((await call('/inventory/commands',{token,body:ingreso})).status,200);
    assert.equal((await call('/inventory/commands',{token,body:{...ingreso,id:randomUUID()}})).status,409);
    assert.equal((await call('/inventory/commands',{token,body:{...ingreso,input:{...ingreso.input,cantidad:11}}})).status,409);
    const verificado=await send('verificar',{cargaId:cargo});assert.equal((await call('/inventory',{token})).body.productos[0].reservadas,4);
    assert.equal((await call('/cargas/commands',{token,body:verificado})).status,200);assert.equal((await call('/inventory',{token})).body.productos[0].reservadas,4);
    await send('salir',{cargaId:cargo,nota:'Remito carga QA'});assert.deepEqual((await call('/inventory',{token})).body.productos[0],{productoId,unidades:6,reservadas:0,disponibles:6});
    for(const pedidoId of [a.pedidoId,b.pedidoId]){await send('entregar',{cargaId:cargo,pedidoId,lineas:[{productoId,entregado:1,devuelto:1}],nota:'Firma cliente QA'});await send('rendir',{cargaId:cargo,pedidoId,centavos:1000,nota:'Recibo QA'});await send('revisar_rendicion',{cargaId:cargo,pedidoId,nota:'Revisión QA'});}
    const cerrado=await send('cerrar',{cargaId:cargo});assert.equal((await call('/inventory',{token})).body.productos[0].unidades,8);assert.equal((await call('/cargas/commands',{token,body:cerrado})).status,200);assert.equal((await call('/inventory',{token})).body.productos[0].unidades,8);assert.equal(state.cargas[cargo].estado,'cerrada');assert.ok(state.historial.every(e=>e.responsable&&e.fecha));
    assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.cargas_asignaciones WHERE empresa_id=$1',[empresaId])).rows[0].count),2);
  });
  await check('Reapertura del servicio conserva carga y pedidos originales recibidos',async()=>{await restart();let r;try{r=await call('/cargas',{token});}catch(e){assert.ok(e instanceof TypeError&&e.message==='fetch failed');r=await call('/cargas',{token});}assert.deepEqual(r.body,state);assert.equal((await call('/orders',{token,body:a})).status,200);assert.equal((await pool.query('SELECT estado FROM mayorista.pedidos WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,a.pedidoId])).rows[0].estado,'recibido');});
  await check('Cargas rechaza otra empresa y RLS oculta filas ajenas',async()=>{
    assert.equal((await call('/cargas/commands',{token,body:{...make('crear',{id:randomUUID(),modo:'individual',camion:'X',ruta:'R',chofer:'C',responsable:'A'}),empresaId:otraEmpresa}})).status,403);
    await pool.query('INSERT INTO mayorista.cargas_estado(empresa_id,revision,datos) VALUES($1,1,$2::jsonb)',[otraEmpresa,JSON.stringify({empresaId:otraEmpresa})]);
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');const actor=state.historial[0].responsable;await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor,JSON.stringify({sub:actor,is_anonymous:false})]);assert.equal((await c.query('SELECT empresa_id FROM mayorista.cargas_estado WHERE empresa_id=$1',[otraEmpresa])).rows.length,0);}finally{await c.query('ROLLBACK');c.release();}
  });
  await check('Cuentas mayoristas contabilizan entregas y cobros revisados una vez',async()=>{const r=await call('/accounts',{token});assert.equal(r.status,200);assert.equal(r.body.cuentas.length,1);assert.equal(r.body.cuentas[0].saldoCentavos,'0');assert.equal(r.body.movimientos.length,4);assert.equal(r.body.movimientos.filter(m=>m.tipo==='entrega').length,2);assert.equal(r.body.movimientos.filter(m=>m.tipo==='cobranza').length,2);assert.ok(r.body.movimientos.every(m=>m.responsable));});
  await check('Inventario separado conserva saldo y rechaza acceso cruzado',async()=>{const r=await call('/inventory',{token});assert.equal(r.status,200);assert.deepEqual(r.body.productos[0],{productoId,unidades:8,reservadas:0,disponibles:8});assert.equal((await call('/inventory/commands',{token,body:{id:randomUUID(),empresaId:otraEmpresa,tipo:'ingreso',input:{productoId,cantidad:1,comprobante:'AJENO'}}})).status,403);assert.equal(Number((await pool.query('SELECT count(*) FROM mayorista.movimientos_inventario')).rows[0].count),4);});
  await check('Reservas concurrentes de inventario propio no consumen dos veces disponibilidad',async()=>{
    // Dos cargas verificadas ficticias, solo en la base efímera; cada una solicita 5 de 8 unidades.
    const ids=[randomUUID(),randomUUID()],fixture=structuredClone(state);
    for(const id of ids)fixture.cargas[id]={...structuredClone(state.cargas[cargo]),id,estado:'verificada',pedidos:{[randomUUID()]:{clienteId:makeOrder().clienteId,lineas:[{productoId,cantidad:5,preparado:5,escaneado:5}]}}};
    await pool.query('UPDATE mayorista.cargas_estado SET datos=$2::jsonb WHERE empresa_id=$1',[empresaId,JSON.stringify(fixture)]);
    const commands=ids.map(cargaId=>({id:randomUUID(),empresaId,tipo:'reserva',input:{cargaId}}));const rs=await Promise.all(commands.map(body=>call('/inventory/commands',{token,body})));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await call('/inventory',{token})).body.productos[0].reservadas,5);
    // Confirmar movimiento ganador; reintento no modifica disponibilidad.
    const winning=commands[rs.findIndex(r=>r.status===200)];assert.equal((await call('/inventory/commands',{token,body:winning})).status,200);assert.equal((await call('/inventory',{token})).body.productos[0].disponibles,3);
  });
  return results;
}
