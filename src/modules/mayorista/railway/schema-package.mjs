import {readFile} from 'node:fs/promises';
/** Todas las plantillas son propias y se preparan como una única transacción QA.
 * El llamador comprueba identidad de infraestructura y DB vacía antes de ejecutar. */
export async function schemaPackage(){
 const root=new URL('../',import.meta.url),docs=new URL('../../../../docs/mayorista/sql/',import.meta.url);
 const files=[new URL('002_seguridad_preparada_NO_APLICAR.sql',docs),new URL('003_flujo_administrativo_NO_APLICAR.sql',docs),new URL('004_administracion_NO_APLICAR.sql',docs),new URL('cargas/schema-qa.sql',root),new URL('commercial/visits-schema-qa.sql',root),new URL('commercial/inventory-schema-qa.sql',root),new URL('commercial/accounts-schema-qa.sql',root),new URL('railway/private-auth-schema.sql',root),new URL('commercial/roles-schema-qa.sql',root),new URL('commercial/master-schema-qa.sql',root),new URL('commercial/collections-schema-qa.sql',root)];
 files.push(new URL('commercial/goals-schema-qa.sql',root));
 const parts=await Promise.all(files.map(async u=>(await readFile(u,'utf8')).replace(/^begin;.*$/gmi,'').replace(/^rollback;.*$/gmi,'')));
 return `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname in ('anon','authenticated') AND (rolcanlogin OR rolbypassrls OR rolsuper)) THEN RAISE EXCEPTION 'Roles QA no seguros'; END IF;END $$;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;\n${parts.join('\n')}
 CREATE TABLE mayorista_private.infrastructure_binding(id boolean primary key default true check(id),project_id text not null,environment_id text not null,schema_version integer not null);
 REVOKE ALL ON mayorista_private.infrastructure_binding FROM PUBLIC,anon,authenticated;`;
}
