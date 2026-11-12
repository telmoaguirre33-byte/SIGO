// Continuation of test-catalogo121-db: only its marked, isolated synthetic DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
if(process.env.SIGO_ISOLATED_TEST_DB!=='1'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='sigo_catalogo121_qa'||process.env.PGHOSTADDR||process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGOPTIONS)throw Error('Isolated synthetic fixture required');
const args=['-XqAt','-v','ON_ERROR_STOP=1'];
const env={...process.env,PGOPTIONS:'-c statement_timeout=45000 -c lock_timeout=2000'};
const sql=q=>execFileSync('psql',args,{input:q,encoding:'utf8',timeout:60000,env,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql('select current_database()'),'sigo_catalogo121_qa');
assert.equal(sql('select public.qa_catalogo121_fixture()'),'synthetic-only-catalogo121');
const E='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
const actor=(q,user=A)=>`set "qa.uid"='${user}';set role authenticated;${q}`;
const query=(q='',offset=0,limit=51,tenant=E,code=false)=>`select * from consultar_productos_sigo('${tenant}',${lit(q)},${offset},${limit},null,${code})`;
const rows=(q='',offset=0,code=false)=>JSON.parse(sql(actor(`select coalesce(json_agg(t),'[]') from (${query(q,offset,51,E,code)}) t`)));
const measure=q=>JSON.parse(sql(actor(`explain(analyze,format json) ${q}`)))[0]['Execution Time'];
sql(`insert into empresa_usuarios(empresa_id,user_id,activo,rol) values('${E}','${B}',true,'seller') on conflict do nothing;`);
const categories=['Ferretería','Supermercado','Librería','Carnicería','Verdulería','Fiambrería','Limpieza'];
const report=[];
for(const size of [1000,5000,10000,15000,20000,30000,50000]){
  sql(`truncate productos,producto_codigos_alias_sigo;
    insert into productos select md5(e::text||':'||i)::uuid,e,
      case when i=77 then 'OFERTA 50%_válida barra \\ QA' when i=78 then 'O''RING / M8 1/2 QA' else
        (array['Tornillo acero M8','Arroz integral 1kg','Cuaderno rayado A4','Carne picada especial','Tomate perita fresco','Queso cremoso feteado','Detergente limón 750ml'])[1+(i%7)]||' QA '||lpad(i::text,5,'0') end,
      'MARCAQA',null,(array['Ferretería','Supermercado','Librería','Carnicería','Verdulería','Fiambrería','Limpieza'])[1+(i%7)],null,
      case when i in(200,201) then 'DUP-QA' else 'INT-'||i end,
      case when i in(200,201) then '7799999999999' else '779'||lpad(i::text,10,'0') end,
      10,10,case when i=80 then 0 else 123.45 end,20,20,case when i=80 then 0 else 100 end,0,null,
      (array['unidad','kg','g','l','m'])[1+(i%5)],true
    from unnest(array['${E}'::uuid,'${O}'::uuid])e cross join generate_series(1,${size})i;
    insert into productos select md5(e::text||':inactive')::uuid,e,'INACTIVO QA','MARCAQA',null,'Ferretería',null,'INACTIVO-QA','7798888888888',10,10,123.45,20,20,100,0,null,'unidad',false from unnest(array['${E}'::uuid,'${O}'::uuid])e;
    insert into producto_codigos_alias_sigo select empresa_id,id,'ALIAS-ULTIMO' from productos where codigo_interno='INT-${size}';
    analyze productos;`);
  const samples=[];
  const positions=[1,Math.floor(size/2),size];
  for(const pos of positions){
    const expected=JSON.parse(sql(`select row_to_json(p) from productos p where empresa_id='${E}' and codigo_interno='INT-${pos}'`));
    assert.equal(rows('INT-'+pos,0,true)[0].id,expected.id);
    assert.equal(rows(expected.codigo_barras,0,true)[0].id,expected.id);
    assert.equal(rows(expected.nombre).length,1,'full name must not borrow digits from another EAN');
    assert.equal(rows(expected.nombre)[0].id,expected.id);
    const tokens=expected.nombre.split(/\s+/).reverse().join(' ');
    assert.equal(rows(tokens)[0].id,expected.id,'all words in reversed order');
    samples.push(measure(query(tokens)));
  }
  for(const category of categories){
    const found=rows(category.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase());
    assert.equal(found.length,51);assert.ok(found.every(p=>p.categoria===category&&p.empresa_id===E));
    samples.push(measure(query(category)));
  }
  assert.equal(rows('MARCAQA').length,51,'brand is searchable');
  assert.ok(rows('supermercado MARCAQA').every(p=>p.categoria==='Supermercado'),'words may span name, brand and category');
  assert.ok(rows('integral arroz').every(p=>p.nombre.startsWith('Arroz integral')));
  assert.equal(rows('integral QUESO INEXISTENTE').length,0,'every token required');
  assert.equal(rows('50%_válida').length,1,'wildcards are literal');
  assert.equal(rows('barra \\').length,1,'backslash literal');
  assert.equal(rows("O'RING 1/2").length,1,'quotes and slash literal');
  assert.equal(rows('7799999999999',0,true).length,2,'real duplicate IDs preserved for scanner rejection');
  assert.equal(rows('ALIAS-ULTIMO',0,true)[0].codigo_interno,'INT-'+size);
  assert.equal(rows('INACTIVO-QA').length,0,'inactive products are excluded');
  assert.equal(rows('INT-80',0,true)[0].stock_actual,0,'zero stock remains searchable');
  const firstPageMs=measure(query());
  const pageStart=Date.now();
  const count=sql(actor(`select count(*),count(distinct id),bool_and(empresa_id='${E}'::uuid) from generate_series(0,${Math.ceil(size/50)-1})n cross join lateral consultar_productos_sigo('${E}','',n*50,50)p`));
  assert.equal(count,`${size}|${size}|t`,'all matches reachable once, tenant preserved');
  assert.throws(()=>sql(actor(query('arroz',0,51,O))),/FORBIDDEN/);
  // Eight simultaneous cashiers; each server query includes actual authorization.
  const started=Date.now();
  const workers=Array.from({length:8},(_,i)=>new Promise((resolve,reject)=>{
    const p=spawn('psql',args,{env:{...env,PGAPPNAME:'catalogo121-cashier-'+i},stdio:['pipe','pipe','pipe']});let out='',err='';
    p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);
    p.on('close',code=>code===0?resolve(Number(out.trim())):reject(Error(err)));
    p.stdin.end(actor(`select count(*) from (${query('integral arroz')})p`,i%2?B:A));
  }));
  // Top-level await completes all workers before the next catalog replaces this one.
  const counts=await Promise.all(workers);assert.ok(counts.every(n=>n===51));
  const concurrencyWallMs=Date.now()-started;
  samples.sort((a,b)=>a-b);
  const metrics={productsPerTenant:size,tenants:2,positions,firstPageMs,searchMedianMs:samples[Math.floor(samples.length/2)],searchMaxMs:samples.at(-1),allPagesWallMs:started-pageStart,concurrentCashiers:8,concurrencyWallMs};
  assert.ok(firstPageMs<1000&&metrics.searchMaxMs<1000,'synthetic server query target < 1 second');
  report.push(metrics);console.log(JSON.stringify(metrics));
}
fs.mkdirSync('artifacts/catalogo121',{recursive:true});fs.writeFileSync('artifacts/catalogo121/scale.json',JSON.stringify({status:'PASS',sizes:report,cases:['begin/middle/end name/EAN/internal code','all words/reversed words/accents/case/brand/category','seven trades','literal percent/underscore/backslash/quote/slash','duplicate scanner code and alias','all pages/no duplicates/no tenant mix','eight simultaneous cashiers'],limitation:'Synthetic PostgreSQL measurements, not production latency or a commercial SLA'},null,2));
