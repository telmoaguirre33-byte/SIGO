export const identities = [
  {empresaId: 'demo-distribuidora-sur', vendedorId: 'demo-lucia', empresa: 'Distribuidora Sur', vendedor: 'Lucía Fernández', zona: 'Centro · Sur'},
  {empresaId: 'demo-distribuidora-sur', vendedorId: 'demo-martin', empresa: 'Distribuidora Sur', vendedor: 'Martín Pérez', zona: 'Oeste'},
  {empresaId: 'demo-distribuidora-norte', vendedorId: 'demo-ana', empresa: 'Distribuidora Norte', vendedor: 'Ana Torres', zona: 'Norte'}
];
export function sampleCatalog(scope) {
  const now = new Date().toISOString();
  return {
    empresaId: scope.empresaId, vendedorId: scope.vendedorId, version: 'demo-20261012-v2', descargadoEn: now,
    clientes: [
      {id:'c1', nombre:'Almacén Don Pedro', direccion:'Av. San Martín 1240', rutaId:'r1', latitud:-34.6037, longitud:-58.3816, habilitado:true, actualizadoEn:now},
      {id:'c2', nombre:'Autoservicio La Esquina', direccion:'Belgrano 842', rutaId:'r1', latitud:-34.6101, longitud:-58.3862, habilitado:true, actualizadoEn:now},
      {id:'c3', nombre:'Despensa Los Amigos', direccion:'Moreno 2150', rutaId:'r2', latitud:-34.6173, longitud:-58.3991, habilitado:true, actualizadoEn:now},
      {id:'c4', nombre:'Mercadito El Sol', direccion:'Rivadavia 1920', rutaId:'r2', latitud:-34.6094, longitud:-58.3951, habilitado:true, actualizadoEn:now}
    ],
    rutas:[{id:'r1',nombre:'Centro',dia:'Lunes / Miércoles'},{id:'r2',nombre:'Sur',dia:'Martes / Jueves'}],
    productos:[
      {id:'p1',codigo:'AL-001',nombre:'Aceite de girasol 900 ml',unidadBase:'botella',activo:true,actualizadoEn:now},
      {id:'p2',codigo:'AL-002',nombre:'Arroz largo fino 1 kg',unidadBase:'paquete',activo:true,actualizadoEn:now},
      {id:'p3',codigo:'BE-001',nombre:'Agua mineral 1.5 l',unidadBase:'botella',activo:true,actualizadoEn:now},
      {id:'p4',codigo:'LI-001',nombre:'Detergente limón 750 ml',unidadBase:'botella',activo:true,actualizadoEn:now}
    ],
    precios: ['p1','p2','p3','p4'].flatMap((productoId,i) => [
      {presentacion:'Unidad',unidadesBase:1,factor:1}, {presentacion:'Pack',unidadesBase:6,factor:.97},
      {presentacion:'Caja',unidadesBase:12,factor:.94}, {presentacion:'Bulto',unidadesBase:24,factor:.90}
    ].map((p,j) => ({id:productoId+'-'+j,productoId,listaId:'lista-demo',presentacion:p.presentacion,unidadesBase:p.unidadesBase,precio:Math.round([2200,1600,950,1800][i]*p.unidadesBase*p.factor),moneda:'ARS',actualizadoEn:now}))),
    ofertas:[{id:'promo1',productoId:'p2',titulo:'Arroz: mejor precio por bulto',detalle:'24 unidades · 10% menos que por unidad',vence:'2026-12-31'}],
    objetivos:{importe:300000,visitas:12,pedidos:8}
  };
}
