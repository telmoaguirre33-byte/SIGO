# Ampliación gerencial y enlace modular de Mayorista

Base: rama `feat/mayorista-distribuidora-offline-20261012`, PR #72, HEAD `64196a52bf3f7caf750adbe3bbfbd63b1f6bb3aa`. Recuperación exacta de 476 blobs y del árbol Git; sin revertir ni reemplazar desarrollos aprobados.

## Cambios conectados

- Panel Mayorista por API autenticada `/admin/dashboard`, dentro del portal operativo existente. Hoy, semana, mes, desde/hasta, vendedor, ruta y zona. Indicadores, rendimiento de vendedores, entregas por día/ruta/zona, rotación por unidades entregadas y alertas.
- Pedido recibido, venta confirmada, entrega, factura y cobro son fuentes diferentes. Una rendición presentada no se suma como cobro; se contabiliza su asiento al revisar. Entregas/devoluciones conservan fecha de evento y centavos de cada movimiento. Sin una fuente de SIGO confirmada, ventas, facturación, margen y vencimientos se muestran **sin datos confirmados**, nunca como cero ni como importe de pedidos.
- Metas por empresa o vendedor, diez métricas, períodos diario/semanal/mensual/personalizado. Objetivo, real, porcentaje y falta. Versiones, UUID e idempotencia; RLS oculta metas de empresa y de otros vendedores. Los resultados propios descargados se guardan en el catálogo cifrado existente y se consultan offline con fecha de referencia.
- Menú operativo: Panel, pedidos, vendedores/clientes/rutas, objetivos, administración, depósito, cargas, reparto, entregas, rendiciones, cuentas, usuarios e informes. Se reutilizan comandos y modelos del circuito ya implementado.
- Configuración SIGO obtiene destino/flag por RPC autenticada y abre el portal en el componente modular; oculta el acceso sin flag. Inicio Mayorista exige la empresa activa de SIGO; no envía tokens SIGO por URL ni por almacenamiento local. El servidor conserva permisos y RLS, con origen HTTPS adicional solo si fue configurado explícitamente.
- Declaración Minorista/Mayorista/Mixto: propuesta SQL aditiva y componente de configuración. Mayorista/Mixto habilitan el flag de PR #73; declarar nuevamente el mismo tipo conserva una desactivación posterior de Matriz. Auditoría, destinos solo por Matriz y suscripción separada. No cambia las RPC existentes de módulos ni crea stock/productos/facturas/cuentas.
- Recepción física clasifica devoluciones: vendible, averiada o revisión. Sin clasificación explícita quedan en revisión y **no aumentan el inventario vendible**. La inspección y el reingreso conservan idempotencia. No toca el módulo Devoluciones compartido de SIGO.
- Vendedor: revisión visible de cliente, artículos, unidades base, precio, subtotal y total antes de guardar. Conserva buscador/frecuentes/lector aprobado; no añade otro buscador.

## Inventario y límites reales

| Requisito | Base reutilizada / estado actual |
|---|---|
| Autenticación, cinco roles, revocación, empresa, RLS | Backend y esquemas QA existentes; ampliación protegida con los mismos principales |
| Offline, catálogo, pedidos, visitas, UUID, cifrado, reintentos | Implementación existente preservada |
| Búsqueda 5.000 productos, parciales/tildes, frecuentes, teclado/lector | Implementación existente; prueba local con 5.000 artículos aprobada |
| Pedidos, aprobación, picking, faltantes, cargas, entregas, rendición | Circuito API/PostgreSQL QA existente, reutilizado por navegación |
| Panel y objetivos | Código conectado y pruebas nuevas; ampliación SQL QA pendiente de aplicación |
| Tipo de negocio, activación y portal dentro de SIGO | Código y propuesta SQL; no aplicados/publicados en producción |
| Stock único, productos/clientes compartidos, cuenta corriente y ARCA compartidos | **Pendiente**: el runtime QA conserva maestros/inventario/libro propios. El enlace visual no sustituye esta integración |
| Crédito, deuda vencida y autorizaciones comerciales completas | **Pendiente**: necesita fuente compartida y autorización persistente ligada a recepción/aprobación |
| Todas las presentaciones configurables, descuentos por volumen y notas completas | **Parcial**: se conserva unidad/pack/caja/bulto, listas/ofertas existentes; no se declara terminado |
| Vehículos, calendario/orden de rutas, ficha completa de clientes, sustituciones y estados comerciales completos | **Pendiente** sobre los modelos existentes |
| Dos Android, GPS/lector/impresora físicos y aceptación del circuito completo | **Pendiente**; no reemplazado por pruebas de escritorio |

