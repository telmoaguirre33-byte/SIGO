import emitirCae from '../arca/cae-v2.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const reply=(res,status,value)=>{res.setHeader('Cache-Control','no-store');return res.status(status).setHeader('Content-Type','application/json').send(JSON.stringify(value));};
/** Solo homologación. Reutiliza el emisor SIGO, su reserva y conciliación; no crea otro motor fiscal. */
export default async function facturarEntrega(req,res){
 if(req.method!=='POST')return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
 const {empresaId,comandoId,puntoVenta,tipoCbte,condicionIvaReceptorId}=req.body??{},authorization=String(req.headers.authorization??'');
 if(!uuid(empresaId)||!uuid(comandoId)||!authorization.startsWith('Bearer '))return reply(res,400,{error:'MAYORISTA_FISCAL_INPUT_INVALID'});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply(res,503,{error:'MAYORISTA_FISCAL_NOT_CONFIGURED'});
 const headers={apikey:key,Authorization:authorization,'Content-Type':'application/json'};
 try{
  const stateResponse=await fetch(url+'/rest/v1/rpc/leer_comercio_mayorista_sigo',{method:'POST',headers,body:JSON.stringify({p_empresa_id:empresaId}),signal:AbortSignal.timeout(10000)});
  if(!stateResponse.ok)return reply(res,403,{error:'MAYORISTA_FISCAL_FORBIDDEN'});
  const state=await stateResponse.json(),operation=state?.empresaId===empresaId?state.operaciones?.find(o=>o.comandoId===comandoId):null;
  const ventaId=operation?.estado==='confirmado'?operation.resultado?.ventaId:null;
  if(!uuid(ventaId))return reply(res,409,{error:'MAYORISTA_DELIVERY_NOT_CONFIRMED'});
  const configResponse=await fetch(url+`/rest/v1/arca_config?empresa_id=eq.${encodeURIComponent(empresaId)}&select=ambiente`,{headers,signal:AbortSignal.timeout(10000)});
  const config=configResponse.ok?(await configResponse.json())?.[0]:null;
  if(config?.ambiente!=='homologacion')return reply(res,409,{error:'MAYORISTA_HOMOLOGATION_ONLY'});
  return emitirCae({...req,body:{empresaId,ventaId,puntoVenta,tipoCbte,condicionIvaReceptorId,confirmacion:'SOLICITAR_CAE_HOMOLOGACION'}},res);
 }catch{return reply(res,503,{error:'MAYORISTA_FISCAL_RETRY_CONSERVED'});}
}
