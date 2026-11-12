# SIGO Gestión minorista — reparación de catálogo, Caja y búsqueda universal

PR #122 · incidencias #121 y #123 · 12/11/2026 UTC.

**Estado: candidato preparado y probado; no aplicado ni publicado en producción. No cerrar las incidencias hasta verificar el cliente después de una publicación autorizada.** Esta ampliación continúa la PR existente, conserva las protecciones de cobro y no cambia lógica fiscal ni estilos.

## Causa y comportamiento corregido

La RPC anterior materializa el catálogo entero y repite verificaciones de permisos por artículo antes de que se aplique la paginación externa. Caja espera esa descarga, la descarta al fallar y recorta las coincidencias locales a doce. El lector anterior también filtra después de construir el catálogo completo.

La reparación aplica búsqueda, límite y paginación dentro de SQL, con siete evaluaciones de permisos por llamada; devuelve precio, stock y unidad en la misma lectura. Caja abre sin descargar productos/unidades y permite recorrer todas las coincidencias en páginas de cincuenta con orden estable nombre/ID. No hay tope total de catálogo.

La consulta encuentra nombre completo/parcial, una o varias palabras en distinto orden, marca, categoría/rubro, código interno y EAN, con/sin tildes y mayúsculas. Todas las palabras deben estar presentes. Los códigos se comparan como texto literal completo/parcial: un nombre numérico no toma sus dígitos del EAN de otro artículo. La palabra más larga ancla el índice de trigramas. `%`, `_`, barra y comillas del usuario se tratan literalmente.

El lector usa coincidencia exacta por EAN, código interno o alias y conserva el rechazo de duplicados y LEGACY-DUP. Las ráfagas alfanuméricas resuelven el código sin esperar el catálogo; si no son un código y corresponden a una consulta escrita, pasan al buscador. La selección manual usa ID, flechas, Enter o mouse. Una unidad desconocida no se convierte en pieza.

Las consultas son cancelables, con debounce de 180 ms y plazo de ocho segundos; empresa, sesión, consulta o página nuevas invalidan resultados anteriores. El cliente distingue **sin coincidencias** de **timeout**, **conexión**, **permisos/sesión** y **error del servidor**. El lector distingue código inexistente en el catálogo autorizado y código duplicado. Una falla técnica no se convierte en catálogo vacío exitoso.

El cobro ya evitaba cargar el catálogo antes de enviar la RPC; se conserva ese comportamiento y la conciliación/idempotencia. Los auxiliares opcionales leen sólo IDs. El importador obtiene un maestro completo al analizar un archivo, sin interpretar la página visible como catálogo íntegro.

Stock, Compras e Informes conservan su contrato de lectura completa, pero reutilizan ahora `consultar_productos_sigo` en páginas SQL de hasta 500 con las unidades incluidas. Ya no materializan el catálogo entero en una RPC por cada página ni vuelven a descargar todas las unidades. Avanzan por la cantidad efectivamente recibida hasta una página vacía: un límite REST inferior no oculta los artículos siguientes. La transferencia completa sigue siendo necesaria para los cálculos/exportaciones actuales; los agregados SQL son una mejora posterior, sin confundir esa lectura completa con la búsqueda de Caja.

Stock muestra 50 filas por pantalla, con navegación hasta la última página y valorización sobre el conjunto filtrado/seleccionado completo. Durante carga o error los indicadores muestran «—», no ceros; las exportaciones/selecciones se bloquean hasta completar la lectura. Un error en una página intermedia invalida el resultado completo y ofrece reintento. Se cancela el pedido anterior y se reinicia el componente por empresa para descartar datos atrasados de otro comercio.

## Capacidad medida con datos sintéticos

PostgreSQL 17.6 local sin red, dos empresas independientes. Se ejecutan los siete tamaños pedidos, búsquedas de artículos inicial/central/final, todas las páginas, códigos/alias/duplicados, tildes, caracteres especiales y siete rubros: ferretería, supermercado, librería, carnicería, verdulería, fiambrería y limpieza. Se agregan controles de productos inactivos y stock cero; los primeros se excluyen y los segundos siguen siendo localizables.

