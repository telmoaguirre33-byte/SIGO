const empresa_id = '00000000-0000-4000-8000-000000000001';
const count = Number(new URLSearchParams(location.search).get('count') || 40);
const catalog = Array.from({length:count},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,empresa_id,
 nombre:`Lápiz Útil ${i+1}`,codigo_barras:null,codigo_interno:`QA-${i+1}`,marca:'QA',categoria:'Librería',
 stock_actual:100,stock_minimo:1,precio_venta:100,costo_actual:10,costo_ultima_compra:10}));
function query(initial:any[]) {
 let data=[...initial];const q:any={};
 q.select=()=>q;q.eq=(k:string,v:any)=>{data=data.filter(x=>x[k]===v);return q;};
 q.order=()=>q;q.in=()=>q;q.gte=()=>q;q.lte=()=>q;q.is=()=>q;
 q.range=(a:number,b:number)=>{data=data.slice(a,b+1);return q;};q.limit=(n:number)=>{data=data.slice(0,n);return q;};
 q.then=(yes:any,no:any)=>Promise.resolve({data,error:null}).then(yes,no);
 q.maybeSingle=()=>Promise.resolve({data:data[0]??null,error:null});
 for(const key of ['insert','update','upsert','delete'])q[key]=()=>{throw Error('WRITES_FORBIDDEN');};
 return q;
}
export const supabase:any={
 rpc(name:string){if(name==='listar_productos_sigo')return query(catalog);throw Error(`UNEXPECTED_RPC:${name}`);},
 from(table:string){return query(table==='productos'?catalog:[]);},
 auth:{getSession:async()=>({data:{session:null},error:null})},
};
