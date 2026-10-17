/** Modelo puro compartido por UI y API; nunca contiene credenciales. */
export const SETUP_STEPS=Object.freeze(['empresa','deposito','productos','stock','clientes','vendedores','zonas','rutas','vehiculos','listas','condiciones','objetivos','usuarios','fiscal','revision']);
export const IMPORT_KINDS=Object.freeze(['clientes','productos','stock','precios']);
export const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function launchConfig(input){
 if(!input||!['minorista','mayorista','mixto'].includes(input.tipoNegocio)||typeof input.nombre!=='string'||!input.nombre.trim()||input.nombre.length>160)throw Error('Completá tipo de negocio y nombre de empresa.');
 const text=k=>String(input[k]??'').trim().slice(0,160);
 const fiscal=input.fiscal??'simulacion';if(!['simulacion','homologacion'].includes(fiscal))throw Error('ARCA productiva no está habilitada.');
 return {tipoNegocio:input.tipoNegocio,nombre:text('nombre'),documento:text('documento'),direccion:text('direccion'),deposito:text('deposito'),condicionPago:'efectivo',fiscal,stockRevisado:input.stockRevisado===true,zonasRevisadas:input.zonasRevisadas===true,condicionesRevisadas:input.condicionesRevisadas===true};
}
const aliases={codigo:['codigo','codigo interno','sku','codigo cliente'],nombre:['nombre','producto','cliente','razon social'],documento:['documento','cuit','dni'],direccion:['direccion','domicilio'],telefono:['telefono','tel'],email:['email','correo'],ean:['ean','codigo de barras','codigo barras'],marca:['marca'],precio:['precio','precio venta','precio de venta'],cantidad:['cantidad','stock','stock inicial'],lista:['lista','lista de precios'],presentacion:['presentacion'],unidadesBase:['unidades','unidades por caja','unidades base'],ajuste:['ajuste','ajuste porcentaje']};
export function normalizeImport(kind,matrix){
 if(!IMPORT_KINDS.includes(kind)||!Array.isArray(matrix)||matrix.length<2||matrix.length>10001)throw Error('Usá entre 1 y 10.000 filas.');
 const headers=matrix[0].map(fold),columns=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(h=>[fold(key),...names].includes(h))]));
 const seen=new Set();
 return matrix.slice(1).map((cells,index)=>{
  const row=Object.fromEntries(Object.keys(aliases).map(k=>[k,String(cells[columns[k]]??'').trim()]));
  const errors=[];for(const [k,v] of Object.entries(row))if(v.length>500)errors.push(`${k}: máximo 500 caracteres`);
  const identity=fold(kind==='clientes'?row.documento||row.codigo:row.codigo||row.ean);
  if(!identity)errors.push(kind==='clientes'?'Falta documento o código de cliente':'Falta código interno o EAN');
  if(seen.has(identity))errors.push('Identificador repetido en el archivo');else seen.add(identity);
  if(['clientes','productos'].includes(kind)&&!row.nombre)errors.push('Falta nombre');
  const number=(key,required)=>{const value=row[key];if(!value&&!required){delete row[key];return;}const n=Number(value.replace(/\s/g,'').replace(',','.'));if(!value||!Number.isFinite(n)||n<0||n>1e9)errors.push(`${key}: número inválido (sin separador de miles)`);else row[key]=n;};
  if(kind==='productos')number('precio',true);
  if(kind==='stock'){number('cantidad',true);if(!Number.isSafeInteger(row.cantidad)||row.cantidad>1000000)errors.push('Stock: unidades enteras, máximo 1.000.000');}
  if(kind==='precios'){number('ajuste',true);number('unidadesBase',true);if(!row.lista||!row.presentacion||!Number.isSafeInteger(row.unidadesBase)||row.unidadesBase<1||row.ajuste<0||row.ajuste>500)errors.push('Revisá lista, presentación, unidades y ajuste (0–500 %)');}
  if(kind==='productos'&&!(row.precio>0))errors.push('Precio mayor a cero requerido');
  if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))errors.push('Email inválido');
  return {fila:index+2,identity,row,errors};
 });
}
export function subscriptionAccess(input,now=Date.now()){
 const states=['prueba','activo','vencido','pago_pendiente','suspendido','reactivado'];
 if(!input||!states.includes(input.estado))throw Error('Estado comercial inválido');
 const end=Date.parse(input.hasta);if(!Number.isFinite(end))throw Error('Fecha de suscripción inválida');
 const estado=['prueba','activo','reactivado'].includes(input.estado)&&end<=now?'vencido':input.estado;
 return {estado,hasta:new Date(end).toISOString(),permiteOperar:['prueba','activo','reactivado'].includes(estado),conservaDatos:true,cobrosReales:false};
}
