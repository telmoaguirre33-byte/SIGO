/** Un solo mapa de páginas para SIGO y el portal operativo. */
export const mayoristaPages=Object.freeze([
 ['panel','Panel Mayorista'],['vendedores','Vendedores'],['objetivos','Objetivos y métricas'],['pedidos','Pedidos'],['administracion','Administración Mayorista'],['deposito','Depósito'],['cargas','Armado de cargas'],['reparto','Reparto'],['entregas','Entregas'],['rendiciones','Cobranzas / Rendiciones']
].map(([id,label])=>Object.freeze({id,label})));
export const pageLabel=id=>mayoristaPages.find(p=>p.id===id)?.label??({'puesta-marcha':'Puesta en marcha',importaciones:'Importar Excel / CSV',padron:'Clientes',clientes:'Rutas y asignaciones',catalogo:'Precios y ofertas',cuentas:'Cuenta corriente',personal:'Usuarios y roles',informes:'Informes'})[id]??id;
export function allowedPages(role){
 if(['gerencia','administracion','administrador'].includes(role))return [...mayoristaPages.map(p=>p.id),'clientes','catalogo','cuentas','personal','informes','puesta-marcha','importaciones','padron'];
 if(role==='armador')return ['deposito','cargas'];
 if(role==='chofer')return ['reparto','entregas','rendiciones'];
 return [];
}
export const sharedFunctions=Object.freeze(['Caja','Ventas','Compras','Stock','Productos','Lista de precios','Compra sugerida','Ofertas y carteles','Devoluciones','ARCA / Facturación','Informes','Cuenta corriente','Clientes','Usuarios','Configuración']);