No se declara el objetivo comercial completo ni habilitado en producción.

## Instalación puntual, sin repetir infraestructura

La base persistente existente sigue con el binding QA versión 1. El paquete para bases vacías incorpora `goals-schema-qa.sql`, pero **no debe reinstalarse la base actual**.

Para ampliar QA, revisar y ejecutar `backend/upgrade-management-qa.mjs` con las variables privadas ya configuradas. Comprueba el binding existente y TLS/política QA, usa un bloqueo transaccional, crea únicamente `mayorista.metas` si falta y verifica RLS. No ejecutado en Railway en esta sesión.

`docs/mayorista/sql/005_integracion_empresa_NO_APLICAR.sql` es una propuesta para la base SIGO, con rollback al final. Se prueba en la segunda base efímera de CI; no está en el directorio de migraciones automáticas. Debe validarse antes de aplicar una migración real. No configurar un destino comercial hacia empresas QA sin haber vinculado identidades y datos.

`MAYORISTA_SIGO_ORIGIN` amplía CORS a un único origen HTTPS exacto; ausente conserva el comportamiento anterior. La disponibilidad del destino queda desactivada hasta configuración explícita de Matriz. No se agregan secretos al repositorio.

## Evidencia local y comprobaciones pendientes

- Build aislado Mayorista generado con Node 24, sin sustitución de `tsc`.
- Pruebas de cálculos gerenciales y devoluciones: 13 aprobadas; pedido/venta/entrega/factura/cobro separados, devoluciones/centavos, fechas/filtros, metas, CORS y escape de HTML.
- Pruebas existentes ejecutadas: administración, cargas, HTTP/auth, seguridad, roles, política QA, recuperación, flujo individual, rendiciones e integración PWA. El control de integración verifica que el código compartido anterior conserva su hash al retirar las adiciones Mayorista.
- Chromium y TLS local bloqueados por `listen EPERM` en el sandbox. La solicitud de permiso técnico fue interrumpida, no aprobada. No se repite ni se certifica su ejecución.
- Proxy de red del ejecutor sin conexión: no permitió instalar dependencias. TypeScript, build SIGO, PostgreSQL y Chromium deben confirmarse en CI del nuevo commit; sus aprobaciones anteriores pertenecen al HEAD base.
- Fixtures nuevos: API de panel/metas y RLS, calendario/activación automática/Matriz/auditoría en DB efímera. Sin consultas de escritura a la base comercial real.

La única consulta a la base comercial fue lectura de nombres/tipos de columnas. No se ejecutaron migraciones remotas, bootstrap, `/health`, cambios de infraestructura, merge ni despliegue.

## CI de la ampliación verificada

Código `0f7a5f50d10a0d4d32e05a725646452bc8fe3568`: [CI Mayorista aprobada](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38606015047), TypeScript, build, pruebas Node, RLS, **89 controles API/PostgreSQL**, **53 pruebas Chromium**, compilación Docker y runtime desactivado por defecto. Incluye creación de objetivos y Panel Mayorista desde Chromium, y declaración/activación/Matriz/auditoría en la segunda base efímera. Estos grupos contienen controles solapados; no sumarlos como controles independientes.

[Build SIGO aprobado](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38606015178). Compras conserva el fallo previo `150 !== null`, fuera del alcance. Esta evidencia no equivale a aplicación SQL, integración transaccional compartida ni aceptación Railway/Android.

Revisión posterior: navegación anclada dentro del portal, sin desplazamiento horizontal; filtros compactos y botones de tamaño normal. La nueva prueba Chromium comprueba que todos los accesos quedan dentro del ancho móvil. Los resultados de CI de esa revisión se registran en el PR #72, sin reutilizar una aprobación de un commit distinto.
