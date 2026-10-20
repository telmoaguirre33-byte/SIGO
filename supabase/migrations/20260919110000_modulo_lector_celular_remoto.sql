-- SIGO: módulo premium opcional para usar un celular como lector remoto.
-- Opt-in por empresa; no modifica scanner, ventas, stock ni módulos existentes.

insert into public.sigo_modulos_catalogo
  (clave,nombre,descripcion,categoria,disponible,obligatorio,orden)
values
  ('lector_celular_remoto','Lector celular remoto',
   'Vincula un teléfono a SIGO para usar su cámara como lector inalámbrico de códigos de barras.',
   'Catálogo / Integraciones',true,false,130)
on conflict (clave) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  categoria=excluded.categoria,
  disponible=excluded.disponible,
  obligatorio=excluded.obligatorio,
  orden=excluded.orden,
  updated_at=now();

insert into public.sigo_empresa_modulos (empresa_id,modulo_clave,habilitado)
select e.id,'lector_celular_remoto',false from public.empresas e
on conflict (empresa_id,modulo_clave) do nothing;

comment on table public.sigo_empresa_modulos is
  'SIGO: módulos opcionales por empresa, incluidos EAN y lector celular remoto.';
