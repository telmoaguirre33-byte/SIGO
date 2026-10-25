// Independent PostgreSQL 17 test. Only an empty, explicitly isolated loopback DB is accepted.
// Runs the repository's actual RPC; the fixture replaces auth/ACL and supporting tables only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

if (process.env.SIGO_ISOLATED_TEST_DB !== '1' || process.env.PGHOST !== '127.0.0.1'
  || process.env.PGDATABASE !== 'sigo_cobro104_qa'
  || !/^\d+$/.test(process.env.PGPORT || '5432')
  || process.env.PGHOSTADDR || process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGOPTIONS) {
  throw Error('Refusing: explicitly isolated loopback sigo_cobro104_qa database required');
}
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const env = { ...process.env, PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=12000' };
const sql = input => execFileSync('psql', args, { input, encoding:'utf8', env, timeout:20000, stdio:['pipe','pipe','pipe'] }).trim();
assert.equal(sql("select current_database() || ':' || (current_setting('server_version_num')::int / 10000)::text"), 'sigo_cobro104_qa:17', 'Only PostgreSQL 17 isolated DB');
assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%';"), '0', 'Database must be empty; refusing to modify existing objects');
assert.equal(sql("select count(*) from pg_namespace where nspname not in ('public','pg_catalog','information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%';"), '0', 'No preexisting application schemas');
assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"), '0', 'No preexisting public functions');

const E='11111111-1111-4111-8111-111111111111', O='33333333-3333-4333-8333-333333333333';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U='10000000-0000-4000-8000-000000000001', W='10000000-0000-4000-8000-000000000002';
const OU='30000000-0000-4000-8000-000000000001', OW='30000000-0000-4000-8000-000000000002';
const C='20000000-0000-4000-8000-000000000001';
const migration='supabase/migrations/20261022024847_manual_medidas_atomicas.sql';
const source=fs.readFileSync(migration,'utf8');
function actual(name, delimiter) {
  const escaped=delimiter.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=source.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?as\\s+'+escaped+'[\\s\\S]*?'+escaped+';', 'i'));
  assert.ok(match, 'Actual repository definition must exist: '+name);
  return match[0];
}
const fixture=`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create table qa_permissions(user_id uuid,empresa_id uuid,perm text,primary key(user_id,empresa_id,perm));
insert into qa_permissions select u,e,p from unnest(array['${A}'::uuid,'${B}'::uuid]) u cross join unnest(array['${E}'::uuid,'${O}'::uuid]) e cross join unnest(array['sales.write','clients.read']) p where u='${A}'::uuid or e='${E}'::uuid;
create function public.tiene_permiso_empresa(e uuid,p text) returns boolean language sql stable as $$select exists(select 1 from public.qa_permissions where user_id=auth.uid() and empresa_id=e and perm=p)$$;
create table productos(id uuid primary key,empresa_id uuid not null,nombre text not null,precio_venta numeric,stock_actual numeric,unidad_medida text,activo boolean default true);
insert into productos values('${U}','${E}','Unidad QA',100,1000,'unidad',true),('${W}','${E}','Peso QA',200,1000,'kg',true),('${OU}','${O}','Unidad otra empresa',100,1000,'unidad',true),('${OW}','${O}','Peso otra empresa',200,1000,'kg',true);
create table clientes_sigo(id uuid primary key,empresa_id uuid not null,saldo_actual numeric default 0,limite_credito numeric,activo boolean default true,updated_at timestamptz default now());
insert into clientes_sigo(id,empresa_id,limite_credito) values('${C}','${E}',10000);
create table ventas_sigo(id uuid primary key default gen_random_uuid(),empresa_id uuid not null,cliente_id uuid references clientes_sigo,total numeric,medio_pago text,idempotency_key text not null,request_fingerprint text,created_by uuid,estado text default 'confirmada',unique(empresa_id,idempotency_key));
create table venta_items_sigo(id uuid primary key default gen_random_uuid(),venta_id uuid references ventas_sigo,empresa_id uuid,producto_id uuid references productos,cantidad numeric,precio_unitario numeric,subtotal numeric,unidad_medida text);
create table caja_movimientos_sigo(id uuid primary key default gen_random_uuid(),empresa_id uuid,venta_id uuid references ventas_sigo,tipo text,medio_pago text,importe numeric,concepto text,created_by uuid);
create table cliente_movimientos_sigo(id uuid primary key default gen_random_uuid(),empresa_id uuid,cliente_id uuid references clientes_sigo,venta_id uuid references ventas_sigo,tipo text,importe numeric,concepto text,created_by uuid);
create table ofertas_productos_sigo(empresa_id uuid,producto_id uuid,descuento_porcentaje numeric,fecha_inicio date,fecha_fin date);
grant usage on schema public,auth to authenticated;
create function qa_assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'QA: %',msg; end if; end$$;
`;
const signature='public.confirmar_venta_sigo_v2(uuid,jsonb,text,text,uuid,numeric)';
sql(fixture+'\n'+actual('sigo_precision_unidad','$$')+'\n'+actual('confirmar_venta_sigo_v2','$function$')+`\nrevoke all on function ${signature} from public,anon; grant execute on function ${signature} to authenticated;`);
const results=[];
const pass=message=>{results.push(message);console.log('PASS: '+message);};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function call(key, {empresa=E,product=U,quantity=1,unit='unidad',medio='efectivo',cliente=null,items}={}) {
  return `public.confirmar_venta_sigo_v2('${empresa}',${literal(JSON.stringify(items??[{producto_id:product,cantidad:quantity,unidad_medida:unit}]))}::jsonb,${literal(medio)},${literal(key)},${cliente?literal(cliente)+'::uuid':'null'},0)`;
}
const actor=(user=A)=>`set "qa.uid"=${literal(user)}; set role authenticated;`;
const pay=(key,options={},user=A)=>sql(actor(user)+'select '+call(key,options)+';');
const verify=(condition,message)=>sql(`select public.qa_assert((${condition}),${literal(message)});`);
function snapshot(){return sql("select jsonb_build_object('sales',(select jsonb_agg(to_jsonb(t) order by id) from ventas_sigo t),'items',(select jsonb_agg(to_jsonb(t) order by id) from venta_items_sigo t),'cash',(select jsonb_agg(to_jsonb(t) order by id) from caja_movimientos_sigo t),'credit',(select jsonb_agg(to_jsonb(t) order by id) from cliente_movimientos_sigo t),'products',(select jsonb_agg(to_jsonb(t) order by id) from productos t),'clients',(select jsonb_agg(to_jsonb(t) order by id) from clientes_sigo t))::text;");}
function rejected(expression,expected,user=A) {
  const before=snapshot();
  sql(actor(user)+`do $$begin begin perform ${expression}; raise exception 'QA_EXPECTED_REJECTION'; exception when raise_exception then if position(${literal(expected)} in sqlerrm)<>1 then raise; end if; end; end$$;`);
  assert.equal(snapshot(),before,expected+' must leave every sale/item/cash/stock/client value unchanged');
}

for(const [empresa,product,unit,quantity] of [[E,U,'unidad',1],[E,W,'kg',0.75],[O,OU,'unidad',1],[O,OW,'kg',0.75]]) {
  const prefix='sequential-'+empresa+'-'+unit;
  const before=Number(sql(`select stock_actual from productos where id='${product}'`));
  const ids=[];
  for(let n=1;n<=3;n++)ids.push(pay(prefix+'-'+n,{empresa,product,unit,quantity}));
  assert.equal(new Set(ids).size,3);
  verify(`select count(*)=3 from ventas_sigo where idempotency_key like '${prefix}-%'`,'three separate sequential sales');
  assert.equal(Number(sql(`select stock_actual from productos where id='${product}'`)),before-3*quantity);
}
pass('Three consecutive sales by unit and weight in each of two companies; exact stock delta');

// The first transaction commits; its response is intentionally discarded by the caller.
const beforeLost=Number(sql(`select stock_actual from productos where id='${W}'`));
pay('lost-response',{product:W,unit:'kg',quantity:0.625});
const committed=sql("select id from ventas_sigo where idempotency_key='lost-response'");
const beforeRetry=snapshot();
assert.equal(pay('lost-response',{product:W,unit:'kg',quantity:0.625}),committed);
assert.equal(snapshot(),beforeRetry);
assert.equal(Number(sql(`select stock_actual from productos where id='${W}'`)),beforeLost-0.625);
pass('Discarded committed response and exact-key retry return same UUID with no additional sale/cash/stock');

// Keep A's transaction open until B is observed waiting on a PostgreSQL lock.
async function concurrent(firstKey,secondKey,sameKey) {
  const beforeSales=Number(sql('select count(*) from ventas_sigo'));
  const beforeStock=Number(sql(`select stock_actual from productos where id='${U}'`));
  const workers=[];
  function worker(app) {
    const child=spawn('psql',args,{env:{...env,PGAPPNAME:app},stdio:['pipe','pipe','pipe'],timeout:20000});
    let out='',err='';const listeners=[];
    child.stdout.on('data',data=>{out+=data.toString();for(const resolve of listeners)if(out.includes('QA_HOLDING_TRANSACTION'))resolve();});
    child.stderr.on('data',data=>{err+=data.toString();});
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(app+' failed '+code+': '+err)));});
    // Observe rejection immediately, even while the lock barrier is being checked.
    done.catch(()=>{});
    workers.push(child);
    return {child,done,held:()=>out.includes('QA_HOLDING_TRANSACTION')?Promise.resolve():new Promise(resolve=>listeners.push(resolve))};
  }
  try {
    const a=worker('sigo-cobro104-box-a');
    a.child.stdin.write('begin;'+actor(A)+'select '+call(firstKey)+';\n\\echo QA_HOLDING_TRANSACTION\n');
    let timer;
    try {await Promise.race([a.held(),a.done.then(()=>{throw Error('A ended before lock barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A lock barrier timeout')),5000);})]);}finally{clearTimeout(timer);}
    const b=worker('sigo-cobro104-box-b');
    b.child.stdin.end(actor(B)+'select '+call(secondKey)+';\n');
    let locked=false;
    for(let n=0;n<100;n++) {
      if(sql("select exists(select 1 from pg_stat_activity where application_name='sigo-cobro104-box-b' and wait_event_type='Lock')")==='t'){locked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(locked,'B must actually contend with A in PostgreSQL before A commits');
    a.child.stdin.end('commit;\n\\quit\n');
    const outputs=await Promise.all([a.done,b.done]);
    const ids=outputs.map(output=>output.match(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/im)?.[0]);
    assert.ok(ids.every(Boolean),'Each connection returned a UUID');
    assert.equal(ids[0]===ids[1],sameKey);
    assert.equal(Number(sql('select count(*) from ventas_sigo')),beforeSales+(sameKey?1:2));
    assert.equal(Number(sql(`select stock_actual from productos where id='${U}'`)),beforeStock-(sameKey?1:2));
    verify(`select count(*)=${sameKey?1:2} from caja_movimientos_sigo where venta_id in (select id from ventas_sigo where idempotency_key in (${literal(firstKey)},${literal(secondKey)}))`,'concurrent exact number of cash entries');
  } finally {for(const worker of workers)if(worker.exitCode===null)worker.kill('SIGTERM');}
}
await concurrent('box-a-distinct','box-b-distinct',false);
pass('Two authenticated cashiers with different keys: proven lock contention, two sales/cash entries and exactly two stock deductions');
await concurrent('both-boxes-same-key','both-boxes-same-key',true);
pass('Two authenticated cashiers with same key: proven lock contention, same UUID, one sale/cash entry and one stock deduction');