| Artículos activos por empresa | Primera página, ms | Búsqueda mediana, ms | Búsqueda máxima observada, ms | Cajeros simultáneos |
| ---: | ---: | ---: | ---: | ---: |
| 1000 | 4,596 | 10,343 | 14,750 | 8 |
| 5000 | 4,697 | 16,777 | 19,338 | 8 |
| 10000 | 4,906 | 25,605 | 29,864 | 8 |
| 15000 | 5,769 | 37,030 | 42,190 | 8 |
| 20000 | 4,210 | 45,272 | 50,166 | 8 |
| 30000 | 4,769 | 69,159 | 85,981 | 8 |
| 50000 | 5,312 | 113,696 | 128,976 | 8 |

Se verificó que todos los IDs activos son recuperables una sola vez, sin mezcla de empresas: 400 páginas a 20.000 y 1.000 páginas a 50.000. Ocho procesos de cajero consultan simultáneamente bajo autorización real de la función del repositorio. Estas mediciones pertenecen al fixture; **no son una garantía de latencia en producción**.

En la prueba funcional Chromium hay 20.000 productos por empresa (40.000 en total), dieciséis casos y apertura de Caja de 797 ms en el entorno sintético, sin lectura inicial de catálogo. Incluye nombres/códigos/categorías, inicio/medio/final, 120 coincidencias en páginas 50/50/20, teclado/mouse, cambio de cantidad, lectores EAN/alfanuméricos, duplicados, errores diferenciados, timeout/reintento y cambio de empresa con respuesta anterior cancelada.

## Caja, cantidades y facturación

Se verificaron unidad, kg, g, l y m; precio/cantidad/subtotal; 625 g = 0,625 kg y 1,125 m con total $175; además 125 g a $1,99/g + 0,375 l a $4,95/l = $250,61. F9 confirma sólo la venta simulada; F10 invoca sólo ticket simulado; F11 despacha el contrato fiscal existente a una frontera simulada. No se llama a un servicio fiscal real.

La RPC transaccional real del repositorio se prueba en otro PostgreSQL aislado con **20.000 productos por empresa**. Hay tres ventas consecutivas para cada unidad, conservación de centavos/decimales, respuesta perdida, mismo intento recuperado, dos cajeros con claves iguales y distintas bajo bloqueo real, rollback atómico ante un artículo inválido y aislamiento de empresas. El snapshot de todos los productos se compara mediante hash para no truncar la evidencia al crecer el fixture.

Regresiones: build, verify:critical, test:manual-medidas, errores tipados, gate de migraciones (30 casos), medidas Chromium, cobros Chromium escritorio/móvil, SDK/sesiones/ACK y recuperación idempotente. CI reproduce las pruebas sobre el HEAD de esta PR. No se ejecutaron operaciones comerciales reales, CAE, impresoras ni dispositivos físicos.

Evidencia JSON y capturas: [catalogo121-evidencia](./catalogo121-evidencia/). `db.json` y `scale.json` contienen SQL/escala; `browser.json` las dieciséis pruebas funcionales; `sale-db.json` la RPC de ventas; `rls.json` el candidato de seguridad. Los artefactos de Actions contienen las mediciones de cada corrida de CI.

## RLS: solución preparada y validada, no aplicada

Se reutiliza el candidato existente de [productos-rls](./productos-rls/LEEME_OPERACION_NO_AUTORIZADA.md), fuera de supabase/migrations. La suite nueva ejecuta sus archivos exactos APPLY/ROLLBACK/APPLY en un PostgreSQL sintético con 50.000 activos por empresa y verifica owner, admin, seller y warehouse; denegación explícita; no miembro; sesión nula; acceso anónimo; bloqueo de DML/TRUNCATE directo; máscaras de las RPC; columnas de los consumidores directos minoristas y conservación de todas las filas. No se desactiva RLS.

El candidato de catálogo usa endpoint público SECURITY INVOKER y helper privado con sesión, products.read y empresa explícitos; se prueba que rechaza otra empresa incluso con el fixture de políticas permisivas anteriores. Esto no sustituye la aplicación y revisión del gate global.

