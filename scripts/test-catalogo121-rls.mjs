// Validate the existing, separately authorized RLS candidate; never a production runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
if(process.env.SIGO_ISOLATED_TEST_DB!=='1'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='sigo_catalogo121_qa'||process.env.PGHOSTADDR||process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGOPTIONS)throw Error('Isolated synthetic fixture required');
const env={...process.env,PGOPTIONS:'-c statement_timeout=45000 -c lock_timeout=2000'};
const sql=q=>execFileSync('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:60000,env,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql('select current_database()'),'sigo_catalogo121_qa');
assert.equal(sql('select public.qa_catalogo121_fixture()'),'synthetic-only-catalogo121');
const E='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',X='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id=n=>sql(`select id from productos where empresa_id='${n}' and codigo_interno='INT-1'`);
const own=id(E),foreign=id(O);
const actor=(q,user=A)=>`set "qa.uid"='${user}';set role authenticated;${q}`;
const countRows=()=>sql("select md5(string_agg(to_jsonb(p)::text,',' order by id)) from productos p");
const aliasSource=fs.readFileSync('supabase/migrations/20260916164500_producto_codigos_alias_scanner.sql','utf8');
sql(aliasSource.slice(aliasSource.indexOf('create or replace function public.buscar_producto_codigo_sigo'),aliasSource.indexOf('-- Evidencia recibida')));
const unitsSource=fs.readFileSync('supabase/migrations/20261022024847_manual_medidas_atomicas.sql','utf8');
sql(unitsSource.slice(unitsSource.indexOf('create or replace function public.listar_unidades_producto_sigo'),unitsSource.indexOf('create or replace function public.configurar_unidad_producto_sigo')));
sql(`do $$begin if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
  alter table productos add column if not exists iva_alicuota_id integer,add column if not exists iva_tasa numeric,add column if not exists precio_incluye_iva boolean;
  grant all on productos to anon,authenticated,service_role;
  create policy lectura_productos on productos for select to anon,authenticated using(true);
  create policy editar_productos on productos for update to anon,authenticated using(true) with check(true);
  create policy insertar_productos on productos for insert to anon,authenticated with check(true);
  create policy eliminar_productos on productos for delete to anon,authenticated using(true);`);
const snapshot=countRows();
const folder='docs/operacion-controlada/productos-rls/';
const apply=fs.readFileSync(folder+'02_APLICAR_PRODUCTOS_RLS_NO_AUTORIZADO.sql','utf8');
const rollback=fs.readFileSync(folder+'03_ROLLBACK_SNAPSHOT_RIESGO_NO_AUTORIZADO.sql','utf8');
sql(apply);
const directConsumers=[
  'id,nombre,codigo_interno,codigo_barras',
  'id,nombre,codigo_interno,codigo_barras,stock_actual,costo_actual',
  'id,empresa_id,nombre,stock_actual,costo_actual,costo_ultima_compra,precio_venta',
  'id,empresa_id,nombre,codigo_interno,codigo_barras,costo_actual,costo_ultima_compra,precio_venta,stock_actual,activo',
  'id,nombre',
  'id,nombre,codigo_interno,codigo_barras,activo,precio_venta,stock_actual',
  'id,iva_alicuota_id,iva_tasa,precio_incluye_iva',
];
for(const columns of directConsumers)assert.equal(JSON.parse(sql(actor(`select row_to_json(t) from(select ${columns} from productos where id='${own}')t`))).id,own,'minorista direct reader remains compatible');
for(const rol of ['owner','admin','seller','warehouse']){
  sql(`update empresa_usuarios set rol='${rol}',permisos_denegados='{}' where empresa_id='${E}' and user_id='${A}'`);
  assert.equal(sql(actor(`select count(id) from productos where id='${own}'`)),'1',rol+' own product allowed');
  assert.equal(sql(actor(`select count(id) from productos where id='${foreign}'`)),'0',rol+' foreign product hidden');
  assert.throws(()=>sql(actor(`select * from consultar_productos_sigo('${O}','arroz')`)),/FORBIDDEN/);
  const r=JSON.parse(sql(actor(`select row_to_json(t) from (select * from consultar_productos_sigo('${E}','INT-1',0,10,null,true))t`)));
  assert.equal(r.costo_actual,rol==='owner'?10:null,'RPC keeps permission masking');
}
sql(`update empresa_usuarios set rol='owner',permisos_denegados=array['products.read'] where empresa_id='${E}' and user_id='${A}'`);
assert.equal(sql(actor(`select count(id) from productos where id='${own}'`)),'0','explicit deny overrides owner');
assert.throws(()=>sql(actor(`select * from consultar_productos_sigo('${E}','arroz')`)),/FORBIDDEN/);
assert.equal(sql(actor(`select count(id) from productos where id='${own}'`,X)),'0','nonmember sees no rows');
assert.equal(sql(actor(`select count(id) from productos where id='${own}'`,'')),'0','null auth sees no rows');
sql(`update empresa_usuarios set permisos_denegados='{}' where empresa_id='${E}' and user_id='${A}'`);
assert.throws(()=>sql(`set role anon;select id from productos limit 1`),/permission denied/);
for(const role of ['anon','authenticated']){
  assert.equal(sql(`select has_table_privilege('${role}','productos','INSERT,UPDATE,DELETE,TRUNCATE')`),'f');
  assert.throws(()=>sql(`set role ${role};update productos set precio_venta=0 where false`),/permission denied/);
}
// Existing RPCs retain their definer access under the new policy/column ACL.
assert.equal(sql(actor(`select count(*) from buscar_producto_codigo_sigo('${E}','INT-1')`)),'1');
assert.equal(sql(actor(`select count(*) from listar_unidades_producto_sigo('${E}')`)),'50000');
assert.equal(countRows(),snapshot,'RLS application changes no commercial-shaped fixture rows');
sql(rollback);assert.equal(countRows(),snapshot,'rollback changes no rows');
sql(apply);assert.equal(countRows(),snapshot);
const status={status:'PASS',syntheticProductsPerTenant:50000,tenants:2,actualCandidate:folder+'02_APLICAR_PRODUCTOS_RLS_NO_AUTORIZADO.sql',cases:['owner/admin/seller/warehouse read only their company','explicit deny/null session/nonmember','anon and direct DML/TRUNCATE denied','old and new RPCs remain usable with permission masking','apply/rollback/reapply preserve every product row'],limitations:['Prepared RLS candidate was applied only to an explicitly isolated synthetic PostgreSQL fixture','Global production RLS and external/shared-table consumers require explicit scope review and authorization; no production gate is certified by this test']};
fs.mkdirSync('artifacts/catalogo121',{recursive:true});fs.writeFileSync('artifacts/catalogo121/rls.json',JSON.stringify(status,null,2));console.log(JSON.stringify(status,null,2));
