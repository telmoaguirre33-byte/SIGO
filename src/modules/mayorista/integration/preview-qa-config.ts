/** Opt-in de build exclusivo de la rama Preview; la API vuelve a verificar origen, empresa y sesión. */
export function previewQaConfig(empresaId:string,env:Record<string,unknown>|undefined,pageOrigin:string){
 if(env?.VITE_MAYORISTA_QA_MODE!=='isolated'||env.VITE_MAYORISTA_QA_EMPRESA_ID!==empresaId)return null;
 try{
  const page=new URL(pageOrigin),api=new URL(String(env.VITE_MAYORISTA_QA_API_ORIGIN??''));
  if(page.protocol!=='https:'||!page.hostname.endsWith('.vercel.app')||api.protocol!=='https:'||api.origin!==env.VITE_MAYORISTA_QA_API_ORIGIN||api.username||api.password)return null;
  return {empresa_id:empresaId,habilitado:true,aplicacion_disponible:true,origen_aprobado:api.origin,administracion_url:api.origin+'/portal.html',vendedor_url:api.origin+'/secure.html',qa_aislado:true};
 }catch{return null;}
}
