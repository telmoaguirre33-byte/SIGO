// Isolated PostgreSQL 17 regression; NEVER points at Supabase or business data.
// Uses actual repository RPC definitions, with minimal fixture tables/auth/ACL.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
if (process.env.SIGO_ISOLATED_TEST_DB !== '1' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'sigo_guardado_qa') throw new Error('Isolated local test database required');
const sql = input => execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding:'utf8', stdio:['pipe','pipe','pipe'] });
if (sql("select count(*) from pg_tables where schemaname='public';").trim() !== '0') throw new Error('Test database must be empty; refusing to modify it');
function actualFunction(path, name) {
  const source = fs.readFileSync(path, 'utf8');
  const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$[\\s\\S]*?\\$\\$;`, 'i');
  const match = source.match(re);
  if (!match) throw new Error(`Cannot locate actual function ${name}`);
  return match[0];
}
const fixture = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create table public.qa_perms(perm text primary key, allowed boolean not null);
create function public.tiene_permiso_empresa(e uuid, p text) returns boolean language sql stable as $$
 select auth.uid() is not null and e='11111111-1111-4111-8111-111111111111'::uuid and coalesce((select allowed from public.qa_perms where perm=p),true)$$;
create table public.productos (
 id uuid primary key default gen_random_uuid(),empresa_id uuid not null,activo boolean default true,
 codigo_interno text,codigo_barras text,nombre text,descripcion text,categoria text,marca text,proveedor text,
 costo_actual numeric default 0,costo_ultima_compra numeric default 0,precio_venta numeric default 0,
 margen_ganancia numeric default 0,margen_porcentaje numeric default 0,
 stock_actual numeric default 0,stock_minimo numeric default 0,stock_maximo numeric default 0,
 unique(empresa_id,codigo_interno),unique(empresa_id,codigo_barras));
create table public.proveedores_sigo(id uuid primary key default gen_random_uuid(),empresa_id uuid not null,razon_social text not null,cuit text,activo boolean default true,unique(empresa_id,cuit));
create table public.compras_sigo(id uuid primary key default gen_random_uuid(),empresa_id uuid not null,proveedor_id uuid references public.proveedores_sigo,fecha_compra date,
 tipo_comprobante text,numero_comprobante text,subtotal numeric,total numeric,estado text,origen text,idempotency_key text,request_fingerprint text,created_by uuid,created_at timestamptz default now(),unique(empresa_id,idempotency_key));
create table public.compra_items_sigo(compra_id uuid references public.compras_sigo,empresa_id uuid,producto_id uuid references public.productos,cantidad numeric,costo_unitario numeric,subtotal numeric);
create function public.qa_assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'QA: %',msg; end if; end$$;
create function public.qa_doc(prefix text,n integer,receipt text default null) returns jsonb language sql as $$
 select jsonb_build_object('proveedor_nombre','Proveedor QA','fecha','2026-09-25','numero_comprobante',receipt,'tipo_comprobante','Remito',
 'items',jsonb_agg(jsonb_build_object('nombre',prefix||i,'cantidad',6,'costo_unitario',100,'precio_venta',150,'codigo_barras',null,'codigo_interno',null))) from generate_series(1,n) i$$;
grant usage on schema public,auth to authenticated;
`;
const tests = `
select set_config('qa.uid','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
select public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','seven',public.qa_doc('Siete ',7,'R-01'));
reset role;
select public.qa_assert((select count(*)=7 and bool_and(codigo_interno like 'SIGO-%' and codigo_barras is null and stock_actual=6 and precio_venta=150 and costo_actual=100) from productos),'7 new products: internal code, no EAN, stock/cost/price');
select public.qa_assert((select count(distinct codigo_interno)=7 from productos),'unique generated internal codes');
select public.qa_assert((select count(*)=1 and bool_and(origen='ia' and total=4200) from compras_sigo),'purchase header and total');
select public.qa_assert((select count(*)=7 from compra_items_sigo),'purchase details');
select public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','seven',public.qa_doc('Siete ',7,'R-01'));
select public.qa_assert((select count(*)=7 and sum(stock_actual)=42 from productos),'same-key retry does not duplicate stock/products');
do $$begin
 begin perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','seven',public.qa_doc('Changed ',7,'R-01')); raise exception 'QA expected conflict';
 exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
 begin perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','duplicate',public.qa_doc('Duplicate ',7,'R01')); raise exception 'QA expected duplicate';
 exception when raise_exception then if sqlerrm<>'PURCHASE_DOCUMENT_DUPLICATE' then raise; end if; end;
end$$;
select public.qa_assert((select count(*)=7 from productos),'conflicts leave products unchanged');
-- Missing document number must not block 15/30 new products.
select public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','fifteen',public.qa_doc('Quince ',15));
select public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','thirty',public.qa_doc('Treinta ',30));
select public.qa_assert((select count(*)=52 from productos),'15 and 30 lines accepted without codes or number');
-- A known product keeps its code, updates stock exactly once and retains the existing cost/price rule.
do $$declare d jsonb; p productos%rowtype; r jsonb; begin
 select * into p from productos where nombre='Siete 1';
 d:=public.qa_doc('Siete ',1,'R02');
 d:=jsonb_set(d,'{items,0,producto_id}',to_jsonb(p.id::text));
 d:=jsonb_set(d,'{items,0,codigo_interno}','"WRONG-VENDOR-CODE"');
 d:=jsonb_set(d,'{items,0,costo_unitario}','120');
 perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','existing',d);
 perform public.qa_assert((select codigo_interno=p.codigo_interno and stock_actual=12 and costo_actual=120 and precio_venta=180 from productos where id=p.id),'existing code, stock, automatic sale price');
 -- Two lines matching the same product are one purchase item, not a second catalog entry.
 d:=public.qa_doc('Siete ',1,'R03'); d:=jsonb_set(d,'{items}',(d->'items')||(d->'items'));
 r:=public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','repeated-lines',d);
 perform public.qa_assert(jsonb_array_length(r->'items')=1 and (r#>>'{items,0,cantidad}')::numeric=12,'same product lines consolidated');
end$$;
-- Later-line failure must roll back even the earlier newly-created product and supplier.
do $$declare d jsonb; np integer; ns integer; nc integer; begin
 select count(*) into np from productos; select count(*) into ns from proveedores_sigo; select count(*) into nc from compras_sigo;
 d:=jsonb_set(public.qa_doc('Rollback ',2),'{proveedor_nombre}','"Nuevo proveedor rollback"');
 d:=jsonb_set(d,'{items,1,precio_venta}','1');
 begin perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','rollback',d); raise exception 'QA expected invalid item';
 exception when raise_exception then if sqlerrm<>'INVALID_ITEM' then raise; end if; end;
 perform public.qa_assert((select count(*)=np from productos) and (select count(*)=ns from proveedores_sigo) and (select count(*)=nc from compras_sigo),'atomic rollback of supplier/products/purchase');
end$$;
-- Auth, tenant isolation and current permission checks on both first save and retry.
insert into qa_perms values('stock.read',false);
select public.qa_assert((public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','seven',public.qa_doc('Siete ',7,'R-01'))#>'{items,0,stock_antes}')='null'::jsonb,'retry does not leak stock after permission change');
insert into qa_perms values('stock.write',false);
do $$begin
 begin perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','seven',public.qa_doc('Siete ',7,'R-01')); raise exception 'QA expected stock permission';
 exception when raise_exception then if sqlerrm<>'STOCK_WRITE_REQUIRED' then raise; end if; end;
end$$;
delete from qa_perms;
do $$begin
 begin perform public.guardar_compra_ia_sigo('99999999-9999-4999-8999-999999999999','other-tenant',public.qa_doc('Other ',1)); raise exception 'QA expected forbidden';
 exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end$$;
select set_config('qa.uid','',false);
do $$begin
 begin perform public.guardar_compra_ia_sigo('11111111-1111-4111-8111-111111111111','no-auth',public.qa_doc('Auth ',1)); raise exception 'QA expected auth';
 exception when raise_exception then if sqlerrm<>'AUTH_REQUIRED' then raise; end if; end;
end$$;
select public.qa_assert(not has_table_privilege('authenticated','public.compra_ia_confirmaciones','SELECT'),'request ledger inaccessible directly');
select public.qa_assert(not has_function_privilege('anon','public.guardar_compra_ia_sigo(uuid,text,jsonb)','EXECUTE'),'anonymous RPC execution revoked');
select 'PASS: PostgreSQL atomic save, 7/15/30 lines, code reuse, new price, retry, conflicts, rollback, permissions';
`;
try {
 const result = sql(fixture + '\n' + actualFunction('supabase/migrations/20260912235500_productos_alta_costos_cero.sql','guardar_producto_sigo') + '\n' + actualFunction('supabase/migrations/20260922233000_compras_precio_automatico.sql','confirmar_compra_sigo') + '\n' + fs.readFileSync('supabase/migrations/20260925120000_compra_ia_guardado_atomico.sql','utf8') + '\n' + tests);
 console.log(result.split('\n').filter(l=>l.startsWith('PASS:')).join('\n'));
} catch (err) { console.error(err.stderr?.toString() || err.message); process.exit(1); }
