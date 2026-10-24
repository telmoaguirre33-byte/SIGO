import { supabase } from './supabase';
import type { ProductoSigo } from './productos';

export function avisoArchivo(nombre: string, archivar: boolean): string {
  return archivar
    ? `¿Dar de baja comercial a ${nombre}? Se quitará de nuevas ventas y compras. Su stock, unidad, códigos e historial se conservan y seguirán visibles en Stock y Archivados. Podrás reactivarlo.`
    : `¿Reactivar ${nombre} para nuevas ventas y compras? Se conservarán su stock y su historial.`;
}
export async function configurarArchivoProducto(empresaId: string, productoId: string, archivado: boolean): Promise<void> {
  if (!empresaId || !productoId) throw new Error('Seleccioná una empresa y un producto.');
  let respuesta;
  try { respuesta = await supabase.rpc('configurar_archivo_producto_sigo', {p_empresa_id:empresaId,p_producto_id:productoId,p_archivado:archivado}); }
  catch { throw new Error('No se pudo confirmar el resultado. Actualizá el catálogo antes de repetir la operación.'); }
  if (respuesta.error) {
    const raw = String(respuesta.error.message ?? '');
    if (/Could not find|does not exist|PGRST202/.test(raw)) throw new Error('La baja comercial todavía no está habilitada en esta base. No se modificó el producto.');
    if (/FORBIDDEN|AUTH_REQUIRED/.test(raw)) throw new Error('Tu sesión no tiene permiso para cambiar el estado comercial.');
    if (/PRODUCT_LEGACY_INACTIVE_REVIEW/.test(raw)) throw new Error('Este producto tiene una baja anterior y requiere revisión. No se reactivó automáticamente.');
    throw new Error(raw || 'No se pudo cambiar el estado comercial.');
  }
  const coincide = (p: {id?:unknown;empresa_id?:unknown;activo?:unknown;archivado_comercial?:unknown} | null) => p?.id===productoId && p.empresa_id===empresaId && p.activo===true && p.archivado_comercial===archivado;
  if (!coincide(respuesta.data)) throw new Error('El servidor no confirmó el estado solicitado. Actualizá antes de repetir.');
  try {
    const {data,error}=await supabase.rpc('estado_comercial_producto_sigo',{p_empresa_id:empresaId,p_producto_id:productoId});
    if(error || !coincide(data)) throw new Error('Estado no verificado');
  } catch { throw new Error('La operación respondió, pero no se pudo verificar su estado actual. Actualizá antes de repetir.'); }
  notificarCambioCatalogo(empresaId);
}
export function notificarCambioCatalogo(empresaId:string) {
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent('sigo:catalogo-cambio',{detail:{empresaId}}));
  try {window.localStorage.setItem('sigo:catalogo-cambio',JSON.stringify({empresaId,at:Date.now()}));} catch {/* El servidor sigue bloqueando carritos obsoletos. */}
}
export async function buscarProductoInventario(empresaId:string,codigo:string):Promise<ProductoSigo[]> {
  const {data,error}=await supabase.rpc('buscar_producto_inventario_sigo',{p_empresa_id:empresaId,p_codigo:codigo});
  if(error)throw new Error('No se pudo consultar el inventario. Actualizá antes de continuar.');
  return (data??[]) as ProductoSigo[];
}

export function observarCambiosCatalogo(empresaId:string, actualizar:()=>void):()=>void {
  const local=(event:Event)=>{if((event as CustomEvent).detail?.empresaId===empresaId)actualizar();};
  const storage=(event:StorageEvent)=>{if(event.key!=='sigo:catalogo-cambio'||!event.newValue)return;try{if(JSON.parse(event.newValue).empresaId===empresaId)actualizar();}catch{/* Ignorar datos no válidos, nunca interpretar código. */}};
  const focus=()=>actualizar();
  window.addEventListener('sigo:catalogo-cambio',local);window.addEventListener('storage',storage);window.addEventListener('focus',focus);
  return()=>{window.removeEventListener('sigo:catalogo-cambio',local);window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);};
}
