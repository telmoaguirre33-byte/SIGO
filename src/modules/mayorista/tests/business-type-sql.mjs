import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
/** Solo se invoca en la segunda DB efímera de schema-package.mjs. */
export async function verifyBusinessTypeSQL(pool){
 if(pool.options.host!=='127.0.0.1'||Number(pool.options.port)!==55471||pool.options.database!=='mayorista_package_ci')throw new Error('Fixture empresarial fuera de CI');
 const E='30000000-0000-4000-8000-000000000001',B='30000000-0000-4000-8000-000000000002',U='30000000-0000-4000-8000-000000000011',OTHER='30000000-0000-4000-8000-000000000012';
 const sql=(await readFile(new URL('../../../../docs/mayorista/sql/005_integracion_empresa_NO_APLICAR.sql',import.meta.url),'utf8')).replace(/^begin;$/mi,'').replace(/^rollback;$/mi,'');
 await pool.query(`CREATE TABLE auth.users(id uuid primary key);CREATE TABLE public.empresas(id uuid primary key,activa boolean not null default true);
 CREATE TABLE public.empresa_usuarios(empresa_id uuid,user_id uuid,activo boolean,rol text);
 CREATE TABLE public.sigo_modulos_catalogo(clave text primary key,nombre text,descripcion text,categoria text,disponible boolean,obligatorio boolean,orden integer);
 CREATE TABLE public.sigo_empresa_modulos(empresa_id uuid,modulo_clave text,habilitado boolean,actualizado_por uuid,updated_at timestamptz,primary key(empresa_id,modulo_clave));
 CREATE FUNCTION public.es_superadmin_sigo() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${OTHER}'::uuid $$;${sql}`);
 await pool.query('INSERT INTO auth.users VALUES($1),($2);',[U,OTHER]);await pool.query('INSERT INTO public.empresas VALUES($1,true),($2,true)',[E,B]);await pool.query("INSERT INTO public.empresa_usuarios VALUES($1,$2,true,'owner')",[E,U]);
 const session=await pool.connect();
 try{
  const act=async(uid,fn)=>{await session.query('BEGIN');await session.query('SET LOCAL ROLE authenticated');await session.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);try{const r=await fn();await session.query('COMMIT');return r;}catch(e){await session.query('ROLLBACK');throw e;}};
  assert.equal((await act(U,()=>session.query('SELECT public.leer_tipo_negocio_sigo($1) AS tipo',[E]))).rows[0].tipo,'minorista');
  await act(U,()=>session.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[E,'mayorista']));assert.equal((await pool.query('SELECT habilitado FROM public.sigo_empresa_modulos WHERE empresa_id=$1',[E])).rows[0].habilitado,true);
  await pool.query('UPDATE public.sigo_empresa_modulos SET habilitado=false WHERE empresa_id=$1',[E]);
  await act(U,()=>session.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[E,'mayorista']));assert.equal((await pool.query('SELECT habilitado FROM public.sigo_empresa_modulos WHERE empresa_id=$1',[E])).rows[0].habilitado,false);
  await act(U,()=>session.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[E,'mixto']));assert.equal((await pool.query('SELECT habilitado FROM public.sigo_empresa_modulos WHERE empresa_id=$1',[E])).rows[0].habilitado,true);
  await assert.rejects(()=>act(U,()=>session.query('SELECT public.declarar_tipo_negocio_sigo($1,$2)',[B,'mayorista'])),/FORBIDDEN/);
  await assert.rejects(()=>act(U,()=>session.query('SELECT public.matriz_configurar_destino_mayorista_sigo($1,$2,true)',[E,'https://qa.test'])),/SUPERADMIN_REQUIRED/);
  await act(OTHER,()=>session.query('SELECT public.matriz_configurar_destino_mayorista_sigo($1,$2,true)',[E,'https://qa.test']));
  const access=(await act(U,()=>session.query('SELECT * FROM public.obtener_acceso_mayorista_sigo($1)',[E]))).rows[0];assert.equal(access.habilitado,true);assert.equal(access.administracion_url,'https://qa.test/portal.html');
  for(const table of ['sigo_empresa_tipo_negocio','sigo_mayorista_destinos','sigo_mayorista_activacion_auditoria'])await assert.rejects(()=>act(U,()=>session.query(`SELECT * FROM public.${table}`)),e=>e.code==='42501');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.sigo_mayorista_activacion_auditoria')).rows[0].n,6);
  assert.equal((await pool.query("SELECT has_function_privilege('anon','public.declarar_tipo_negocio_sigo(uuid,text)','EXECUTE') AS permitido")).rows[0].permitido,false);
 }finally{session.release();}
 console.log('PASS declaración Mayorista/Mixto, overrides Matriz persistentes, auditoría y permisos SQL');
 return [{name:'Tipo de negocio separado de flag/licencia; autorización y auditoría SQL',status:'pass'}];
}
