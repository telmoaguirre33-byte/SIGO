import { useEffect, useRef, useState } from 'react';
import { listarProductosSigo, type ProductoSigo } from './productos';
import { avisoArchivo, configurarArchivoProducto } from './archivoProductos';
import { formatoStockMedida } from './ventaPorMedidas';

export default function ProductosArchivados({empresaId,puedeEditar,onUpdated,onBusy}:{empresaId:string;puedeEditar:boolean;onUpdated:()=>void;onBusy?:(busy:boolean)=>void}) {
 const [productos,setProductos]=useState<ProductoSigo[]>([]);
 const [error,setError]=useState(''); const [estado,setEstado]=useState('');
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState<string|null>(null);
 const pendiente=useRef(false); const empresaRef=useRef(empresaId); empresaRef.current=empresaId;
 useEffect(()=>{let vivo=true;setLoading(true);setError('');setEstado('');setProductos([]);
  void listarProductosSigo(empresaId,{inventario:true}).then(p=>{if(vivo)setProductos(p.filter(x=>x.archivado_comercial));}).catch(()=>{if(vivo)setError('No se pudo consultar el archivo comercial. Esta base debe tener habilitado el circuito seguro.');}).finally(()=>{if(vivo)setLoading(false);});
  return()=>{vivo=false;};
 },[empresaId]);
 async function reactivar(producto:ProductoSigo){
  if(!puedeEditar || pendiente.current)return;
  setError('');setEstado('');if(!window.confirm(avisoArchivo(producto.nombre,false)))return;
  pendiente.current=true;setBusy(producto.id);onBusy?.(true);const empresa=empresaId;
  try {await configurarArchivoProducto(empresa,producto.id,false);
   if(empresaRef.current!==empresa)return;
   setProductos(p=>p.filter(x=>x.id!==producto.id));setEstado(`${producto.nombre}: reactivación verificada. No se cambiaron existencias ni históricos.`);onUpdated();
  }catch(e){if(empresaRef.current===empresa)setError(e instanceof Error?e.message:'No se pudo reactivar.');}
  finally{pendiente.current=false;onBusy?.(false);if(empresaRef.current===empresa)setBusy(null);}
 }
 return <section className="panel" aria-label="Productos archivados">
  <h3>Archivados: fuera de nuevas ventas y compras</h3>
  <p>Conservan su identidad, stock físico e historial. Las devoluciones y anulaciones históricas mantienen sus permisos y controles.</p>
  {error && <p role="alert">{error}</p>}{estado && <p role="status">{estado}</p>}
  {loading?<p>Cargando archivados…</p>:<ul>{productos.map(p=><li key={p.id}><strong>{p.nombre}</strong> · {p.codigo_interno || p.codigo_barras || 'Sin código'} · Stock: {p.stock_actual==null?'Restringido':formatoStockMedida(Number(p.stock_actual),p.unidad_medida)} {puedeEditar && <button className="admin-button" disabled={busy!==null} onClick={()=>void reactivar(p)}>{busy===p.id?'Reactivando…':'Reactivar'}</button>}</li>)}</ul>}
  {!loading&&!error&&!productos.length&&<p>No hay productos archivados.</p>}
 </section>;
}
