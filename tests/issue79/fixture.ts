const empresa_id = '00000000-0000-4000-8000-000000000001';
const count = Number(new URLSearchParams(location.search).get('count') || 40);
const catalog = Array.from({length:count},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,empresa_id,
 nombre:`Lápiz Útil ${i+1}`,codigo_barras:null,codigo_interno:`QA-${i+1}`,marca:'QA',categoria:'Librería',
 stock_actual:100,stock_minimo:1,precio_venta:100,costo_actual:10,costo_ultima_compra:10}));
const reportMode = new URLSearchParams(location.search).has('reports');
const state = { version: 1, calls: [] as any[] };
(window as any).issue79 = state;
function query(initial:any[], table='') {
 let data=[...initial];const q:any={};
 q.select=()=>q;q.eq=(k:string,v:any)=>{data=data.filter(x=>x[k]===v);return q;};
 q.order=()=>q;q.in=()=>q;q.gte=(key:string,value:any)=>{state.calls.push({table,op:'gte',version:state.version,key,value});return q;};q.lte=()=>q;q.lt=()=>q;q.is=()=>q;
 q.range=(a:number,b:number)=>{data=data.slice(a,b+1);return q;};q.limit=(n:number)=>{data=data.slice(0,n);return q;};
 q.then=(yes:any,no:any)=>Promise.resolve({data,error:null}).then(yes,no);
 q.maybeSingle=()=>Promise.resolve({data:data[0]??null,error:null});
 for(const key of ['insert','update','upsert','delete'])q[key]=()=>{throw Error('WRITES_FORBIDDEN');};
 return q;
}
export const supabase:any={
 rpc(name:string){if(name==='listar_productos_sigo')return query(catalog);if(name==='buscar_producto_codigo_sigo')return query([]);throw Error(`UNEXPECTED_RPC:${name}`);},
 from(table:string){
  const now=new Date().toISOString();
  const data=table==='productos'?catalog:reportMode&&table==='ventas_sigo'?[{id:'qa-sale',empresa_id,estado:'confirmada',total:state.version*100,created_at:now}]:reportMode&&table==='compras_sigo'?[{id:'qa-purchase',empresa_id,estado:'confirmada',total:state.version*50,created_at:now}]:[];
  return query(data,table);
 },
 auth:{getSession:async()=>({data:{session:{access_token:'isolated-fixture-token'}},error:null})},
};

// Transport adapter for the combined reports.read branch; fixture data only.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
 if (String(input) === '/api/informes/consultar') {
  const body = JSON.parse(String(init?.body || '{}'));
  let q = body.rpc ? supabase.rpc(body.rpc) : supabase.from(body.table);
  q = q.select(body.select);
  for (const [column, operator, value] of body.filters || []) q = q[operator](column, value);
  const result = await q.range(body.range[0],body.range[1]);
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
 }
 return originalFetch(input,init);
};
