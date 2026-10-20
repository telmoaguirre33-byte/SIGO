# SIGO — Sistema Inteligente de Gestión Operativa

## Objetivo
SIGO es una plataforma de gestión operativa y comercial moderna, visual y multiempresa. Debe servir tanto para el negocio propio como para ofrecer el sistema a comercios y empresas independientes.

## Principios obligatorios
- Arquitectura multiempresa (tenant): los datos de cada empresa deben permanecer aislados.
- Un usuario puede pertenecer a una o más empresas solo si fue autorizado.
- Todo registro comercial sensible debe estar asociado a una empresa.
- La interfaz debe sentirse como una app moderna, no como una planilla Excel.
- El propietario/superadmin puede administrar empresas, usuarios, permisos y configuración.

## Roles iniciales
### Superadmin / Propietario
- Acceso total a todas las empresas habilitadas.
- Alta, baja y suspensión de empresas.
- Alta y baja de usuarios.
- Configuración de permisos por usuario/rol.
- Acceso a costos, precios, márgenes, compras, ventas e informes.

### Administrador de empresa
- Gestión completa de su empresa según permisos otorgados.
- No accede a otras empresas.

### Administrativo
- Acceso operativo limitado.
- Por defecto NO puede ver costos, listas de precios sensibles, márgenes ni rentabilidad.
- Puede recibir permisos específicos otorgados por el propietario.

### Vendedor / Operador
- Acceso a ventas, clientes y operaciones asignadas.
- Sin acceso a costos, márgenes ni configuración sensible salvo autorización.

## Permisos granulares sugeridos
- ver_productos
- editar_productos
- ver_stock
- ajustar_stock
- ver_costos
- ver_precios_venta
- editar_precios
- ver_margenes
- ver_compras
- crear_compras
- ver_ventas
- crear_ventas
- ver_clientes
- editar_clientes
- ver_proveedores
- editar_proveedores
- ver_informes
- ver_rentabilidad
- administrar_usuarios
- administrar_empresa

## Módulos funcionales
1. Inicio / tablero ejecutivo
2. Productos
3. Stock
4. Compras
5. Ventas
6. Clientes
7. Proveedores
8. Informes
9. Facturación
10. Escaneo de facturas con IA
11. Usuarios y permisos
12. Empresas / suscripciones

## Tablero
Debe reemplazar el aspecto de planilla por una experiencia visual moderna con:
- KPIs principales
- ventas del día / semana / mes
- margen y rentabilidad solo para usuarios autorizados
- stock crítico y oportunidades de reposición
- compras recientes
- productos más vendidos
- evolución de ventas
- alertas operativas
- accesos rápidos
- diseño responsive para celular, tablet y PC

## Regla de seguridad
Ocultar datos sensibles solo en la interfaz NO es suficiente. Los permisos deben aplicarse también a nivel de acceso a datos (Supabase/RLS o capa de backend), evitando que un usuario sin permiso pueda recuperar costos, márgenes o datos de otra empresa mediante consultas directas.

## Carga de productos
Los productos que entregue el propietario deben cargarse dentro de la empresa correspondiente y nunca quedar como catálogo global visible para otros clientes, salvo que en el futuro se diseñe explícitamente un catálogo maestro separado.
