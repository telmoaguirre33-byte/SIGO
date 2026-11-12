# SIGO Gestión minorista — reparación candidata de #121

Estado: corrección preparada y probada con datos sintéticos. **No aplicada ni publicada en producción. Incidencia abierta hasta verificación posterior autorizada en FERRETERÍA DEL PUERTO.**

Base revisada: `ccc20745db2be40b37e3fc8b472a84a3da4e1107`. Fecha: 12/11/2026 UTC.

## Alcance de la evidencia pública

Este informe se basa en el código del repositorio y pruebas sintéticas. Los detalles obtenidos mediante lecturas de producción se conservan en el informe local de la sesión; no se publican datos de clientes ni metadatos operativos privados en este repositorio público. No se ejecutó el listado lento ni EXPLAIN ANALYZE en producción.

## Causa y corrección

La carga de Productos y Caja esperaba terminar la descarga completa. Cada página reconstruía el catálogo con múltiples búsquedas de permisos por artículo; un fallo descartaba todos los resultados. Caja limitaba la búsqueda local a 12 coincidencias inaccesibles después del corte. Códigos y alias también sufrían la materialización completa en el servidor.

- Nueva RPC pública `consultar_productos_sigo`, `SECURITY INVOKER`, que delega en un esquema privado. El helper comprueba sesión, `products.read`, empresa y permisos por campo antes de leer. No depende de que la política RLS actual sea restrictiva.
- Permisos constantes por llamada: siete evaluaciones, sin repetirlos por fila. El `LIMIT/OFFSET` se aplica dentro de SQL. Orden estable por nombre/ID. La página usa 50 filas más una de control, con acceso a todas las páginas; no limita el catálogo total.
- Búsqueda por nombre completo/parcial, marca, código interno, EAN y categoría, sin distinguir tildes/mayúsculas. Los caracteres `%`, `_` y barra del usuario se tratan literalmente. El lector resuelve códigos exactos y alias con índices existentes; mantiene rechazo de ambigüedades e identidad LEGACY-DUP.
- Precio, stock y unidad se obtienen en la misma lectura. Unidad desconocida sigue bloqueando la venta; no se reemplaza por unidad/pieza.
- Consultas cancelables, debounce de 180 ms, plazo de 8 segundos y reintento explícito. Cambiar empresa/consulta invalida las filas anteriores; cambios de sesión invalidan los resultados. No hay caché compartida entre empresas.
- Se elimina la descarga del catálogo/unidades en Caja y su recarga completa después de recuperar un cobro. Las búsquedas siguientes vuelven a consultar al servidor.
- El cobro actual de main ya evitaba el catálogo antes de enviar la RPC. Se conserva ese comportamiento. Sus auxiliares opcionales de diagnóstico quedan acotados a IDs; no se reactivan ni se atribuye un delta de stock sin snapshot previo.
- El listado antiguo conserva firma, campos y máscaras para exportaciones/informes, calculando sus permisos una sola vez. El importador solicita un catálogo completo al analizar un archivo; nunca usa la página visible como maestro íntegro.

## Pruebas ejecutadas

Archivos funcionales: `src/productos.ts` (RPC paginada/IDs), `src/useBusquedaProductos.ts` (ciclo de consulta), `src/SigoApp.tsx` (Productos), `src/VentaRapidaOperativa.tsx` (Caja), `src/barcode.ts` (lector), `src/ventas.ts` (auxiliares de stock), `src/StockImportAssistant.tsx` y `scripts/apply-stock-import-assistant.mjs` (maestro completo bajo demanda). SQL: `supabase/migrations/20261112021657_catalogo_busqueda_servidor_121.sql`. El resto son pruebas, su adaptador, workflow y evidencia; la lista exacta está en el diff de la PR.

PostgreSQL 17.11 aislado, sin red: **15.000 productos por empresa, dos empresas, 30.000 en total**. Se usa la función granular real más reciente del repositorio; Auth y tablas son fixtures sintéticos. Las 300 páginas recuperan exactamente 15.000 IDs distintos. Se verifican nombre, tildes, marca, códigos, alias, unidad, owner/admin/seller/warehouse, denegaciones explícitas, usuario anónimo, empresa ajena e IDs ajenos. El acceso directo por RLS del fixture está cerrado: la prueba no depende de una política abierta.

| Medición local | Tiempo |
| --- | ---: |
| Primera página anterior, materializando 15.000 filas | 1.012,233 ms |
| Primera página nueva | 6,192 ms |
| Búsqueda `acople rapido profesion` | 4,945 ms |
| Listado antiguo con permisos precalculados | 14,126 ms |

