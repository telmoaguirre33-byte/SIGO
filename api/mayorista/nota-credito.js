import {detalleFiscal,ultimoAutorizado,consultarComprobante,solicitarCae} from '../arca/cae.js';
import {WSFE,escapeXml,leerTicketWsaa} from '../arca/wsaa.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const reply=(res,status,value)=>res.status(status).setHeader('Cache-Control','no-store').setHeader('Content-Type','application/json').send(JSON.stringify(value));
/** Reutiliza ticket, cálculo fiscal, protocolo CAE y consulta SIGO. Siempre WSFE homologación. */
export default async function notaCredito(req,res){
 if(req.method!=='POST')return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
 const {empresaId,devolucionId}=req.body??{},auth=String(req.headers.authorization??''),url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,anonKey=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(!uuid(empresaId)||!uuid(devolucionId)||!auth.startsWith('Bearer '))return reply(res,400,{error:'CREDIT_NOTE_INPUT_INVALID'});
 if(!url||!anonKey)return reply(res,503,{error:'MAYORISTA_FISCAL_NOT_CONFIGURED'});
 const headers={apikey:anonKey,Authorization:auth,'Content-Type':'application/json'},session={url,anonKey,auth};
 const rpc=async(name,args)=>{const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('CREDIT_NOTE_RPC_REJECTED');return r.json();};
 try{
  if(!await rpc('tiene_permiso_empresa',{p_empresa_id:empresaId,p_permiso:'invoices.issue'}))return reply(res,403,{error:'CREDIT_NOTE_FORBIDDEN'});
  const configResponse=await fetch(url+'/rest/v1/arca_config?empresa_id=eq.'+encodeURIComponent(empresaId)+'&select=*',{headers,signal:AbortSignal.timeout(10000)}),config=configResponse.ok?(await configResponse.json())?.[0]:null;
  if(config?.ambiente!=='homologacion')return reply(res,409,{error:'MAYORISTA_HOMOLOGATION_ONLY'});
  if(config.activo!==true||config.ultima_prueba_ok!==true||!/^\d{11}$/.test(config.cuit_emisor??''))return reply(res,409,{error:'CREDIT_NOTE_CONFIG_REQUIRED'});
  let context=await rpc('leer_nota_credito_mayorista_sigo',{p_empresa_id:empresaId,p_devolucion:devolucionId});
  if(context.empresaId!==empresaId||context.devolucionId!==devolucionId)return reply(res,403,{error:'CREDIT_NOTE_FORBIDDEN'});
  if(context.reserva?.cae)return reply(res,200,{ok:true,alreadyIssued:true,ambiente:'homologacion',devolucionId,comprobante:context.reserva});
  const ticket=await leerTicketWsaa(session,empresaId,'homologacion',config.cuit_emisor);if(!ticket)return reply(res,409,{error:'ARCA_TICKET_REFRESH_REQUIRED'});
  const original=context.original,tipo={1:3,6:8,11:13}[original.tipo_cbte],punto=Number(original.punto_venta);if(!tipo||!Number.isInteger(punto)||punto<1||!Number.isSafeInteger(Number(original.numero_cbte)))return reply(res,409,{error:'CREDIT_NOTE_ORIGINAL_INVALID'});
  const finish=async(result,reconciled)=>{const comprobante=await rpc('confirmar_nota_credito_mayorista_sigo',{p_empresa_id:empresaId,p_devolucion:devolucionId,p_datos:result});return reply(res,200,{ok:true,reconciled,ambiente:'homologacion',devolucionId,comprobante});};
  if(context.reserva){const recovered=await consultarComprobante(WSFE.homologacion,ticket,config.cuit_emisor,punto,tipo,Number(context.reserva.numero_cbte));if(recovered)return await finish(recovered,true);}
  else{const numero=await ultimoAutorizado(WSFE.homologacion,ticket,config.cuit_emisor,punto,tipo)+1;context=await rpc('reservar_nota_credito_mayorista_sigo',{p_empresa_id:empresaId,p_devolucion:devolucionId,p_numero:numero});}
  const receptor={docTipo:Number(context.cliente.arca_doc_tipo),docNro:String(context.cliente.documento??'').replace(/\D/g,''),condicionIvaReceptorId:Number(context.cliente.condicion_iva_receptor_id)};
  if(!Number.isInteger(receptor.docTipo)||receptor.docTipo<1||!/^\d{1,11}$/.test(receptor.docNro)||!Number.isInteger(receptor.condicionIvaReceptorId)||receptor.condicionIvaReceptorId<1)return reply(res,409,{error:'ARCA_CLIENT_FISCAL_DATA_REQUIRED'});
  const total=Number(context.total),items=context.items??[];if(!Number.isFinite(total)||total<=0||Math.abs(items.reduce((n,i)=>n+Number(i.subtotal),0)-total)>0.01)return reply(res,409,{error:'CREDIT_NOTE_TOTAL_INVALID'});
  const fiscal=detalleFiscal(Number(original.tipo_cbte),total,items,new Map((context.productos??[]).map(p=>[p.id,p])));
  fiscal.ivaXml+=`<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${Number(original.tipo_cbte)}</ar:Tipo><ar:PtoVta>${punto}</ar:PtoVta><ar:Nro>${Number(original.numero_cbte)}</ar:Nro><ar:Cuit>${escapeXml(config.cuit_emisor)}</ar:Cuit></ar:CbteAsoc></ar:CbtesAsoc>`;
  const result=await solicitarCae(WSFE.homologacion,ticket,config.cuit_emisor,{puntoVenta:punto,tipoCbte:tipo,numeroCbte:Number(context.reserva.numero_cbte),receptor,fiscal});return await finish(result,false);
 }catch{return reply(res,502,{error:'CREDIT_NOTE_RETRY_CONSERVED',retryable:true});}
}
