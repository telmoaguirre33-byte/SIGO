# Persistencia y recuperación: resultados de continuación

Base: `b946848a26325533e059e5f1bb9e1cc2ac4d8172`.
Rama: `feat/mayorista-distribuidora-offline-20261012`.
Primer commit de esta continuación: `1827f8f53523a62e6da5d89ff17cc5a504823e90`.

## Correcciones dentro de Mayorista

- La cola exige acuse con UUID, empresa, vendedor y fecha válidos. Un acuse de otro vendedor/empresa ya no puede marcar un pedido como sincronizado. El adaptador remoto y el simulador local entregan esos campos. Los consumidores futuros del callback deben respetar este contrato reforzado.
- Los acuses antiguos del simulador mantienen su fecha y huella; al reintentarlos se completan los campos de ámbito, sin recrear la recepción.
- UUID opcional de creación tipado expresamente como `string`; validación UUID y de estructura/cantidades antes de abrir IndexedDB. Se evita la inferencia demasiado estrecha del retorno de `crypto.randomUUID`, pero el chequeo `tsc` sigue pendiente.
- Comparación canónica de renglones para reintentos: cambiar el orden de propiedades del objeto no crea otro pedido ni produce un conflicto falso. Orden y cantidades de renglones permanecen significativos.
- La revisión de sincronización rechaza cantidades fraccionarias y considera desactualizado un catálogo más de cinco minutos en el futuro.

## Diagnóstico nuevo, no ejecutado todavía en navegador

`demo/offline-check.html` y `offline-check.mjs` usan las clases reales de almacenamiento Mayorista con datos ficticios de una empresa de diagnóstico separada. El descriptor y los 100 UUID se escriben antes de iniciar los pedidos para completar una operación interrumpida con los mismos IDs. La página permite verificar contenidos, simular error, conservar acuse tras una caída ficticia y exportar evidencia JSON.

El receptor de esta página es local IndexedDB, no una API remota. Las acciones solo registran APROBADA si se ejecutan y sus condiciones se cumplen. El cierre físico/reinicio Android debe acreditarlo el tester. El inventario de filas únicas no acredita por sí solo un único intento de envío concurrente: la suite CDP cuenta esos intentos.

El shell preparado incluye los archivos de diagnóstico. No se desplegó ni se modificó la configuración externa de hosting.

## Ampliación de la suite real preparada

Además de los ensayos existentes de 100 pedidos, doble guardado, dos pestañas, borrador, transacción abortada y reapertura:

- Reintento con renglones equivalentes pero propiedades en distinto orden.
- Cierre real de una pestaña durante un envío que no recibe acuse; recuperación desde otra instancia con mismo UUID y estado persistido `sincronizando`.
- Creación de pedido con red deshabilitada, error de envío y reintento con el mismo UUID al recuperar conexión.

Estos ensayos están preparados y se revisó su sintaxis. **No fueron ejecutados** en Chromium por la restricción del entorno.

## Pruebas realmente ejecutadas

| Verificación | Resultado |
| --- | --- |
| `node build.mjs` | Correcto: transforma 5 módulos TS y genera archivos estáticos. No verifica tipos. |
| `node ../tests/unit.mjs` | 17 aprobadas, 0 fallidas |
| `node ../tests/security.mjs` | 18 aprobadas, 0 fallidas |
| `node ../tests/admin.mjs` | 7 aprobadas, 0 fallidas |
| `node ../tests/recovery-unit.mjs` | 8 aprobadas, 0 fallidas |
| `node --check` sobre fuentes JavaScript | 17 archivos revisados, sin errores |
| Suite real `node ../tests/browser.mjs` | No inició: `listen EPERM` en `127.0.0.1:4173` |
| Chromium con archivo local | No inició: `setsockopt: Operation not permitted` |
| TypeScript aislado | No pudo ejecutarse: `MODULE_NOT_FOUND` del compilador |

**50 pruebas unitarias ejecutadas y aprobadas. Cero pruebas de persistencia en navegador real aprobadas en este entorno.** Las pruebas de API siguen usando repositorio en memoria; no prueban PostgreSQL/RLS ni recepción remota. No se escribió ni consultó SQL en Supabase.

Se conservaron las dependencias exactas y la configuración TypeScript aislada ya existentes. Para completar `tsc` hace falta un entorno permitido con compilador instalado; no se sustituyó ese chequeo por la transformación de Node ni por revisión sintáctica.

## Guía manual y bloqueos pendientes

Ver `GUIA-ANDROID-OFFLINE.md`. Incluye cierre forzado, reinicio físico, modo avión, actualización de shell, acuses/reintentos, borradores y dos pestañas, con evidencia antes/después. Ninguna prueba Android se declaró ejecutada.

Pendientes: permitir localhost/Chromium en un entorno de pruebas autorizado, instalar dependencias para TypeScript, ejecutar la suite real y disponer de una URL HTTPS de prueba previamente autorizada. La guía no concede permiso para publicar/reconfigurar recursos. No se solicitaron permisos que dejaran la ejecución esperando, no hubo despliegues ni cambios de Vercel o Supabase.
