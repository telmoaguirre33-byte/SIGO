-- Credenciales y sesiones propias de Mayorista. Solo QA independiente autorizado.
create schema mayorista_private;
revoke all on schema mayorista_private from public,anon,authenticated;
create table mayorista_private.usuarios(user_id uuid primary key,email text unique not null,salt text not null,password_hash text not null,activo boolean not null default true);
create table mayorista_private.sesiones(session_id uuid primary key,user_id uuid not null references mayorista_private.usuarios,empresa_id uuid not null,vence_en timestamptz not null,revocada boolean not null default false);
create index sesiones_usuario_empresa on mayorista_private.sesiones(user_id,empresa_id);
