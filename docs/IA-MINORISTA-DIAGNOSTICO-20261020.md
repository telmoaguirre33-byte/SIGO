# Reparación IA Minorista · diagnóstico y validación

Base: `main` `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`.
Rama: `fix/ia-minorista-resiliencia-20261020`.

## Causas confirmadas

- **Compras:** logs Vercel del 19/10/2026, 19:48 UTC, solicitud `9hz49-1792439308820-bec480765198`: Gemini respondió 503 en el modelo principal, 429 en su reintento y 503 en el alternativo. El proveedor informó `UNAVAILABLE` por alta demanda. No demuestra falta de nitidez. Hay éxitos previos de esos modelos; no hay evidencia para atribuir este incidente a clave inválida o modelo inexistente.
- **Inventario:** las solicitudes `t9khn-1792428418507-873e6162c964` y `5fh4z-1792428539329-d45d7933073c`, 19/10 a las 16:47 y 16:49 UTC, también pasaban por `/api/compras/analizar-factura` en modo inventario. Se registraron 503 repetidos y una cancelación `AbortError` tras aproximadamente 45 segundos. Comparten la indisponibilidad de Gemini y un esquema de reintentos que agota su plazo. El endpoint específico de inventario ya existía, pero la pantalla no lo usaba.
- **Cliente Compras:** tanto timeout local como `AI_TIMEOUT` se traducían a una sugerencia de foto más nítida. El reloj de 55 segundos se retiraba al recibir headers, antes de leer la respuesta.
- **Payload:** se aceptaban PDF de 4 MiB que, al codificarse en base64, superan el límite de request de 4,5 MB de Vercel. El canvas podía devolver la imagen original sin comprimir si fallaba su contexto.
- **Respuestas parciales:** una línea inválida de factura podía descartarse silenciosamente; una respuesta truncada de Gemini no se distinguía de una respuesta completa.

No se confirmó un timeout de infraestructura Vercel en estas solicitudes de IA. El timeout agrupado de notificaciones pertenece a otro flujo y no se usa como causa de este incidente.

## Correcciones y límites

Compras conserva un presupuesto total de 45 segundos que abarca autorización, Gemini y lectura del body; cada intento dura como máximo 18 segundos. Se permite un único modelo alternativo ante errores transitorios explícitos. No se repiten 429, credenciales inválidas, cancelaciones o resultados inciertos. La función tiene 60 segundos de margen de infraestructura y el cliente 55; la solución no consiste en ampliar el tiempo de procesamiento.

Inventario usa su ruta específica con una sola etapa de comparación por foto y lotes secuenciales de una imagen, hasta diez. Mantiene 25 segundos de presupuesto total bajo su configuración existente de 30 segundos. Conserva los lotes terminados para reanudar, sin repetirlos automáticamente. La comparación usa el catálogo del tenant y sus valores de stock; un catálogo incompleto no prueba que un producto falte en SIGO.

La preparación compartida limita dimensiones y bytes de JPG/PNG/WebP y produce JPEG. HEIC/HEIF sólo se convierte si el navegador lo decodifica; de lo contrario informa la incompatibilidad y solicita conversión. Los PDF se admiten hasta 3.000.000 bytes y se controla el tamaño real del JSON antes de enviarlo. No se incorporan servicios ni dependencias de procesamiento pagos.

El análisis sigue siendo de sólo lectura. El guardado usa el RPC transaccional existente, su clave de idempotencia y el mismo payload ante un resultado incierto. No se aplican migraciones en entornos reales.

## Validación

Se incorporaron regresiones de API, cliente e imágenes sintéticas. Compras cubre 1/7/15/30 artículos, formatos soportados, HTTP 401/403/413/429/500/502/503/504, red, timeout de headers/body, cancelaciones, reintentos acotados y rechazo de JSON o líneas incompletas. Inventario cubre diez lotes, recuperación parcial, conciliación de fotos, permisos, catálogo incompleto y errores de proveedor.

La suite existente de guardado prueba el RPC contra PostgreSQL efímero en GitHub Actions y los reintentos del cliente con mocks. La nueva suite de navegador se ejecuta en Chromium y Android simulado. Consultar el PR para el resultado y los enlaces de cada ejecución; un test configurado no equivale a un test aprobado.

## Limitaciones y validación pendiente

- No se declara resuelta la disponibilidad de Gemini por aprobar simulaciones. No se invocó un modelo real para generar consumo durante estas pruebas.
- Preview hereda el backend real si no se configura un entorno aislado. No se escriben datos de `lapizcito5`, no se crean usuarios de producción y no se utilizan datos comerciales reales en pruebas de escritura.
- IVA y descuentos mantienen el contrato existente: total del comprobante y advertencias de conciliación, sin desglose fiscal ni prorrateo automático. Requieren revisión manual; no se acredita extracción real con mocks.
- La exportación existente es CSV UTF-8 con BOM y separador `;`, compatible con Excel; no se convierte en un libro XLSX.
- Validación física Android pendiente: cámara y galería reales, orientación EXIF, HEIC según dispositivo, diez fotos con red móvil, cancelación y reapertura del navegador, recuperación durante 24 horas, marcadores, cierre mensual y apertura del CSV en Excel.
- Sin merge ni publicación productiva. Caja, Ventas, ARCA, cuenta corriente, Mayorista (#72), integración #78, SOVI y PROSPECCIÓN quedan fuera de los archivos funcionales modificados.
