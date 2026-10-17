# Continuación PR #72 — resultados verificables, 2026-10-12

Rama: `feat/mayorista-distribuidora-offline-20261012`. Continuación desde `ee10c06`; se conservó lo desarrollado. PR borrador [#72](https://github.com/telmoaguirre33-byte/SIGO/pull/72), sin merge ni producción.

## Commits de esta continuación

| Commit | Resultado |
| --- | --- |
| `7cedbf1` | Contraseñas scrypt, JWT Ed25519, sesiones revocables y API PostgreSQL aislada |
| `9be594a` | Cliente HTTPS opcional, lockfile del backend y dos perfiles Chromium contra API real |
| `2be32b7` | Preparación de perfiles y diagnóstico de arranque del navegador |
| `9ac5694` | Preparación/despacho/entrega, devoluciones y cobranzas independientes, RLS y auditoría; investigación Compras |
| `7e212be` | Administración offline, GPS emulado/denegado/no disponible, concurrencia de operadores y centavos |
| `e7ce8d3` | Planificación administrativa autenticada y persistente: vendedores, rutas, clientes y objetivos |
| `d8af9e1` | Pruebas RLS administrativas directas, contratos cliente y guías backend/Android |
| `6d82b14` | Descubrimiento del puerto CDP efímero y arranque acotado de Chromium |
| `4352335` | Comparación de UUID y contenidos después de cerrar/reabrir y contra PostgreSQL |
| `47da3fe` | Verificación de manifest e instalabilidad PWA por Chromium |

Código final verificado: `47da3fe41066da2ac35998965791b205ea20c0cc`. El commit posterior de entrega actualiza documentación; no agrega funcionalidades.

## Pruebas realmente ejecutadas

[Workflow Mayorista 38292643360](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38292643360): **success**.

| Verificación | Resultado |
| --- | --- |
| TypeScript aislado y build demo | Aprobados |
| Unitarias | 88 aprobadas: 17 base, 18 seguridad, 7 administración, 8 recuperación, 13 acceso/PWA, 8 HTTP/auth, 6 rendiciones y 11 flujo comercial |
| API/autenticación/PostgreSQL reales | 30 controles aprobados, incluyendo 9 controles de dos perfiles Chromium independientes |
| Demo en Chromium real | 26 aprobadas; incluye administración persistida offline y consulta de criterios PWA |
| RLS PostgreSQL dedicado | 7 controles aprobados; dos controles administrativos adicionales están incluidos en los 30 nativos |
| Build SIGO y verify:critical | [Workflow 38292643399](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38292643399): success |
| Regresión Compras | [Workflow 38292643358](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38292643358): failure, `150 !== null` |

El ensayo nativo creó 100 pedidos en cada perfil, comprobó los mismos registros completos después de cerrar/reabrir uno, restauró conexión y comparó UUID, empresa, vendedor, cliente y renglones contra las filas recibidas. Un acuse perdido se recuperó con el mismo UUID. La base terminó con 202 pedidos: uno enviado 20 veces concurrentemente, 200 de los perfiles y uno de recuperación; sin duplicaciones.

Se probaron contraseña incorrecta, firma alterada, otra empresa, cliente no asignado, precio cambiado, logout, revocación de membresía, comandos administrativos idempotentes y ediciones concurrentes. RLS rechazó escritura administrativa directa de un vendedor y ocultó configuración de otra empresa.

Las 88 unitarias incluyen dobles de prueba; no son 88 logins reales. El backend nativo usa contraseñas y firmas reales contra PostgreSQL efímero. No es una prueba Supabase Auth remoto. Dos perfiles y GPS CDP emulado tampoco son dos teléfonos ni GPS físico.

Hubo fallos intermedios del arnés de navegador: arranque con puerto fijo y recuperación antes de liberar el Web Lock. Se corrigieron, se conservaron los runs fallidos y la ejecución final completa aprobó. No se contaron esos runs como éxitos.

Localmente se ejecutaron las unitarias, generación aislada y sintaxis de 31 archivos JavaScript. Los sockets locales están restringidos y la CLI Vercel no está instalada; navegador, TypeScript con dependencias y PostgreSQL se ejecutaron en CI. No se hizo pasar una prueba local bloqueada por aprobada.

## Evidencia

[Artifact con JSON, capturas, evidencia PWA/RLS y lockfiles](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38292643360/artifacts/11766278447).

SHA256 informado por GitHub: `4d36c48e3d50cdcbb1fc902b381a0acee717d24599e91f875410e98f34e9894e`.
Expiración informada: 2026-10-19. La referencia y resultados permanecen documentados; no se afirma haber descargado y recalculado el ZIP localmente.

## Aislamiento

Diff del PR revisado: fuera de `src/modules/mayorista/` y `docs/mayorista/` solo están el workflow nuevo y cuatro líneas agregadas en `ModulosControlPanel.tsx`. El hash del código previo, al quitar esas incorporaciones, sigue verificado. No se cambiaron módulos operativos, dependencias raíz ni workflows existentes. `main` permanece en `aca5a09cd2fe3ca66537d9d07598b6d450437241`.

El acceso en Administrar sigue desactivado, sin proveedor real inyectado. La API está desactivada por defecto, no montada en SIGO y limitada a la DB QA localhost. No se aplicaron migraciones en Supabase. Los esquemas nuevos solo se ejecutaron en PostgreSQL efímero del CI.

Compras no se tocó. Su helper y test tienen exactamente los mismos blobs que main; la reproducción en memoria confirma que la fixture aporta un precio explícito 150 pero espera null. Ver [investigación](INVESTIGACION-COMPRAS.md). No se corrigió un módulo fuera del alcance para obtener CI verde.

## Bloqueos y trabajo pendiente

- No existe un ambiente persistente de identidad/backend aprobado para conectar las pantallas y probar datos comerciales. La implementación comprobada está en QA efímero.
- La UI sigue siendo demo local. La planificación administrativa autenticada no publica asignaciones al catálogo; falta esa conexión controlada, sincronización remota de visitas/rendiciones y revisión de permisos según el organigrama completo.
- Falta integrar y probar cifrado/recuperación de datos comerciales. El componente de cifrado preparado no convierte automáticamente la cola actual en almacenamiento cifrado.
- La exportación actual es CSV para Excel; no se implementó XLSX.
- Faltan instalación Android física, dos teléfonos, GPS real, cierre forzado/reinicio y modo avión físico. La guía está preparada; no se ejecutaron esos ensayos.

## Demostración Android

**No hay enlace Android operativo verificado.** Lectura actual del proyecto existente `sigo-mayorista-demo-20261012` (`prj_zWqWvjYqoIKJp3MnToDujdwZcPZG`): última preview con target staging, estado BLOCKED y SSO habilitado. La lectura detallada del deployment devuelve 403 por acceso al scope; no hay CLI Vercel instalada para el fallback.

No se creó, reactivó ni desplegó proyecto alguno en esta continuación. Para habilitar HTTPS se requiere acceso autorizado al scope, revisión de costos y autorización específica para una preview del proyecto existente, conservando SSO. Después debe verificarse contenido/commit desde Android. Un certificado localhost, una captura o un artifact no sustituyen ese enlace.

Guías: [backend aislado](BACKEND-AISLADO.md) y [pruebas Android](GUIA-ANDROID-OFFLINE.md).

La tarea #71 y el PR #72 permanecen abiertos. No se declara el proyecto terminado.

