import {isMayoristaEnabled,type CompanyAccessConfig} from './access-policy';
export function createCompanyConfigProvider(readConfig:(empresaId:string,signal:AbortSignal)=>Promise<unknown>,readModules?:(empresaId:string,signal:AbortSignal)=>Promise<unknown>){
 return async(empresaId:string,signal:AbortSignal):Promise<CompanyAccessConfig|null>=>{
  // Nunca inferir el flag desde tipo, licencia, destinos, caché ni errores de red.
  let enabled:boolean|undefined;
  if(readModules){const modules=await readModules(empresaId,signal);enabled=Array.isArray(modules)&&modules.some(row=>row.clave==='mayorista_distribuidora'&&row.habilitado===true);if(!enabled||signal.aborted)return null;}
  let data:unknown;
  try{data=await readConfig(empresaId,signal);}catch(error){if(enabled!==true||signal.aborted)throw error;}
  const row=(Array.isArray(data)?data[0]:data) as Record<string,unknown>|null;
  if(signal.aborted||(!row&&enabled!==true))return null;
  const config:CompanyAccessConfig={empresaId:enabled===true?empresaId:String(row?.empresa_id??''),habilitado:enabled??row?.habilitado===true,aplicacionDisponible:row?.empresa_id===empresaId&&row.aplicacion_disponible===true,origenAprobado:String(row?.origen_aprobado??''),administracionUrl:String(row?.administracion_url??''),vendedorUrl:String(row?.vendedor_url??'')};
  if(!isMayoristaEnabled({empresaId,rol:'owner'},config))return null;
  return config;
 };
}
