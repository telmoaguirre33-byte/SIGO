import { reportesClient } from './reportesClient';
import type { ProductoSigo } from './productos';
import type { ClienteSigo } from './clientes';

export async function listarProductosInforme(empresaId:string):Promise<ProductoSigo[]>{
 const rows:ProductoSigo[]=[];
 for(let offset=0;;offset+=1000){
  const {data,error}=await reportesClient.rpc('listar_productos_sigo',{p_empresa_id:empresaId})
   .select('id,empresa_id,nombre,codigo_interno,codigo_barras,descripcion,marca,categoria,proveedor,costo_actual,costo_ultima_compra,precio_venta,margen_ganancia,margen_porcentaje,stock_actual,stock_minimo,stock_maximo')
   .order('id',{ascending:true}).range(offset,offset+999);
  if(error)throw error;rows.push(...(data??[]));if((data??[]).length<1000)return rows;
 }
}
export async function listarClientesInforme(empresaId:string):Promise<ClienteSigo[]>{
 const rows:ClienteSigo[]=[];
 for(let offset=0;;offset+=1000){
  const {data,error}=await reportesClient.from('clientes_sigo')
   .select('id,empresa_id,nombre,documento,telefono,email,direccion,limite_credito,saldo_actual,activo,created_at,updated_at')
   .eq('empresa_id',empresaId).eq('activo',true).order('id',{ascending:true}).range(offset,offset+999);
  if(error)throw error;rows.push(...(data??[]));if((data??[]).length<1000)return rows;
 }
}
