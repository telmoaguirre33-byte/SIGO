export const QA_ORIGIN='https://mayorista-api-qa-qa.up.railway.app';
export const QA_COMPANY='30000000-0000-4000-8000-000000000001';
export const isQaAccess=()=>globalThis.location?.origin===QA_ORIGIN;
export function qaAccessFields(seller=false){
 const accounts=seller?Array.from({length:8},(_,i)=>['vendedor'+(i+1),'Vendedor '+(i+1)]):[['gerencia','Gerencia'],['administracion','Administración'],['armador','Depósito'],...Array.from({length:3},(_,i)=>['chofer'+(i+1),'Chofer '+(i+1)])];
 return `<p>Distribuidora ficticia QA · datos de prueba</p><input type="hidden" name="empresaId" value="${QA_COMPANY}"><label>Acceso de prueba<select name="email">${accounts.map(([a,n])=>`<option value="${a}@distribuidora.qa.invalid">${n}</option>`).join('')}</select></label><p>Usá la contraseña QA recibida por el canal privado de tu responsable. Nunca se incluye en enlaces ni mensajes de prueba.</p>`;
}
// Prepara un solo borrador por almacén/dispositivo. No envía pedidos ni registra ventas.
export async function prepareQaOrder(workspace,catalog){
 let marker=await workspace.read('qa-test','current');
 if(!marker){
  const age=Date.now()-Date.parse(catalog?.descargadoEn);if(!Number.isFinite(age)||age>24*3600000)throw Error('Actualizá el catálogo antes de preparar la prueba');
  const current=await workspace.read('drafts','current');if(current?.data.lineas?.length)throw Error('Guardá el borrador actual antes de preparar la prueba');
  const product=catalog.productos.find(p=>p.codigoInterno==='QA-P-00001');
  const customer=[...catalog.clientes].filter(c=>Number(c.limiteCredito)>=100000).sort((a,b)=>a.id.localeCompare(b.id))[0];
  const price=catalog.precios.find(p=>p.productoId===product?.id&&p.listaId===customer?.listaId&&p.unidadesBase===1);
  if(!product||!customer||!price)throw Error('No se encontró un cliente y precio QA habilitados');
  const id=crypto.randomUUID(),label='PRUEBA P0 '+id.slice(0,8).toUpperCase();
  const draft={id,clienteId:customer.id,lineas:[{productoId:product.id,precioId:price.id,cantidad:1,precioUnitario:Number(price.precio),presentacion:price.presentacion,unidadesBase:1,observacion:label}],comerciales:{condicionPago:'cuenta_corriente',observacion:label}};
  marker=await workspace.write('qa-test','current',{label,draft});
 }
 const {draft,label}=marker.data,order=await workspace.read('orders',draft.id);
 if(order)return {label,order:order.data};
 const current=await workspace.read('drafts','current');
 if(current?.data.lineas?.length&&current.data.id!==draft.id)throw Error('Hay otro borrador: guardalo antes de recuperar la prueba');
 if(current?.data.id!==draft.id||!current.data.lineas.length)await workspace.write('drafts','current',draft,current?.revision??0);
 return {label,draft};
}
