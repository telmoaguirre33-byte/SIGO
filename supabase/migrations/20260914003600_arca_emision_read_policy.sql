-- SIGO: quien puede emitir comprobantes debe poder leer la configuración fiscal
-- necesaria para preparar la emisión, sin obtener secretos PEM ni clave fiscal.
-- arca_config contiene sólo referencias opacas; los archivos privados continúan
-- protegidos en Storage y accesibles únicamente desde backend autenticado.

drop policy if exists arca_config_select on public.arca_config;
create policy arca_config_select on public.arca_config
for select to authenticated
using (
  public.tiene_permiso_empresa(empresa_id, 'arca.configure')
  or public.tiene_permiso_empresa(empresa_id, 'invoices.issue')
);

comment on policy arca_config_select on public.arca_config is
  'SIGO: configuración fiscal visible a configuradores o emisores; certificados/clave privada no viven en esta tabla.';
