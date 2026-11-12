// Keep existing recovery fixtures at their original service boundary. The new
// pagination tests exercise the actual productos.ts through a synthetic transport.
export const catalogo121MockAdapter = `
export async function buscarProductosSigo(e,q='',pagina=0,signal) {
  const normalizar=s=>String(s??'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
  const filas=(await listarProductosSigo(e)).filter(p=>normalizar([p.nombre,p.marca,p.codigo_interno,p.codigo_barras].join(' ')).includes(normalizar(q)));
  return {productos:filas.slice(pagina*50,pagina*50+50),hayMas:filas.length>pagina*50+50};
}
export async function leerProductosPorIdsSigo(e,ids,signal) {
  return (await listarProductosSigo(e,signal)).filter(p=>ids.includes(p.id));
}
`;
