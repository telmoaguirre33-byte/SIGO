import {resolveMayoristaAccess,type CompanyAccessConfig} from './access-policy';
export function createCompanyConfigProvider(readConfig:(empresaId:string,signal:AbortSignal)=>Promise<unknown>){
 return async(empresaId:string,signal:AbortSignal):Promise<CompanyAccessConfig|null>=>{
  const data=await readConfig(empresaId,signal);
  const row=(Array.isArray(data)?data[0]:data) as Record<string,unknown>|null;
  if(!row)return null;
  const config:CompanyAccessConfig={empresaId:String(row.empresa_id??''),habilitado:row.habilitado===true,aplicacionDisponible:row.aplicacion_disponible===true,origenAprobado:String(row.origen_aprobado??''),administracionUrl:String(row.administracion_url??''),vendedorUrl:String(row.vendedor_url??'')};
  if(!resolveMayoristaAccess({empresaId,rol:'owner'},config).enabled)return null;
  return config;
 };
}
