# Venta manual por medidas: cierre y operación controlada

Estado: candidato local integrado, pendiente de CI de navegador y autorizaciones operativas. No autoriza merge, despliegue, migración ni cambios de catálogo. El manifiesto de entrega identifica las fuentes y pruebas finales; el detalle fiscal está en `docs/FISCAL_CAJA_20261022.md`.

## Base y límites

- Main de partida: `69f5ab52315df2c5d27e5b37d62066c201acaa29`.
- Insumos de PR88: `19e3a4ba135608725ebe78eee896c03885b73a5f`; integración fiscal independiente basada en PR95 `1dc029f0d6380d9f3d71dd94606908d58802fa73`.
- No se modificaron esas ramas, main, Supabase productivo, ARCA ni datos comerciales.
- No activa balanzas, etiquetas de peso variable, módulos mayoristas ni otros proyectos.
- La migración no aplicada de PR88 `20261021_venta_medidas_rpc.sql` queda sustituida por la migración timestamp válida indicada abajo. No se incluyen ambas ni se elimina historia de migraciones de main.

## Contrato manual

Cada producto tiene una única unidad base para precio y stock. Códigos admitidos: unidad, kg, g, l, ml, m, cm, m2, m3, docena, caja, bolsa, paquete, rollo, bandeja y atado. Se normalizan espacios exteriores y mayúsculas; un valor desconocido nunca se interpreta como unidad.

Cantidades nuevas: kg/l/m/m2/m3 hasta tres decimales; cm hasta uno; las restantes enteras. Se rechazan cantidades no finitas, no positivas, fuera de rango o con precisión excesiva antes de almacenarlas. Los ceros decimales adicionales no alteran el valor: 0.7500 equivale a 0.750.

En productos kg, la captura inicia vacía en gramos: 750 g significa explícitamente 0.750 kg, siempre con precio por kg y equivalente visibles. No se convierte el catálogo ni el precio. Se puede alternar g/kg, usar presets, confirmar con Enter y cancelar con Escape. Los atajos de cobro/facturación quedan bloqueados mientras se edita la cantidad.

La escritura de producto y unidad es atómica. Un alta nueva kg admite stock inicial kg dentro de la escala. Un cambio semántico de unidad en un producto existente exige stock cero y ausencia de historial; no es una conversión automática. La normalización UNIDAD → unidad no cambia significado.

Se conserva el stock fraccional legado: con stock 10.500 de un artículo por unidad puede venderse 1 y quedar 9.500. La nueva cantidad sigue siendo entera. Al editar otro dato, reenviar exactamente el mismo stock/límite fraccional existente lo conserva; no habilita introducir un nuevo stock fraccional por unidad.

## Integridad de ventas y devoluciones

- La venta consolida por producto para ejecutar y construir la misma huella idempotente; no redondea por filas duplicadas originales.
- La UI envía la unidad esperada del carrito. El servidor rechaza una unidad cambiada y la incluye en la huella cuando está presente. Los clientes antiguos sin ese campo mantienen el contrato compatible.
- El descuento manual admite hasta dos decimales; no se permiten colisiones por truncar su huella.
- Ventas y devoluciones nuevas guardan la unidad histórica del renglón. Los renglones históricos sin snapshot no se rellenan con la unidad actual.
- Las devoluciones reparten el subtotal histórico acumulado, incluidos sus descuentos; la última devolución devuelve exactamente el importe pendiente. Ejemplo: 0.750 × 1.99 = 1.49, devolución 0.250 = 0.50, remanente 0.500 = 0.99.
- Una devolución legítima puede mover stock y registrar importe cero sin crear un movimiento monetario cero. No se repara historial inconsistente automáticamente.
- Repetir una devolución con la misma clave y payload no duplica efectos; cambiar venta, modo, motivo o cantidades con esa clave se rechaza. Una clave histórica sin huella requiere revisión.
- La UI de devoluciones impide doble click con un cerrojo inmediato y conserva la clave pendiente después de un error de red. Cuando el navegador permite sessionStorage, también la conserva al recargar la misma pestaña. Esto no es una cola offline ni una garantía de recuperación después de cerrar la sesión del navegador; un resultado incierto requiere revisar el historial, no iniciar otra operación a ciegas.
- Tickets y comprobantes usan los detalles y totales persistidos; el cliente no decide el importe cobrado/devuelto.
- V4 conserva la unidad histórica, pero no agrega un nombre histórico a la venta. El snapshot fiscal congela la descripción al primer comprobante autorizado; un renombre anterior a esa primera emisión no puede reconstruirse automáticamente. La reimpresión fiscal posterior debe usar el snapshot, no el catálogo vigente.

## Recuperar un cobro cuya respuesta se perdió

Antes del RPC, Caja guarda en sessionStorage la empresa, clave y payload inmutable, incluida la unidad esperada. Si no puede guardarlo o el contenido está corrupto, no envía un cobro nuevo. Un resultado incierto bloquea cambios de carrito y nuevos cobros: «Recuperar el mismo cobro» usa únicamente ese intento, nunca los datos editados del formulario.

Recargar o volver a Caja no cobra, imprime ni emite fiscal automáticamente. La recuperación conserva la clave y no reanuda la intención anterior de F10/F11; después puede usarse F11/F12 explícitamente sobre el UUID recuperado. Una respuesta confirmada conserva ese UUID aunque falle la lectura de conciliación, cambie la empresa o se abandone la pantalla. Una respuesta tardía no imprime desde una Caja desmontada.

