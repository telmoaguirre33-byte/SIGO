import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import pg from '../backend/node_modules/pg/lib/index.js';
import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {prepareCommercialMigrations,applyCommercialMigrationTransaction} from '../backend/commercial-migrations.mjs';
import {createIsolatedService} from '../backend/service.mjs';
// Únicamente PostgreSQL efímero CI. Sin URLs de entorno, Railway ni Supabase.
const pool=new pg.Pool({host:'127.0.0.1',port:55471,database:'mayorista_qa',user:'postgres',password:'mayorista_ci_only',max:2});
const name='mayorista_acceptance_'+randomBytes(6).toString('hex'),fixture=acceptanceNamespace(pool,name),role='migration_ci_'+randomBytes(6).toString('hex');
const profile={databaseName:'mayorista_qa',migrationRole:'postgres',runtimeRole:role,projectId:'isolated-ci',environmentId:'ephemeral'},profileHash=createHash('sha256').update(name).digest('hex');
const steps=await prepareCommercialMigrations(role),results=[];
const run=async(plan=steps)=>{const c=await fixture.connect();try{return await applyCommercialMigrationTransaction(c,{profile,profileHash,steps:plan});}finally{c.release();}};
const migration=async(name)=>(await readFile(new URL('../../../../supabase/migrations/'+name,import.meta.url),'utf8'));
const snapshot=async()=>JSON.stringify((await fixture.query(`SELECT (SELECT jsonb_agg(t ORDER BY id) FROM public.empresas t) companies,(SELECT jsonb_agg(t ORDER BY id) FROM public.productos t) products,(SELECT jsonb_agg(t ORDER BY id) FROM public.clientes_sigo t) clients`)).rows);
try{
 await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
 await fixture.query(`CREATE SCHEMA public;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated;
 CREATE TABLE auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 CREATE TABLE auth.sessions(id uuid primary key,user_id uuid);
 CREATE TABLE public.empresas(id uuid primary key,activa boolean not null default true);
 CREATE TABLE public.empresa_usuarios(empresa_id uuid,user_id uuid,activo boolean,rol text);
 CREATE TABLE public.sigo_modulos_catalogo(clave text primary key,nombre text,descripcion text,categoria text,disponible boolean,obligatorio boolean,orden integer);
 CREATE TABLE public.sigo_empresa_modulos(empresa_id uuid,modulo_clave text,habilitado boolean,actualizado_por uuid,updated_at timestamptz,primary key(empresa_id,modulo_clave));
 CREATE FUNCTION public.es_superadmin_sigo() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE FUNCTION public.tiene_permiso_empresa(e uuid,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.empresa_usuarios WHERE empresa_id=e AND user_id=auth.uid() AND activo AND rol IN ('owner','admin'))$$;
 CREATE TABLE public.productos(id uuid primary key,empresa_id uuid,nombre text,precio_venta numeric(14,2),stock_actual numeric(14,3),activo boolean,marca text,codigo_interno text,codigo_barras text);`);
 await fixture.query((await migration('20260911043000_ventas_caja_operativas.sql')).split('create or replace function public.confirmar_venta_sigo')[0]+(await migration('20260911062000_clientes_cuenta_corriente.sql')).split('create or replace function public.registrar_cobro_cliente_sigo(')[0]);
 await fixture.query(`ALTER TABLE public.ventas_sigo ADD request_fingerprint text;CREATE TABLE public.ofertas_productos_sigo(empresa_id uuid,producto_id uuid,descuento_porcentaje numeric,fecha_inicio date,fecha_fin date);`);
 await fixture.query(await migration('20260911112000_cobros_cuenta_corriente_caja.sql'));
 await fixture.query(await migration('20260913205500_carrito_devoluciones_anulaciones.sql'));
 // Registros Minorista preexistentes: deben permanecer idénticos, sin habilitar Mayorista.
 await fixture.query(`INSERT INTO public.empresas VALUES('10000000-0000-4000-8000-000000000001',true);INSERT INTO auth.users(id,email) VALUES('10000000-0000-4000-8000-000000000002','fixture@invalid.test');INSERT INTO public.productos VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Producto Minorista existente',123.45,17,true,'Marca','001','779001');INSERT INTO public.clientes_sigo(id,empresa_id,nombre,limite_credito,created_by) VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Cliente Minorista existente',1000,'10000000-0000-4000-8000-000000000002');`);
 const before=await snapshot();
 // Fallo real PostgreSQL después de ejecutar 20 versiones: rollback también del DDL/ledger.
 const broken=steps.map(s=>s.version===21?{...s,sql:s.sql+';SELECT * FROM missing_relation_for_rollback;'}:s);
 await assert.rejects(()=>run(broken),e=>e.code==='42P01');
 assert.deepEqual((await fixture.query("SELECT to_regnamespace('mayorista') operational,to_regnamespace('mayorista_private') private")).rows[0],{operational:null,private:null});
 assert.equal(await snapshot(),before);results.push('rollback PostgreSQL tras fallo en versión 21 conserva datos y revierte DDL');
 assert.deepEqual(await run(),{installed:21,reused:false,seeded:false});assert.equal(await snapshot(),before);
 // Rechazo real de la función versionada: 403, sin crear identidad ni sesión.
 const deniedBefore=(await fixture.query('SELECT (SELECT count(*) FROM mayorista_private.usuarios) users,(SELECT count(*) FROM mayorista_private.sesiones) sessions')).rows;
 const deniedService=createIsolatedService({enabled:true,pool:fixture,origin:'https://commercial-ci.invalid',operational:true,sharedSourceEnabled:true,commercialMode:true,sourceRevision:'a'.repeat(40),databasePolicy:{assertPool:p=>assert.equal(p,fixture)},rateLimit:async()=>true,authenticateSigo:async()=>({id:'10000000-0000-4000-8000-000000000002',email:'fixture@invalid.test'})});
 const deniedResponse=await deniedService(new Request('https://commercial-ci.invalid/auth/sigo',{method:'POST',headers:{Origin:'https://commercial-ci.invalid','Content-Type':'application/json',Authorization:'Bearer fixture-validated-by-provider'},body:JSON.stringify({empresaId:'10000000-0000-4000-8000-000000000001'})}));
 assert.equal(deniedResponse.status,403);assert.deepEqual(await deniedResponse.json(),{error:'Sin permisos'});assert.deepEqual((await fixture.query('SELECT (SELECT count(*) FROM mayorista_private.usuarios) users,(SELECT count(*) FROM mayorista_private.sesiones) sessions')).rows,deniedBefore);assert.equal(await snapshot(),before);
 results.push('SSO comercial denegado por PostgreSQL devuelve 403 sin crear identidad o sesión');
 const ledger=(await fixture.query('SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version')).rows;
 assert.deepEqual(ledger,steps.map(s=>({version:s.version,source_hash:s.sourceHash})));
 assert.deepEqual(await run(),{installed:21,reused:true,seeded:false});assert.equal(await snapshot(),before);
 assert.deepEqual((await fixture.query('SELECT version,source_hash FROM mayorista_private.release_migrations ORDER BY version')).rows,ledger);
 results.push('21 versiones instaladas y repetición no-op con hashes idénticos');
 assert.equal((await fixture.query('SELECT count(*)::int n FROM mayorista.pedidos')).rows[0].n,0);
 assert.equal((await fixture.query('SELECT count(*)::int n FROM public.sigo_empresa_tipo_negocio')).rows[0].n,0);
 const policies=(await fixture.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=\'r\'',[fixture.schemas.mayorista])).rows;
 assert.ok(policies.length>=20&&policies.every(p=>p.relrowsecurity&&p.relforcerowsecurity));
 results.push('Minorista intacto, sin siembra ni activación; RLS forzada');
 await fixture.query("UPDATE mayorista_private.release_migrations SET source_hash=repeat('0',64) WHERE version=1");
 await assert.rejects(()=>run(),/MIGRATION_LEDGER_DRIFT/);assert.equal(await snapshot(),before);
 await fixture.query('UPDATE mayorista_private.release_migrations SET source_hash=$1 WHERE version=1',[steps[0].sourceHash]);
 await fixture.query('DELETE FROM mayorista_private.release_migrations WHERE version=21');await assert.rejects(()=>run(),/MIGRATION_LEDGER_DRIFT/);
 results.push('rechazo de drift y ledger parcial sin ejecutar migraciones');
 console.log('PASS migraciones comerciales PostgreSQL real: '+results.join('; '));
}finally{
 // Sólo esquemas efímeros aleatorios creados por este ensayo y rol propio.
 for(const schema of [fixture.schemas.mayorista_private,fixture.schemas.mayorista,fixture.schemas.public,fixture.schemas.auth])await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
 await pool.query('DROP OWNED BY '+role);await pool.query('DROP ROLE '+role);await pool.end();
 await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/commercial-migrations-postgres.json',import.meta.url),JSON.stringify({target:'CI localhost:55471/mayorista_qa',namespace:name,results,productionApplied:false,railwayApplied:false},null,2));
}
