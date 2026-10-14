// Sector independiente: cantidades operativas, nunca movimientos de stock SIGO.
const text=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>160)throw new Error(label+' inválido');return v.trim();};
const integer=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>1000000)throw new Error('Cantidad inválida');return v;};
const note=v=>text(v,'Motivo/comprobante');
export function canonical(value){return value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))):value;}
export function createLoadsState(empresaId){return {empresaId:text(empresaId,'Empresa'),revision:0,pedidos:{},cargas:{},codigos:{},historial:[],comandos:[]};}
export function validateBarcode(raw){
  const code=text(raw,'Código');if(['__proto__','constructor','prototype'].includes(code))throw new Error('Código reservado');if(!/^[A-Za-z0-9._/-]{3,64}$/.test(code))throw new Error('Código de barras inválido');
  if(/^\d+$/.test(code)&&[8,12,13,14].includes(code.length)){
    const digits=[...code].map(Number),last=digits.pop();let sum=0;
    for(let i=digits.length-1,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=digits[i]*weight;
    if((10-sum%10)%10!==last)throw new Error('Dígito de control de código incorrecto');
  }
  return code;
}
function approved(source){
  if(source?.estado!=='recibido'||!source.pedidoId||!source.clienteId||!Array.isArray(source.lineas)||!source.lineas.length)throw new Error('Pedido no recibido para aprobación');
  const lines=new Map();
  for(const l of source.lineas){integer(l.cantidad,1);text(l.productoId,'Producto');if(!Number.isFinite(l.precioUnitario)||l.precioUnitario<0)throw new Error('Precio inválido');
    const old=lines.get(l.productoId),amount=Math.round(l.cantidad*l.precioUnitario*100),cantidad=integer((old?.cantidad??0)+l.cantidad,1),totalCentavos=(old?.totalCentavos??0)+amount;
    if(!Number.isSafeInteger(amount)||!Number.isSafeInteger(totalCentavos))throw new Error('Importe fuera del rango permitido');
    lines.set(l.productoId,{productoId:l.productoId,nombre:l.nombre??l.productoId,cantidad,precioUnitario:totalCentavos/100/cantidad,totalCentavos,desglosePrecios:[...(old?.desglosePrecios??[]),{cantidad:l.cantidad,precioUnitario:l.precioUnitario,centavos:amount,...(l.precioId?{precioId:l.precioId}:{}),...(l.presentacion?{presentacion:l.presentacion}:{}),...(l.unidadesBase?{unidadesBase:l.unidadesBase}:{}),...(l.observacion?{observacion:l.observacion}:{})}]});
  }
  const total=[...lines.values()].reduce((s,l)=>s+l.totalCentavos,0);if(!Number.isSafeInteger(total))throw new Error('Importe fuera del rango permitido');
  return {pedidoId:source.pedidoId,clienteId:source.clienteId,cliente:source.cliente??source.clienteId,estado:'aprobado',rutaId:source.rutaId??null,...(source.comerciales?{comerciales:source.comerciales}:{}),lineas:[...lines.values()]};
}
function lines(load,pedidoId,productoId,clienteId){
  if(pedidoId&&!load.pedidos[pedidoId])throw new Error('Pedido no pertenece a la carga');
  if(clienteId&&!Object.values(load.pedidos).some(p=>p.clienteId===clienteId))throw new Error('Cliente no pertenece a la carga');
  const out=[];for(const id of Object.keys(load.pedidos).sort()){if(pedidoId&&pedidoId!==id||clienteId&&load.pedidos[id].clienteId!==clienteId)continue;for(const l of load.pedidos[id].lineas)if(l.productoId===productoId)out.push(l);}
  if(!out.length)throw new Error('Producto no pertenece al pedido/carga');return out;
}
function setCounts(list,total,verified){
  if(list.some(l=>l.sustituciones?.length))throw new Error('Faltante con sustitución autorizada: no cambiar el producto solicitado');
  let remainder=total;
  for(const l of list){const qty=Math.min(l.cantidad,remainder);remainder-=qty;l.preparado=qty;l.escaneado=verified?qty:0;l.faltanteAutorizado=null;}
  if(remainder){list[0].preparado+=remainder;if(verified)list[0].escaneado+=remainder;}
}
export function loadProducts(load,pedidoId,clienteId){
  const map=new Map();for(const [id,p] of Object.entries(load.pedidos)){if(pedidoId&&id!==pedidoId||clienteId&&p.clienteId!==clienteId)continue;for(const l of p.lineas){const r=map.get(l.productoId)??{productoId:l.productoId,nombre:l.nombre,solicitado:0,preparado:0,verificado:0,faltante:0,sobrante:0};r.solicitado+=l.cantidad;r.preparado+=l.preparado;r.verificado+=l.escaneado;r.faltante+=Math.max(0,l.cantidad-l.preparado);r.sobrante+=Math.max(0,l.preparado-l.cantidad);map.set(l.productoId,r);}}
  return [...map.values()];
}
export function orderBalance(order){
  const totalCentavos=order.lineas.reduce((sum,l)=>{if(l.desglosePrecios?.some(p=>p.precioId)){let remaining=l.entregado??0,total=0;for(const p of l.desglosePrecios){const qty=Math.min(remaining,p.cantidad);total+=Math.round(qty*p.precioUnitario*100);remaining-=qty;}return sum+total;}return sum+Math.round((l.totalCentavos??Math.round(l.precioUnitario*l.cantidad*100))*(l.entregado??0)/l.cantidad);},0);
  const rendidoCentavos=order.rendicion?.centavos??0;return {totalCentavos,rendidoCentavos,saldoCentavos:totalCentavos-rendidoCentavos};
}
export function applyLoadCommand(state,command,actor,now=new Date().toISOString(),identity=command){
  if(actor?.empresaId!==state.empresaId||actor.rol!=='administrador'||!actor.userId)throw new Error('Sin permisos para Armado de Cargas');
  if(command?.empresaId!==state.empresaId)throw new Error('Comando de otra empresa');
  text(command.id,'Identificador');const content=JSON.stringify(canonical({tipo:identity.tipo,input:identity.input}));
  const seen=state.comandos.find(c=>c.id===command.id);if(seen){if(seen.content!==content)throw new Error('Identificador reutilizado con contenido diferente');return state;}
  if(command.version!==state.revision)throw new Error('Edición concurrente: actualizá la carga');
  if(!Number.isFinite(Date.parse(now)))throw new Error('Fecha inválida');
  const next=structuredClone(state),i=command.input??{};let load;
  if(i.cargaId){load=next.cargas[i.cargaId];if(!load)throw new Error('Carga no encontrada');}
  const editing=()=>{if(!load||!['planificada','picking'].includes(load.estado))throw new Error('La carga ya no admite cambios de preparación');};
  switch(command.tipo){
    case 'codigo':{
      const code=validateBarcode(i.codigo),productoId=text(i.productoId,'Producto');integer(i.unidadesBase,1);
      const old=next.codigos[code];if(old&&(old.productoId!==productoId||old.unidadesBase!==i.unidadesBase))throw new Error('Código ya asignado a otro producto/presentación');
      next.codigos[code]={productoId,unidadesBase:i.unidadesBase};break;
    }
    case 'aprobar':{
      if(i.pedido?.empresaId!==state.empresaId)throw new Error('Pedido de otra empresa');
      if(next.pedidos[i.pedido.pedidoId])throw new Error('Pedido ya aprobado');
      next.pedidos[i.pedido.pedidoId]={...approved(i.pedido),aprobadoPor:actor.userId,aprobadoEn:now};break;
    }
    case 'anular_pedido':{
      const p=next.pedidos[i.pedidoId];if(!p||p.cargaId||p.estado!=='aprobado')throw new Error('Solo pedidos aprobados sin carga pueden anularse');
      p.estado='anulado';p.anulacion={motivo:note(i.nota),responsable:actor.userId,fecha:now};break;
    }
    case 'crear':{
      const id=text(i.id,'Carga');if(next.cargas[id])throw new Error('Carga ya existente');
      if(!['individual','consolidada'].includes(i.modo))throw new Error('Modo de carga inválido');
      next.cargas[id]={id,modo:i.modo,camion:text(i.camion,'Camión/patente'),ruta:text(i.ruta,'Ruta'),chofer:text(i.chofer,'Chofer'),responsable:text(i.responsable,'Armador responsable'),estado:'planificada',pedidos:{},creadoPor:actor.userId,creadoEn:now};break;
    }
    case 'asignar':{
      editing();if(load.estado!=='planificada')throw new Error('La composición se cierra al iniciar picking');
      const p=next.pedidos[i.pedidoId];if(!p||p.estado!=='aprobado'||p.cargaId)throw new Error('Pedido no aprobado o ya asignado');
      if(p.rutaId&&p.rutaId!==load.ruta)throw new Error('Pedido de una ruta diferente');
      if(load.modo==='individual'&&Object.keys(load.pedidos).length)throw new Error('Una carga individual admite un pedido');
      load.pedidos[p.pedidoId]={...structuredClone(p),estado:'pendiente',lineas:p.lineas.map(l=>({...l,preparado:0,escaneado:0,faltanteAutorizado:null}))};p.cargaId=load.id;break;
    }
    case 'iniciar':editing();if(load.estado!=='planificada'||!Object.keys(load.pedidos).length)throw new Error('Carga vacía o picking iniciado');load.estado='picking';break;
    case 'contar':{
      if(load?.estado!=='picking')throw new Error('Iniciá picking');integer(i.cantidad);note(i.nota);
      setCounts(lines(load,i.pedidoId,i.productoId,i.clienteId),i.cantidad,false);break;
    }
    case 'escanear':{
      if(load?.estado!=='picking')throw new Error('Iniciá picking');const mapped=next.codigos[validateBarcode(i.codigo)];if(!mapped)throw new Error('Código no reconocido');
      if(i.productoId&&i.productoId!==mapped.productoId)throw new Error('Código de otro producto');
      const count=integer(i.cantidad,1)*mapped.unidadesBase;integer(count,1);const list=lines(load,i.pedidoId,mapped.productoId,i.clienteId);
      if(i.modo==='verificar'){
        if(count>list.reduce((s,l)=>s+l.preparado-l.escaneado,0))throw new Error('Escaneo excede lo preparado');
        let n=count;for(const l of list){const qty=Math.min(n,l.preparado-l.escaneado);l.escaneado+=qty;n-=qty;}
      }else if(i.modo==='picking'){
        if(list.some(l=>l.sustituciones?.length))throw new Error('Prepará el sustituto autorizado; la cantidad original se conserva');
        let n=count;for(const l of list){const qty=Math.min(n,Math.max(0,l.cantidad-l.preparado));l.preparado+=qty;l.escaneado+=qty;l.faltanteAutorizado=null;n-=qty;}
        if(n){list[0].preparado+=n;list[0].escaneado+=n;list[0].faltanteAutorizado=null;}
      }else throw new Error('Elegí picking o verificación');for(const l of list){integer(l.preparado);integer(l.escaneado);}break;
    }
    case 'autorizar_faltante':{
      if(i.destino!==undefined&&!['pendiente','cancelado'].includes(i.destino))throw new Error('Destino del faltante inválido');if(load?.estado!=='picking'||!i.pedidoId)throw new Error('Elegí el pedido para autorizar faltantes');
      for(const l of lines(load,i.pedidoId,i.productoId)){if(l.preparado>=l.cantidad)throw new Error('No hay faltante');l.faltanteAutorizado={cantidad:l.cantidad-l.preparado,motivo:note(i.nota),responsable:actor.userId,fecha:now,tipo:i.destino??'pendiente'};}break;
    }
    case 'sustituir':{
      if(load?.estado!=='picking')throw new Error('Sustitución disponible durante preparación');
      const p=load.pedidos[i.pedidoId],original=p?.lineas.find(l=>l.productoId===i.productoId);
      if(!original||original.sustitucionDe||original.sustituciones?.length)throw new Error('Renglón no sustituible o autorización ya registrada');
      const faltante=integer(i.faltante,1),cantidad=integer(i.cantidad,1);
      if(faltante!==original.cantidad-original.preparado)throw new Error('La sustitución debe corresponder al faltante actual');
      text(i.sustitutoId,'Sustituto');if(i.sustitutoId===i.productoId||p.lineas.some(l=>l.productoId===i.sustitutoId))throw new Error('Elegí un sustituto distinto que no esté en el pedido');
      if(!Number.isFinite(i.precioUnitario)||i.precioUnitario<0)throw new Error('Precio de sustituto inválido');
      const motivo=note(i.nota),trace={id:command.id,productoSolicitado:i.productoId,faltante,sustituto:i.sustitutoId,cantidad,autorizadoPor:actor.userId,fecha:now,motivo};
      original.faltanteAutorizado={cantidad:faltante,motivo,responsable:actor.userId,fecha:now,tipo:'sustitucion'};original.sustituciones=[trace];
      const cents=Math.round(cantidad*i.precioUnitario*100);if(!Number.isSafeInteger(cents))throw new Error('Importe de sustituto inválido');
      p.lineas.push({productoId:i.sustitutoId,nombre:text(i.nombre,'Producto sustituto'),cantidad,precioUnitario:i.precioUnitario,totalCentavos:cents,desglosePrecios:[{cantidad,precioUnitario:i.precioUnitario,centavos:cents,...(i.precioId?{precioId:i.precioId}:{})}],preparado:0,escaneado:0,faltanteAutorizado:null,sustitucionDe:trace});break;
    }
    case 'cargar':{
      if(load?.estado!=='verificada')throw new Error('Verificá la preparación antes de cargar');
      load.estado='cargada';load.cargaConfirmada={fecha:now,responsable:actor.userId,comprobante:note(i.nota)};break;
    }
    case 'verificar':{
      if(load?.estado!=='picking')throw new Error('Carga fuera de picking');
      for(const p of Object.values(load.pedidos))for(const l of p.lineas){if(l.preparado>l.cantidad||l.escaneado!==l.preparado)throw new Error('Sobrantes o códigos pendientes de verificar');if(l.preparado<l.cantidad&&l.faltanteAutorizado?.cantidad!==l.cantidad-l.preparado)throw new Error('Faltante sin autorización');}
      if(Object.values(load.pedidos).every(p=>p.lineas.every(l=>l.preparado===0)))throw new Error('No hay mercadería preparada');
      load.estado='verificada';load.verificadoPor=actor.userId;load.verificadoEn=now;break;
    }
    case 'salir':{
      if(!['verificada','cargada'].includes(load?.estado))throw new Error('Verificá la carga antes de salir');
      if(Object.values(next.cargas).some(c=>c.id!==load.id&&c.estado==='en_reparto'&&(c.camion===load.camion||c.chofer===load.chofer)))throw new Error('Camión o chofer con reparto activo');
      load.estado='en_reparto';load.salida={fecha:now,responsable:actor.userId,comprobante:note(i.nota)};break;
    }
    case 'entregar':{
      const p=load?.pedidos[i.pedidoId];if(load?.estado!=='en_reparto'||!p||p.estado!=='pendiente')throw new Error('Entrega no disponible o duplicada');
      if(!Array.isArray(i.lineas)||i.lineas.length!==p.lineas.length||new Set(i.lineas.map(l=>l.productoId)).size!==p.lineas.length)throw new Error('Detalle incompleto/duplicado');
      for(const l of p.lineas){const d=i.lineas.find(d=>d.productoId===l.productoId);if(!d)throw new Error('Producto incorrecto');integer(d.entregado);integer(d.devuelto);if(d.entregado+d.devuelto!==l.preparado)throw new Error('Entrega y devolución no concilian con lo cargado');l.entregado=d.entregado;l.devuelto=d.devuelto;}
      const delivered=p.lineas.reduce((s,l)=>s+l.entregado,0),returned=p.lineas.reduce((s,l)=>s+l.devuelto,0);
      load.recepcionDevoluciones=null;p.estado=delivered===0?'rechazado':returned||p.lineas.some(l=>l.preparado<l.cantidad)?'parcial':'entregado';p.entrega={fecha:now,responsable:actor.userId,comprobante:note(i.nota)};break;
    }
    case 'devolver':{
      const p=load?.pedidos[i.pedidoId];if(load?.estado!=='en_reparto'||!p||p.estado==='pendiente')throw new Error('Devolución no disponible');
      const l=p.lineas.find(l=>l.productoId===i.productoId);integer(i.cantidad,1);if(!l||i.cantidad>l.entregado)throw new Error('Devolución excede entrega');
      l.entregado-=i.cantidad;l.devuelto+=i.cantidad;load.recepcionDevoluciones=null;p.estado=p.lineas.every(l=>l.entregado===0)?'rechazado':'parcial';if(p.rendicion){p.rendicion.estado='presentada';p.rendicion.necesitaRevision=true;}note(i.nota);break;
    }
    case 'rendir':{
      const p=load?.pedidos[i.pedidoId];if(load?.estado!=='en_reparto'||!p||p.estado==='pendiente'||p.rendicion)throw new Error('Rendición no disponible o duplicada');
      if(!Number.isSafeInteger(i.centavos)||i.centavos<0||i.centavos>orderBalance(p).totalCentavos)throw new Error('Rendición superior a entrega/importe inválido');
      p.rendicion={centavos:i.centavos,estado:'presentada',responsable:actor.userId,fecha:now,comprobante:note(i.nota)};break;
    }
    case 'revisar_rendicion':{
      const p=load?.pedidos[i.pedidoId];if(load?.estado!=='en_reparto'||p?.rendicion?.estado!=='presentada')throw new Error('Rendición no presentada');p.rendicion.estado='revisada';p.rendicion.notaRevision=note(i.nota);p.rendicion.revisadoPor=actor.userId;p.rendicion.revisadoEn=now;break;
    }
    case 'recibir_devoluciones':{
      if(load?.estado!=='en_reparto'||Object.values(load.pedidos).some(p=>p.estado==='pendiente')||load.recepcionDevoluciones)throw new Error('Recepción no disponible o duplicada');
      if(!Array.isArray(i.lineas)||!i.lineas.length||new Set(i.lineas.map(l=>l.productoId)).size!==i.lineas.length)throw new Error('Detalle de devolución inválido');
      const expected=new Map();for(const p of Object.values(load.pedidos))for(const l of p.lineas)if(l.devuelto)expected.set(l.productoId,(expected.get(l.productoId)??0)+l.devuelto);
      if(i.lineas.length!==expected.size||i.lineas.some(l=>!expected.has(l.productoId)||integer(l.cantidad)!==expected.get(l.productoId)))throw new Error('La recepción física no concilia con lo devuelto');
      const classified=i.lineas.map(l=>{
        const vendible=integer(l.vendible??0),averiada=integer(l.averiada??0),revision=integer(l.revision??l.cantidad-vendible-averiada);
        if(vendible+averiada+revision!==l.cantidad)throw new Error('Clasificá toda la devolución: vendible, averiada o revisión');
        return {...structuredClone(l),vendible,averiada,revision};
      });
      load.recepcionDevoluciones={lineas:classified,nota:note(i.nota),responsable:actor.userId,fecha:now};break;
    }
    case 'cerrar':if(load?.requiereRecepcion&&Object.values(load.pedidos).some(p=>p.lineas.some(l=>l.devuelto>0))&&!load.recepcionDevoluciones)throw new Error('Falta confirmar recepción física de las devoluciones');
if(load?.estado!=='en_reparto'||Object.values(load.pedidos).some(p=>p.estado==='pendiente'||p.rendicion?.estado!=='revisada'))throw new Error('Entregas/rendiciones pendientes');load.estado='cerrada';load.cierre={fecha:now,responsable:actor.userId};break;
    case 'cancelar':editing();note(i.nota);for(const id of Object.keys(load.pedidos))delete next.pedidos[id].cargaId;load.estado='cancelada';break;
    default:throw new Error('Operación de cargas inválida');
  }
  next.revision++;next.comandos.push({id:command.id,content,revision:next.revision});next.historial.push({id:command.id,tipo:command.tipo,input:structuredClone(i),responsable:actor.userId,fecha:now,revision:next.revision});return next;
}

/** Estado visible derivado de evidencia operativa; el acuse original nunca cambia. */
export function orderState({order,approved,load,commercial}={}){
 if(commercial?.estado==='requiere_autorizacion')return 'requiere_autorizacion';
 if(approved?.estado==='anulado'||load?.estado==='cancelada')return 'anulado';
 const p=load?.pedidos?.[order?.pedidoId];
 if(load?.estado==='cerrada')return 'cerrado';
 if(p?.entrega){if(p.lineas.every(l=>(l.entregado??0)===0)&&load.historial?.some(h=>h.tipo==='devolver'&&h.input.pedidoId===p.pedidoId))return 'devuelto';return {rechazado:'no_entregado',parcial:'parcial',entregado:'entregado'}[p.estado]??p.estado;}
 if(load?.estado==='en_reparto')return 'despachado';
 if(load?.estado==='cargada')return 'en_carga';
 if(load?.estado==='verificada')return p?.lineas.some(l=>l.preparado<l.cantidad&&!l.sustituciones?.length)?'con_faltantes':'preparado';
 if(load?.estado==='picking')return p?.lineas.some(l=>l.faltanteAutorizado)?'con_faltantes':'en_preparacion';
 return approved?'aprobado':order?.estado??'pendiente';
}
