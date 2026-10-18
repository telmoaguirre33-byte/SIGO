const TABLES = new Set(['ventas_sigo','compras_sigo','caja_movimientos_sigo','venta_items_sigo','clientes_sigo','productos']);
const OPS = new Set(['eq','gte','lte','lt','in']);
function json(res,status,body){res.setHeader('Cache-Control','no-store');return res.status(status).setHeader('Content-Type','application/json; charset=utf-8').send(JSON.stringify(body));}
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
 const {empresaId,table,rpc,select,filters=[],orders=[],range=[0,999]}=req.body||{};
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empresaId||'') ||
   (rpc ? rpc!=='listar_productos_sigo' : !TABLES.has(table)) ||
   typeof select!=='string' || !/^[a-z_(),]+$/.test(select) ||
   !Array.isArray(filters)||filters.length>12||!Array.isArray(orders)||orders.length>3||
   !Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<0||range[1]<range[0]||range[1]-range[0]>=1000)
   return json(res,400,{error:'REPORT_QUERY_INVALID'});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
 const key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 const auth=String(req.headers.authorization||'');
 if(!url||!key||!auth.startsWith('Bearer '))return json(res,403,{error:'REPORTS_READ_FORBIDDEN'});
 const headers={apikey:key,Authorization:auth,'Content-Type':'application/json'};
 try {
  const user=await fetch(`${url}/auth/v1/user`,{headers});
  if(!user.ok)return json(res,403,{error:'REPORTS_READ_FORBIDDEN'});
  const permission=await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`,{method:'POST',headers,body:JSON.stringify({p_empresa_id:empresaId,p_permiso:'reports.read'})});
  if(!permission.ok||(await permission.json())!==true)return json(res,403,{error:'REPORTS_READ_FORBIDDEN'});
  const query=new URLSearchParams({select,offset:String(range[0]),limit:String(range[1]-range[0]+1)});
  if(!rpc)query.set('empresa_id',`eq.${empresaId}`);
  for(const filter of filters){
   if(!Array.isArray(filter)||filter.length!==3)return json(res,400,{error:'REPORT_QUERY_INVALID'});
   const [column,operator,value]=filter;
   if(!/^[a-z_]+$/.test(column)||!OPS.has(operator))return json(res,400,{error:'REPORT_QUERY_INVALID'});
   if(column==='empresa_id'){if(operator!=='eq'||value!==empresaId)return json(res,403,{error:'REPORT_TENANT_MISMATCH'});continue;}
   if(operator==='in'){
    if(!Array.isArray(value)||value.length>200||value.some(v=>!/^[a-zA-Z0-9-]+$/.test(String(v))))return json(res,400,{error:'REPORT_QUERY_INVALID'});
    query.append(column,`in.(${value.join(',')})`);
   }else{
    if(!['string','number','boolean'].includes(typeof value))return json(res,400,{error:'REPORT_QUERY_INVALID'});
    query.append(column,`${operator}.${value}`);
   }
  }
  const order=[];
  for(const item of orders){if(!Array.isArray(item)||!/^[a-z_]+$/.test(item[0])||typeof item[1]!=='boolean')return json(res,400,{error:'REPORT_QUERY_INVALID'});order.push(`${item[0]}.${item[1]?'asc':'desc'}`);}
  if(order.length)query.set('order',order.join(','));
  const response=await fetch(`${url}/rest/v1/${rpc?'rpc/'+rpc:table}?${query}`,rpc?{method:'POST',headers,body:JSON.stringify({p_empresa_id:empresaId})}:{headers});
  if(!response.ok)return json(res,502,{error:'REPORT_SOURCE_UNAVAILABLE'});
  const data=await response.json();if(!Array.isArray(data))return json(res,502,{error:'REPORT_SOURCE_INVALID'});
  return json(res,200,{data});
 }catch{return json(res,502,{error:'REPORT_SOURCE_UNAVAILABLE'});}
}
