# Aceptación sobre la demo persistente publicada

El deployment `8849f2ce-8156-487c-9640-24187ec87ed4` está SUCCESS en `70c2783f8e9a3efe7b43a6308ff11958a9e0b1f7`. Su evento `MAYORISTA_DEMO_PREPARED`, 2026-10-16T23:49:02Z, acredita 8 vendedores, 1.500 clientes, 5.000 productos, 3 vehículos, 14 cuentas y reconexión PostgreSQL en `mayorista_acceptance_e1031f20aff5`. No volver a sembrar.

`backend/accept-live-demo.mjs` agrega un ejecutor opt-in de pruebas. No modifica funciones comerciales ni se ejecuta al importar. Todavía no se presenta como ejecutado o aprobado en Railway.

Usa el manifest existente y la contraseña bootstrap privada del propio entorno QA. Inicia sesiones reales de las 14 cuentas mediante la API HTTPS publicada; no sustituye autenticación, CORS, RLS, roles ni el servidor por mocks. El dominio permitido es únicamente `https://mayorista-api-qa-qa.up.railway.app`. Valida el binding del namespace interactivo. No crea servicios ni bases ni cambia el dataset maestro.

Plan de operaciones: 8 vendedores concurrentes, 16 pedidos, 8 cargas consolidadas, una entrega parcial, un faltante cancelado explícitamente, una sustitución autorizada, cobros administrativos y rendiciones de choferes. Comprueba permisos denegados, catálogo por vendedor, empresa distinta, revocación temporal de una cuenta local (restaurada en finally) y lecturas entre perfiles. Repite HTTP comerciales con los mismos UUID y exige respuestas iguales.

El journal privado persiste requests/respuestas comerciales sin tokens ni contraseñas. Permite recuperar un comando después de perder el acuse sin cambiar su UUID o versión. Nunca vuelve a emitir una factura con un estado previo inconcluso: exige conciliación. No induce un corte físico de red; esa prueba y el modo offline siguen pendientes de navegador.

La conciliación compara stocks, cuentas, pedidos, ventas y Caja con un snapshot previo. Lee desde otra conexión. Usa el emisor fiscal existente en el mismo namespace con transporte WSFE y transporte Auth fiscal sustituidos explícitamente, sin ARCA ni Auth productivos. No se presenta como facturación mediante la interfaz pública.

Conserva muestras HTTP y p50/p95 por operación en `mayorista_private.qa_live_reports`; el evento `MAYORISTA_LIVE_ACCEPTANCE` expone un resumen sin credenciales. La CPU/memoria del ejecutor corresponde al contenedor de aceptación, no al servicio API. Las métricas del servicio y PostgreSQL deben leerse por separado en Railway durante la ejecución.

## Aplicación requerida, pendiente de autorización

La imagen actual no incluye este nuevo ejecutor. Para probarlo hace falta fijar el servicio QA al commit que lo incorpora y ejecutar este predeploy, con opt-in acotado al proceso:

```sh
sh -c 'node /app/src/modules/mayorista/backend/verify-persistent-shared-qa.mjs && MAYORISTA_LIVE_ACCEPTANCE=true node /app/src/modules/mayorista/backend/accept-live-demo.mjs'
```

No incluye `prepare-demo-qa.mjs`. Usa el mismo proyecto, entorno, servicio, base y límites de recursos existentes. Si se pide aprobación, aplicar únicamente el patch revisado de fuente y predeploy de QA.

## Interfaces publicadas

No basta con este ejecutor API. P0 mantiene pendiente la prueba autenticada de gerencia, administración, vendedor, depósito y chofer en sus interfaces, además de offline, recuperación de conexión y acceso desde SIGO Preview. No hay perfiles del navegador remoto con sesión QA registrada. El workspace no tiene secretos configurados ni conecta con su proxy; no se publican contraseñas para resolverlo. La automatización web con consumo medido requiere autorización de gasto conforme a la restricción de la tarea.

P0 no se declara cerrado hasta completar esas pruebas y verificar el resultado real del ejecutor. Los controles CI anteriores no se reutilizan como medición de carga Railway.