rejected(call('lost-response',{product:W,unit:'kg',quantity:0.5}),'IDEMPOTENCY_CONFLICT');
pass('Same key with changed payload rejects and preserves the complete persisted state');
rejected(call('rollback-later-line',{items:[{producto_id:U,cantidad:1,unidad_medida:'unidad'},{producto_id:W,cantidad:999999,unidad_medida:'kg'}]}),'INSUFFICIENT_STOCK');
pass('Later product failure rolls back earlier item, stock, sale header and cash atomically');
rejected(call('other-tenant',{empresa:O,product:OU}),'SALES_WRITE_FORBIDDEN',B);
rejected(call('no-auth'),'AUTH_REQUIRED','');
sql(`delete from qa_permissions where user_id='${A}' and empresa_id='${E}' and perm='sales.write'`);
rejected(call('lost-response',{product:W,unit:'kg',quantity:0.625}),'SALES_WRITE_FORBIDDEN');
sql(`insert into qa_permissions values('${A}','${E}','sales.write')`);
verify(`not has_function_privilege('anon','${signature}','EXECUTE')`,'anonymous execution revoked');
verify("not has_table_privilege('authenticated','public.ventas_sigo','INSERT')",'cashier cannot insert sales directly');
pass('Missing auth, forbidden tenant and revoked sales permission (including retry) reject without any persisted change; anon execution and direct inserts forbidden');

