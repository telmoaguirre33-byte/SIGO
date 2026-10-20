\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.empresas (
  id uuid PRIMARY KEY, nombre text NOT NULL, razon_social text, cuit text,
  activa boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.empresa_usuarios (
  empresa_id uuid NOT NULL, user_id uuid NOT NULL, rol text NOT NULL,
  activo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sigo_soporte_sesiones (
  empresa_id uuid NOT NULL, superadmin_user_id uuid NOT NULL, finalizado_at timestamptz
);
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
INSERT INTO public.empresas(id,nombre) VALUES
  ('20000000-0000-4000-8000-000000000010','Empresa QA A'),
  ('20000000-0000-4000-8000-000000000020','Empresa QA B');

\i supabase/migrations/20260919083000_modulo_busqueda_ean_matriz.sql
\i supabase/migrations/20261013090000_mayorista_modulo_matriz.sql

DO $$ BEGIN
  IF NOT has_function_privilege('authenticated','public.matriz_listar_mayorista_modulos_sigo()','EXECUTE') THEN RAISE EXCEPTION 'AUTHENTICATED_EXECUTE_REQUIRED'; END IF;
  IF has_function_privilege('anon','public.matriz_listar_mayorista_modulos_sigo()','EXECUTE') THEN RAISE EXCEPTION 'ANON_MUST_NOT_EXECUTE'; END IF;
  IF EXISTS (
    SELECT 1 FROM aclexplode((SELECT coalesce(proacl,acldefault('f',proowner)) FROM pg_proc WHERE oid='public.matriz_listar_mayorista_modulos_sigo()'::regprocedure))
    WHERE grantee=0 AND privilege_type='EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC_MUST_NOT_EXECUTE'; END IF;
  IF (SELECT count(*) FROM public.sigo_modulos_catalogo WHERE clave='mayorista_distribuidora' AND disponible AND NOT obligatorio) <> 1 THEN RAISE EXCEPTION 'OPTIONAL_CATALOG_ENTRY_REQUIRED'; END IF;
  IF (SELECT count(*) FROM public.sigo_empresa_modulos WHERE modulo_clave='mayorista_distribuidora' AND NOT habilitado) <> 2 THEN RAISE EXCEPTION 'DEFAULT_OFF_REQUIRED'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.superadmin','true',true);
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.matriz_listar_mayorista_modulos_sigo() WHERE NOT mayorista_habilitado;
  IF n <> 2 THEN RAISE EXCEPTION 'INITIAL_STATE_WRONG'; END IF;
END $$;
SELECT public.matriz_actualizar_modulo_empresa_sigo('20000000-0000-4000-8000-000000000010','mayorista_distribuidora',true);
DO $$ BEGIN
  IF NOT (SELECT mayorista_habilitado FROM public.matriz_listar_mayorista_modulos_sigo() WHERE empresa_id='20000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'ENABLE_FAILED'; END IF;
  IF (SELECT mayorista_habilitado FROM public.matriz_listar_mayorista_modulos_sigo() WHERE empresa_id='20000000-0000-4000-8000-000000000020') THEN RAISE EXCEPTION 'TENANT_ISOLATION_FAILED'; END IF;
END $$;
SELECT public.matriz_actualizar_modulo_empresa_sigo('20000000-0000-4000-8000-000000000010','mayorista_distribuidora',false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.matriz_listar_mayorista_modulos_sigo() WHERE mayorista_habilitado) THEN RAISE EXCEPTION 'DISABLE_FAILED'; END IF;
END $$;
SELECT set_config('request.jwt.claim.superadmin','false',true);
DO $$ BEGIN
  BEGIN PERFORM * FROM public.matriz_listar_mayorista_modulos_sigo(); RAISE EXCEPTION 'NON_SUPERADMIN_WAS_ALLOWED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'SUPERADMIN_REQUIRED' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.superadmin','true',true);
DO $$ BEGIN
  BEGIN PERFORM * FROM public.matriz_listar_mayorista_modulos_sigo(); RAISE EXCEPTION 'ANONYMOUS_WAS_ALLOWED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'AUTH_REQUIRED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