**Pendiente productivo:** el candidato RLS modifica una tabla compartida. Antes de aplicarlo se debe confirmar su compatibilidad con consumidores externos y el alcance autorizado; no se inspeccionaron ni modificaron otros proyectos. El parche conserva lectura de las quince columnas documentadas dentro del tenant: no implementa masking intratenant de cada columna para consultas directas. Las RPC sí mantienen máscaras por permiso.

El rollback global RLS existente reabriría privilegios anteriores y no es la recuperación automática recomendada. Ante regresión, conservar el aislamiento y usar la web/RPC compatibles o corregir hacia adelante. Su ejecución requiere decisión específica.

## Respaldo, migración y publicación

Respaldo real de PostgreSQL COMERCIAL **recuperado y verificado**: [Actions 43317161295](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/43317161295), snapshot del 12/11/2026 22:09:12 UTC. Captura consistente READ ONLY, cifrado y persistencia privada/readback PASS; restore sin red y datos/esquema/funciones/roles/membresías/RLS/ACL/extensiones/secuencias MATCH. Ambos SQL exactos se aplicaron sobre la copia real, con owner/admin/seller/warehouse, aislamiento, deny/no miembro, máscaras y todas las filas intactas. No se aplicó SQL productivo. [Procedimiento y cobertura](https://github.com/telmoaguirre33-byte/SIGO/blob/f168a9f/docs/operacion-controlada/respaldo-local/NUBE.md).

El plan Free no incluye respaldos automáticos. Esta copia lógica no incluye passwords LOGIN, bytes físicos Storage ni secretos/configuración externos. La clave privada destinataria permanece separada y su disponibilidad/coincidencia se verificó. La revisión RLS abarca consumidores minoristas; no certifica integraciones externas ni otros proyectos. Sigue siendo necesaria autorización específica para los SQL y el despliegue.

Migración exacta del buscador: `20261112021657_catalogo_busqueda_servidor_121.sql`, SHA-256 `33dcd3c00c02535f8df262752bc148726345a240de71eb931565f746b8e68046`. Todavía no aplicada a producción. Es transaccional y aborta si no obtiene los locks en dos segundos. Instala pg_trgm y dos índices; no modifica filas comerciales. El candidato RLS es otra operación explícita y no participa en despliegues automáticos.

Secuencia pendiente: confirmar CI del último HEAD/compatibilidad → acordar ventana y pedir autorización final específica de catálogo/RLS y web → aplicar únicamente los SQL autorizados → verificar RPC y permisos → publicar sólo SIGO minorista → verificar el commit servido y el cliente. Nunca db push ni reparación indiscriminada del historial.

Recuperación: un error previo a COMMIT conserva la base anterior. Si falla la web, volver al despliegue minorista anterior identificado en el informe privado, conservando el SQL compatible. Si se necesita revertir una función, usar el rollback específico con fingerprint, sin restaurar filas ni reabrir políticas globales. No restaurar una base completa sobre ventas nuevas. La recuperación de funciones sigue ensayada; además se restauró/verificó el archive real de producción en copia aislada. Esa copia no autoriza restaurar datos sobre ventas nuevas.

## Validación posterior obligatoria, aún pendiente

Después de la publicación autorizada: ingresar al cliente autorizado y seleccionar varios artículos reales de distintos rubros y posiciones; comprobar nombre completo/parcial, palabras, marca/categoría, código/EAN, páginas, precios, unidad, selección y carrito; repetir búsquedas y registrar latencias/errores. Revisar la preparación de facturación sin pulsar confirmaciones que creen ventas, tickets o CAE. Cancelar el carrito de prueba. No cerrar #121/#123 antes de documentar esa verificación.

## Archivos

La continuación de #122 cambia sólo la consulta del catálogo, errores del buscador/lector, entrada alfanumérica del lector y conservación del resultado de lectura en Productos; el resto amplía pruebas, workflow y evidencia. Se preservan los archivos fiscales y los demás proyectos. La lista exacta se encuentra en Files changed de la PR.
