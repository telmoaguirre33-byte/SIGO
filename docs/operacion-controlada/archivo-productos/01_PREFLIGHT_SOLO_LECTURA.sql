-- Sólo metadatos, sin leer productos/ventas/compras reales.
select current_setting('server_version') as postgres_version;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
 and table_name in ('productos','venta_items_sigo','compra_items_sigo','devolucion_items_sigo')
 and column_name in ('id','empresa_id','producto_id','activo','archivado_comercial','stock_actual','unidad_medida','unidad_revision')
order by table_name,ordinal_position;
select p.oid::regprocedure as funcion,p.prosecdef,pg_get_function_result(p.oid) as resultado,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('listar_productos_sigo','listar_unidades_producto_sigo','portal_cliente_catalogo_sigo','tiene_permiso_empresa','proteger_producto_inactivo_sigo','sigo_validar_producto_movimiento','confirmar_venta_sigo_v2','registrar_devolucion_sigo','anular_compra_sigo');
select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definicion
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('productos','venta_items_sigo','compra_items_sigo') and not t.tgisinternal;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('productos','venta_items_sigo','compra_items_sigo');
