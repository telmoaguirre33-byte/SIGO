export function largeSellerCatalog(count = 5000) {
  const productos = Array.from({length:count}, (_, i) => ({id:`p${i}`,nombre:i === 0 ? 'Aceite de girasol 900 ml' : i === 1 ? 'Azúcar rubia 1 kg' : `Artículo de almacén ${i}`,descripcion:`Mercadería variedad ${i}`,marca:i === 0 ? 'Sol del Sur' : `Marca ${i % 20}`,codigo:`INT-${String(i).padStart(5,'0')}`,ean:String(7790000000000 + i),activo:true}));
  return {descargadoEn:new Date().toISOString(),clientes:[{id:'c1',nombre:'Almacén Uno',listaId:'l1'},{id:'c2',nombre:'Almacén Dos',listaId:'l2'}],productos,
    precios:productos.flatMap(p => [{id:p.id+'-u',productoId:p.id,listaId:'l1',presentacion:'Unidad',unidadesBase:1,precio:100,moneda:'ARS'},{id:p.id+'-p',productoId:p.id,listaId:'l1',presentacion:'Pack 6',unidadesBase:6,precio:540,moneda:'ARS'},{id:p.id+'-b',productoId:p.id,listaId:'l2',presentacion:'Unidad',unidadesBase:1,precio:120,moneda:'ARS'}])};
}