pay('credit',{cliente:C,medio:'cuenta_corriente',quantity:2});
const creditState=snapshot();assert.equal(pay('credit',{cliente:C,medio:'cuenta_corriente',quantity:2}),sql("select id from ventas_sigo where idempotency_key='credit'"));assert.equal(snapshot(),creditState);
verify(`select saldo_actual=200 from clientes_sigo where id='${C}'`,'credit balance changed once');
verify("select count(*)=1 and sum(importe)=200 from cliente_movimientos_sigo",'single credit movement');
verify("select count(*)=0 from caja_movimientos_sigo where venta_id in (select id from ventas_sigo where idempotency_key='credit')",'credit does not also enter cash');
pass('Credit sale and retry create one client movement, exact balance and no cash entry');

verify("select count(*)=0 from ventas_sigo v where (select coalesce(sum(subtotal),0) from venta_items_sigo i where i.venta_id=v.id)<>v.total",'every header equals item totals');
verify("select count(*)=0 from ventas_sigo v where v.medio_pago<>'cuenta_corriente' and ((select count(*) from caja_movimientos_sigo m where m.venta_id=v.id)<>1 or (select sum(importe) from caja_movimientos_sigo m where m.venta_id=v.id) is distinct from v.total)",'every cash sale has exactly one matching cash amount');
verify("select count(*)=0 from venta_items_sigo i join ventas_sigo v on v.id=i.venta_id join productos p on p.id=i.producto_id where i.empresa_id<>v.empresa_id or i.empresa_id<>p.empresa_id",'tenant boundaries preserved across headers/items/products');
const artifact=process.env.COBRO104_DB_QA_DIR||'.test-build/cobro104-db';fs.mkdirSync(artifact,{recursive:true});
fs.writeFileSync(artifact+'/db-summary.json',JSON.stringify({status:'PASS',postgres:17,syntheticOnly:true,actualRpcSource:migration,results,limitations:['Minimal fixture auth/ACL and tables do not test production RLS, triggers or schema drift.','No browser, network loss, fiscal issuance or physical devices; discarded-response test ignores the committed SQL result.']},null,2));
console.log('PASS: independent PostgreSQL 17 RPC verification ('+results.length+' cases); no commercial database or fiscal API accessed');
