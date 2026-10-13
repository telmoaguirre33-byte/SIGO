import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { Client } = require("pg");
const client = new Client({ host:"127.0.0.1", port:55471, database:"mayorista_qa", user:"postgres", password:"mayorista_ci_only" });
const root = new URL("../../../../", import.meta.url);
const ean = await readFile(new URL("supabase/migrations/20260919083000_modulo_busqueda_ean_matriz.sql", root), "utf8");
const mayorista = await readFile(new URL("supabase/migrations/20261013090000_mayorista_modulo_matriz.sql", root), "utf8");
const updater = ean.split("-- Extiende la lectura de Matriz")[0];
const admin="20000000-0000-4000-8000-000000000001", empresaA="20000000-0000-4000-8000-000000000010", empresaB="20000000-0000-4000-8000-000000000020";
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
    CREATE TABLE public.empresas (id uuid PRIMARY KEY);
    CREATE TABLE public.sigo_modulos_catalogo (
      clave text PRIMARY KEY, nombre text NOT NULL, descripcion text NOT NULL,
      categoria text NOT NULL, disponible boolean NOT NULL, obligatorio boolean NOT NULL,
      orden integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.sigo_empresa_modulos (
      empresa_id uuid NOT NULL REFERENCES public.empresas(id),
      modulo_clave text NOT NULL REFERENCES public.sigo_modulos_catalogo(clave),
      habilitado boolean NOT NULL, actualizado_por uuid, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (empresa_id, modulo_clave)
    );
    CREATE FUNCTION public.es_superadmin_sigo() RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT current_setting('request.jwt.claim.superadmin', true) = 'true'
    $fn$;
    INSERT INTO public.empresas(id) VALUES ('${empresaA}'), ('${empresaB}');
  `);
  await client.query(updater);
  await client.query(mayorista);
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.superadmin','true',true)",[admin]);
  assert.equal((await client.query("SELECT count(*)::int n FROM public.sigo_modulos_catalogo WHERE clave='mayorista_distribuidora' AND disponible AND NOT obligatorio")).rows[0].n,1);
  assert.deepEqual((await client.query("SELECT empresa_id,mayorista_habilitado FROM public.matriz_listar_mayorista_modulos_sigo() ORDER BY empresa_id")).rows,[
    {empresa_id:empresaA,mayorista_habilitado:false},{empresa_id:empresaB,mayorista_habilitado:false}
  ]);
  const enabled=await client.query("SELECT public.matriz_actualizar_modulo_empresa_sigo($1,'mayorista_distribuidora',true)",[empresaA]);
  assert.equal(enabled.rows[0].matriz_actualizar_modulo_empresa_sigo,true);
  assert.deepEqual((await client.query("SELECT empresa_id,mayorista_habilitado FROM public.matriz_listar_mayorista_modulos_sigo() ORDER BY empresa_id")).rows,[
    {empresa_id:empresaA,mayorista_habilitado:true},{empresa_id:empresaB,mayorista_habilitado:false}
  ]);
  await client.query("SELECT public.matriz_actualizar_modulo_empresa_sigo($1,'mayorista_distribuidora',false)",[empresaA]);
  assert.equal((await client.query("SELECT bool_and(NOT mayorista_habilitado) all_off FROM public.matriz_listar_mayorista_modulos_sigo()")).rows[0].all_off,true);
  assert.equal((await client.query("SELECT has_function_privilege('authenticated','public.matriz_listar_mayorista_modulos_sigo()','EXECUTE')")).rows[0].has_function_privilege,true);
  await client.query("SELECT set_config('request.jwt.claim.superadmin','false',true)");
  await client.query("SAVEPOINT non_superadmin_check");
  await assert.rejects(()=>client.query("SELECT * FROM public.matriz_listar_mayorista_modulos_sigo()"),e=>String(e.message).includes("SUPERADMIN_REQUIRED"));
  await client.query("ROLLBACK TO SAVEPOINT non_superadmin_check");
  await client.query("RELEASE SAVEPOINT non_superadmin_check");
  await client.query("SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.superadmin','true',true)");
  await client.query("SAVEPOINT anonymous_check");
  await assert.rejects(()=>client.query("SELECT * FROM public.matriz_listar_mayorista_modulos_sigo()"),e=>String(e.message).includes("AUTH_REQUIRED"));
  await client.query("ROLLBACK TO SAVEPOINT anonymous_check");
  await client.query("RELEASE SAVEPOINT anonymous_check");
  console.log("PostgreSQL efímero: módulo apagado, activar/desactivar aislado por empresa y permisos de Superadmin aprobados.");
} finally {
  await client.query("ROLLBACK").catch(()=>{});
  await client.end();
}
