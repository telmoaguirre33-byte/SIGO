import { supabase } from './supabase';

function consulta(table?: string, rpc?: string, empresaInicial?: string) {
  const body: { empresaId: string; table?: string; rpc?: string; select: string; filters: unknown[][]; orders: Array<[string,boolean]>; range: number[] } =
    { empresaId: empresaInicial ?? '', table, rpc, select: 'id', filters: [], orders: [], range: [0,999] };
  const query = {
    select(columns: string) { body.select=columns;return query; },
    eq(column: string,value: unknown) { if(column==='empresa_id')body.empresaId=String(value);body.filters.push([column,'eq',value]);return query; },
    gte(column: string,value: unknown) { body.filters.push([column,'gte',value]);return query; },
    lte(column: string,value: unknown) { body.filters.push([column,'lte',value]);return query; },
    lt(column: string,value: unknown) { body.filters.push([column,'lt',value]);return query; },
    in(column: string,value: unknown[]) { body.filters.push([column,'in',value]);return query; },
    order(column: string,options: {ascending?:boolean}={}) { body.orders.push([column,options.ascending!==false]);return query; },
    range(start: number,end: number) { body.range=[start,end];return query; },
    async then(yes: (value: {data:any[]|null;error:Error|null})=>unknown,no?: (reason:unknown)=>unknown) {
      try {
        const {data:{session},error}=await supabase.auth.getSession();
        if(error||!session?.access_token)throw new Error('No se pudo verificar reports.read para esta empresa.');
        const response=await fetch('/api/informes/consultar',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();
        if(!response.ok||!Array.isArray(result.data))throw new Error(result.error==='REPORTS_READ_FORBIDDEN'?'Tu usuario no tiene permiso reports.read en esta empresa.':'No se pudo cargar una fuente del informe.');
        return yes({data:result.data,error:null});
      }catch(error){return yes({data:null,error:error instanceof Error?error:new Error('Informe no disponible.')});}
    },
  };
  return query;
}
export const reportesClient={from:(table:string)=>consulta(table),rpc:(name:string,args:{p_empresa_id:string})=>consulta(undefined,name,args.p_empresa_id)};
