import {normalizeSearch} from './product-search.mjs';
export const paymentName=v=>({efectivo:'Contado',transferencia:'Transferencia',cuenta_corriente:'Cuenta corriente'})[v]??'Condición anterior sin indicar';
export const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(v)||0);
export const orderTotal=p=>(p?.lineas??[]).reduce((s,l)=>s+l.cantidad*l.precioUnitario,0);
export const friendlyOrder=p=>'Pedido '+String(p.id).replaceAll('-','').slice(0,8).toUpperCase();
export function searchCustomers(customers,query,limit=20){
 const tokens=normalizeSearch(query).split(/\s+/).filter(Boolean),out=[];
 for(const c of customers??[]){const text=normalizeSearch([c.nombre,c.nombreComercial,c.razonSocial,c.codigo,c.codigoCliente,c.direccion,c.zona,c.ruta,c.cuit,c.telefono].filter(Boolean).join(' '));if(tokens.every(t=>text.includes(t))){out.push(c);if(out.length>=limit)break;}}
 return out;
}
export function lineQuantity(line,count){
 const units=line.unidadesBase??1,n=Number(count);
 if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(units)||units<1||!Number.isSafeInteger(n*units))throw Error('Ingresá una cantidad entera mayor que cero');
 return {...line,cantidad:n*units};
}
export function orderGroup(p){
 if(p.estado==='cancelado')return 'cancelados';
 if(p.estado==='sincronizado')return ['aprobado','confirmado','en_preparacion','preparado','despachado','entregado','facturado'].includes(p.estadoRemoto)?'confirmados':'enviados';
 if(p.estado==='borrador')return 'borradores';return 'pendientes';
}