Solo un rechazo definitivo de la primera llamada libera el carrito para corregir. Un rechazo durante una recuperación no descarta un commit previo y mantiene la protección. El almacenamiento es por empresa y sesión de pestaña: cerrar la sesión o borrar los datos del navegador puede eliminar el puntero. No es una cola offline ni una reconciliación automática entre terminales; ante esa pérdida se debe verificar el historial, no volver a cobrar a ciegas.

## Seguridad y catálogo: gates separados

La migración manual no resuelve por sí sola el acceso directo legado a productos. La propuesta RLS se mantiene en este directorio, fuera de `supabase/migrations`: requiere autorización productiva específica y verificación de consumidores. Limita lectura a empresa/permiso y quince columnas y elimina escrituras directas; no es masking completo de costos/stock dentro del tenant ni hardening de compras legacy.

El preflight debe comprobar unidades reconocidas y stock representable mediante agregados, sin exportar filas comerciales ni corregirlas automáticamente. El flujo nuevo conserva stock fraccional legado de artículos por unidad y permite vender cantidades enteras. La primera ruta segura para un producto medible es un alta nueva con su unidad, stock y precio correctos; convertir un producto histórico requiere una decisión separada. Los resultados operativos reales del preflight se entregan fuera del repositorio.

## Orden de salida, pendiente de autorización

1. Revisar el diff final contra main actual y la lista exacta de migraciones pendientes. No incluir otras migraciones o cambios de permisos por arrastre.
2. Autorizar por separado la migración funcional y el cambio RLS. El rollback RLS propuesto reabre la exposición anterior y también requiere autorización explícita.
3. Aplicar primero la migración funcional con historial de versión correcto, verificar columnas/RPC/grants y refrescar la caché PostgREST si fuera necesario (`NOTIFY pgrst, 'reload schema'`). No desplegar primero la UI: falla de manera cerrada si faltan las RPC nuevas.
4. Resolver el gate RLS y comprobar aislamiento con identidades de prueba autorizadas; no usar ventas o emisiones reales como prueba.
5. Sólo entonces desplegar el frontend aprobado y verificar la lectura del catálogo, alta de producto de prueba autorizada, captura manual y ticket mediante el procedimiento de aceptación acordado.

Atención: el workflow existente de Supabase aplica migraciones al recibir cambios en main. Un comentario «no aplicado» dentro de SQL no desactiva ese workflow. Un PR draft o una prueba local no equivale a autorización de despliegue.

## Evidencia SQL

Candidato exacto: `supabase/migrations/20261022024847_manual_medidas_atomicas.sql`, SHA256 `d525682cf0ac327221a389f4668748b40d6fd81e0a31b70c79e5b05a59312c21`.

PostgreSQL 17.6, esquema/permisos/triggers reales reconstruidos y datos exclusivamente sintéticos: 196 pasos / 781 aserciones manuales, 185 pasos / 748 aserciones con RLS propuesta y seis escenarios concurrentes reales aprobados. Se probó stock disputado, misma clave de venta, ambos órdenes parcial/anulación, misma clave de devolución total y venta/devolución CC compartiendo cliente/producto. No observar deadlocks en esos casos no prueba ausencia universal de carreras.

Las funciones de compra antiguas no se reescribieron para todas las validaciones nuevas. Los ensayos SQL no prueban PostgREST, UI, impresora física, CAE ni despliegue. La evidencia fiscal y frontend se documenta por separado. No afirmar que una impresión simulada sea una impresión física ni que un comprobante de prueba sea fiscalmente emitido.

## Frontend y CI

La suite manual tiene 55 pruebas unitarias/DOM aprobadas, sin omisiones, más catorce escenarios de recuperación con POS y servicio de ventas reales y Supabase sintético en memoria. Incluye F9/F10/F11 con respuesta perdida, recarga, triple click de recuperación, unidad kg, aislamiento por empresa, error de almacenamiento, payload alterado y respuestas tardías tras desmontar Caja. Las pruebas se ejecutan después del build combinado, no solo sobre la fuente previa a sus transformaciones.

La combinación final aprobó `npm run build`, ambas suites anteriores, `npm run test:admin-notifications`, `npm run verify:critical` y `npx tsc --noEmit`. El build transforma doce archivos heredados; las pruebas se ejecutaron sobre esa salida y una segunda ejecución no produjo cambios adicionales de fuente. `VentaRapidaOperativa.tsx`, el editor de cantidad y los helpers nuevos de medidas/recuperación conservaron sus hashes. Esto valida las transformaciones probadas, no sustituye la corrida real de navegador.

El workflow gratuito existente ejecuta `npm ci`, build, `npm run test:manual-medidas`, `npm run test:fiscal-caja` y verificación crítica. Tras instalar Chromium de Playwright ejecuta `node scripts/test-venta-medidas-browser.mjs` y `node scripts/test-arca-fiscal-print.mjs`. Los fixtures usan datos sintéticos, origen reservado `.invalid` y bloquean accesos de red no previstos, autenticación real y hardware.

El fixture manual de navegador compila y contiene once casos, pero Chromium no pudo iniciar en el entorno local. Su resultado real sigue pendiente de la corrida CI; no se considera aprobado por pasar tests DOM ni por compilar. Una CI fallida bloquea la salida. Los recibos de prueba y simulaciones no autorizan emisiones ni prueban una impresora física.
