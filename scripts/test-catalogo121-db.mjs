// Only an empty, explicitly isolated database. Never accepts a remote database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
if (process.env.SIGO_ISOLATED_TEST_DB !== '1' || process.env.PGHOST !== '127.0.0.1'
    || process.env.PGDATABASE !== 'sigo_catalogo121_qa' || process.env.PGHOSTADDR
    || process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGOPTIONS) throw Error('Isolated empty loopback DB required');
const sql = (input) => execFileSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1'], {
  input, encoding: 'utf8', timeout: 60000, env: { ...process.env, PGOPTIONS: '-c statement_timeout=45000 -c lock_timeout=2000' },
}).trim();
assert.equal(sql('select current_database()'), 'sigo_catalogo121_qa');
assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_%'"), '0');
assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"), '0');
assert.equal(sql("select count(*) from pg_namespace where nspname not in ('public','pg_catalog','information_schema') and nspname not like 'pg_%'"), '0');
const read = f => fs.readFileSync(f, 'utf8');
const E = '11111111-1111-4111-8111-111111111111', O = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
sql(`create role authenticated; create role anon;
create schema auth;
create function public.qa_catalogo121_fixture() returns text language sql immutable as $$select 'synthetic-only-catalogo121'::text$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create table empresa_usuarios(empresa_id uuid,user_id uuid,activo boolean,rol text,permisos_extra text[] default '{}',permisos_denegados text[] default '{}',primary key(empresa_id,user_id));
create table productos(id uuid primary key,empresa_id uuid,nombre text,marca text,descripcion text,categoria text,proveedor text,codigo_interno text,codigo_barras text,costo_actual numeric,costo_ultima_compra numeric,precio_venta numeric,margen_ganancia numeric,margen_porcentaje numeric,stock_actual numeric,stock_minimo numeric,stock_maximo numeric,unidad_medida text,activo boolean);
create index idx_productos_empresa_codigo_barras on productos(empresa_id,codigo_barras) where codigo_barras is not null and btrim(codigo_barras)<>'';
create index idx_productos_empresa_codigo_interno on productos(empresa_id,codigo_interno) where codigo_interno is not null and btrim(codigo_interno)<>'';
alter table productos enable row level security;
grant select on productos to authenticated; -- no policies: direct reads must see zero
create table producto_codigos_alias_sigo(empresa_id uuid,producto_id uuid,codigo text,unique(empresa_id,codigo));
insert into empresa_usuarios(empresa_id,user_id,activo,rol) values ('${E}','${A}',true,'owner'),('${O}','${B}',true,'owner');
insert into productos select md5(e::text||':'||i)::uuid,e,
 case when i=14999 then 'ACOPLE RÁPIDO PROFESIONAL' when i between 14000 and 14119 then 'ENCHUFE '||i else 'Producto '||lpad(i::text,5,'0') end,
 'MARCAQA',null,null,null,'INT-'||i,'779'||lpad(i::text,10,'0'),10,10,100,20,20,100,0,null,
 case when i%3=0 then 'kg' when i%3=1 then 'm' else 'unidad' end,true
 from unnest(array['${E}'::uuid,'${O}'::uuid]) e cross join generate_series(1,20000) i;
insert into producto_codigos_alias_sigo select empresa_id,id,'ALIAS-QA' from productos where codigo_interno='INT-14999';
analyze productos;`);
// Actual permission functions from the repository, not a permissive ACL stub.
const acl = read('supabase/migrations/20260909201500_permisos_backend.sql');
sql(acl.slice(acl.indexOf('create or replace function public.permiso_sigo_valido'), acl.indexOf('create or replace function public.permisos_sigo_validos')));
const granular = read('supabase/migrations/20260912102000_roles_operativos_hardening.sql');
sql(granular.slice(granular.indexOf('create or replace function public.tiene_permiso_empresa'), granular.indexOf('revoke all on function public.tiene_permiso_empresa')));
const medidas = read('supabase/migrations/20261022024847_manual_medidas_atomicas.sql');
sql(medidas.slice(medidas.indexOf('create or replace function public.sigo_precision_unidad'), medidas.indexOf('create or replace function public.listar_unidades_producto_sigo')));
const old = read('supabase/migrations/20260913203500_desactivar_servicios_no_vendibles.sql');
sql(old.slice(old.indexOf('create or replace function public.listar_productos_sigo'),old.indexOf('-- Defensa final DB:')));
const actor = (q, user=A) => sql(`set "qa.uid"='${user}'; set role authenticated; ${q}`);
const measure = q => JSON.parse(actor(`explain (analyze,format json) ${q}`))[0];
const baseline = measure(`select * from listar_productos_sigo('${E}') limit 51`);
sql(read('supabase/migrations/20261112021657_catalogo_busqueda_servidor_121.sql'));
const query = (args='',empresa=E) => `select * from consultar_productos_sigo('${empresa}'${args})`;
const rows = (args='',empresa=E,user=A) => JSON.parse(actor(`select coalesce(json_agg(t),'[]') from (${query(args,empresa)}) t`,user));
const page = measure(query());
const search = measure(query(", 'acople rapido profesion'"));
sql(`select pg_stat_reset(); set track_functions='all'; set "qa.uid"='${A}'; set role authenticated; select count(*) from consultar_productos_sigo('${E}');`);
const permissionCalls=Number(sql("select calls from pg_stat_user_functions where funcname='tiene_permiso_empresa'"));
assert.equal(permissionCalls,7,'permission checks are constant per page, never per product');
assert.equal(rows(", 'acople rapido profesion'")[0].codigo_interno,'INT-14999');
assert.equal(rows(", 'profesion ACOPLE rapido'")[0].codigo_interno,'INT-14999');
assert.equal(rows(", 'profesion INEXISTENTE acople'").length,0);
assert.equal(rows(", 'MARCAQA'").length,51);
assert.equal(rows(", 'INT-14999'")[0].nombre,'ACOPLE RÁPIDO PROFESIONAL');
assert.equal(rows(", '7790000014999'").length,1);
assert.equal(rows(", 'ALIAS-QA',0,10,null,true")[0].codigo_interno,'INT-14999');
assert.equal(rows(", 'ENCHUFE',100,51").length,20);
assert.equal(rows(", '%'").length,0,'wildcard must be literal');
assert.equal(rows(", '_'").length,0,'wildcard must be literal');
assert.equal(rows(", '',0,51,'{}'::uuid[]").length,0,'empty ID list cannot read entire catalog');
const all = actor(`select count(*),count(distinct id) from generate_series(0,399) n cross join lateral consultar_productos_sigo('${E}','',n*50,50) p`);
assert.equal(all,'20000|20000','every page reachable, stable order, no duplicates');
assert.equal(actor('select count(*) from productos'),'0','direct RLS remains closed');
for (const rol of ['seller','admin','warehouse']) {
  sql(`update empresa_usuarios set rol='${rol}' where empresa_id='${E}'`);
  const r=rows()[0];
  assert.equal(r.costo_actual,null); assert.equal(r.costo_ultima_compra,null); assert.equal(r.margen_ganancia,null);
  assert.equal(r.precio_venta,rol==='warehouse'?null:100); assert.equal(r.stock_actual,100);
}
sql(`update empresa_usuarios set rol='owner',permisos_denegados=array['costs.read','stock.read'] where empresa_id='${E}'`);
assert.equal(rows()[0].costo_actual,null);assert.equal(rows()[0].stock_actual,null);
sql(`update empresa_usuarios set permisos_denegados=array['products.read'] where empresa_id='${E}'`);
assert.throws(()=>rows(),/FORBIDDEN/);
sql(`update empresa_usuarios set permisos_denegados='{}' where empresa_id='${E}'`);
assert.throws(()=>rows('',O),/FORBIDDEN/);
assert.throws(()=>rows('',E,B),/FORBIDDEN/);
assert.equal(rows('',O,B).every(p=>p.empresa_id===O),true);
assert.throws(()=>actor(query(),''),/AUTH_REQUIRED/);
assert.throws(()=>sql(`set role anon; ${query()}`),/permission denied/);
assert.throws(()=>rows(", '',0,502"),/CATALOG_QUERY_INVALID/);
assert.throws(()=>rows(", '',-1"),/CATALOG_QUERY_INVALID/);
// Select IDs must not return a row belonging to another tenant.
const foreignId=sql(`select id from productos where empresa_id='${O}' limit 1`);
assert.equal(rows(`, '',0,51,array['${foreignId}'::uuid]`).length,0);
const legacy = measure(`select * from listar_productos_sigo('${E}') limit 51`);
const report={status:'PASS',postgres:sql('show server_version'),syntheticProductsPerTenant:20000,tenants:2,
 baselineFirst51Ms:baseline['Execution Time'],newFirst51Ms:page['Execution Time'],searchMs:search['Execution Time'],legacyOptimizedMs:legacy['Execution Time'],permissionCallsPerPage:permissionCalls,
 cases:['all 20000 reachable without duplicates','accent/partial/full/brand/internal/EAN/alias','RLS and owner/admin/seller/warehouse/deny/anonymous','cross-tenant IDs rejected','literal wildcard and invalid arguments'],
 limitation:'Synthetic PostgreSQL fixture; not a measurement of the production database'};
fs.mkdirSync('artifacts/catalogo121',{recursive:true});fs.writeFileSync('artifacts/catalogo121/db.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