Son mediciones sintéticas, no SLA ni tiempos de producción. `pg_stat_user_functions` confirma siete llamadas de autorización por página.

Chromium con componentes reales y transporte sintético: nueve casos, 15.000 productos por empresa. Incluye 120 ENCHUFES en páginas 50/50/20, selección del artículo 120 con teclado, nombres/tildes/marca/códigos, carrito, 625 g = 0,625 kg y 1,125 m, total $175, F9, F10 con ticket simulado, F11 con evento fiscal simulado, cuatro ventas consecutivas, Enter/Tab repetidos, foco, timeout/reintento y cancelación/cambio de empresa. No se permiten llamadas de red ajenas al origen `.invalid`.

Regresiones ejecutadas: build, `verify:critical`, `test:manual-medidas`, `test:admin-notifications`; pruebas de medidas en Chromium; cobros en escritorio/móvil; sesiones reales del SDK con transporte sintético; ACK, mensajes, recuperación, diagnóstico y release guards; 30 comprobaciones del gate de migraciones. También pasó la regresión de la RPC transaccional real en otro PostgreSQL aislado: ocho casos, ventas consecutivas, respuesta perdida, dos cajeros concurrentes con claves iguales/distintas, rollback atómico, permisos y cuenta corriente.

Evidencia versionada en [catalogo121-evidencia](./catalogo121-evidencia/). Las mismas pruebas nuevas se ejecutan en `.github/workflows/catalogo121.yml`, con artefactos descargables. Los mocks anteriores se adaptaron a la nueva interfaz paginada conservando sus verificaciones de cobro.

**Límites:** no se probaron pistolas, impresoras ni dispositivos físicos. F10/F11 se verifican en fronteras simuladas; no se cobró ni emitió CAE real. No se midió la consulta corregida en producción porque aún no está instalada. Estas pruebas sintéticas no certifican el aislamiento global de producción. El asesor de Supabase no sustituye estas pruebas; su revisión del candidato queda para el preflight autorizado.

## Gate de RLS previo

El repositorio ya contiene un gate y candidatos no autorizados en `docs/operacion-controlada/productos-rls/`. Esta PR no aplica esos candidatos ni modifica políticas globales. Prueba el aislamiento del endpoint nuevo con RLS cerrada en el fixture; no certifica todos los accesos de producción. Revisar el gate previo antes de una publicación autorizada; no aplicar a ciegas la carpeta completa de migraciones.

## Publicación propuesta, pendiente de autorización expresa

1. Revisar esta PR, CI y el estado actual de las definiciones/grants/índices. Confirmar respaldo recuperable de la base y guardar definiciones previas. La lectura de metadatos anterior **no es un backup de datos**. Revisar el gate previo de RLS y mantener el esquema privado fuera de los esquemas expuestos.
2. Con respaldo y autorización, aplicar **sólo** `20261112021657_catalogo_busqueda_servidor_121.sql`. Es transaccional; `lock_timeout=2s` aborta si no obtiene los locks. Instala pg_trgm y crea dos índices. No contiene INSERT/UPDATE/DELETE sobre datos comerciales ni altera políticas. Requiere ventana controlada por los locks de creación de índices; si falla, no forzar ni ampliar indiscriminadamente el timeout.
3. Validar RPC nueva y privilegios con la sesión autenticada autorizada, en lectura, antes de publicar la web. No usar service_role en navegador. No hay fallback a descarga masiva si falta la RPC: se muestra error recuperable. El orden DB → web evita esa incompatibilidad.
4. Sólo con autorización de merge/publicación, publicar la web. No modificar TIENDA SIGO, Mayorista, otros repositorios ni datos de otras empresas.
5. Verificar directamente en la sesión de FERRETERÍA DEL PUERTO: Productos responde; buscar ENCHUFE y ACOPLE RÁPIDO PROFESION…; nombre/código/EAN; selección y cantidades sin confirmar la venta. Vaciar/cancelar el carrito sin cobrar. No pulsar F9/F10/F11 en producción durante esta validación. Documentar tiempos/resultado en #121 y recién entonces considerar el cierre.

Rollback: volver primero a la web anterior. La migración conserva la RPC antigua compatible, por lo que no hace falta deshacer índices para recuperar la aplicación. Si fuera necesario revertir la definición antigua, usar la definición capturada y comparada con su SHA anterior; requiere autorización. No restaurar una base completa sobre ventas nuevas ni borrar registros para simular rollback. No se hizo merge, despliegue, reparación de historial ni aplicación de migraciones remotas.
