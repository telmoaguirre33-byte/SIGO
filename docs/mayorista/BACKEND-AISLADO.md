# Backend Mayorista aislado: alcance comprobable

La implementación nueva verifica contraseñas con scrypt, firma JWT con Ed25519 y comprueba en PostgreSQL la sesión vigente, la cuenta activa y la membresía actual en cada solicitud. Las claves privadas y contraseñas de prueba se generan en memoria; no se guardan en el repositorio. El cliente mantiene el token solo en memoria y logout lo revoca en servidor.

Esto es autenticación real del backend local de QA, **no** un login Supabase remoto, una identidad comercial habilitada ni un servicio desplegado. El adaptador Supabase existente permanece desactivado y sin proyecto de prueba autorizado.

`backend/service.mjs` está desactivado por defecto. Al habilitar exige PostgreSQL exactamente en `127.0.0.1:55471`, base `mayorista_qa`, origen HTTPS, claves y rate limiter. No lee variables ni credenciales de SIGO. Nunca monta rutas en su aplicación. El guard impide usar este adaptador contra una base remota.

Rutas preparadas y ejecutadas en el servidor efímero del CI:

| Ruta | Alcance |
| --- | --- |
| POST `/auth/login` | Contraseña, empresa autorizada, token firmado y sesión de una hora |
| POST `/auth/logout` | Revocación de una sesión, conservando pedidos del dispositivo |
| GET `/me` | Identidad y permisos actuales comprobados en servidor |
| POST `/orders` | Recepción transaccional, UUID estable, huella del contenido y acuse inmutable |
| GET `/orders` | Pedidos visibles por RLS para la empresa/vendedor |
| GET `/catalog` | Clientes asignados, productos y precios visibles por empresa |
| GET `/admin/state` | Planificación administrativa propia de la empresa, solo administrador |
| POST `/admin/commands` | Vendedores, rutas, asignaciones y objetivos con revisión optimista e idempotencia |
| POST `/admin/fulfillment` | Preparación, despacho, entrega, devoluciones y cobranzas independientes, con eventos auditados |

Las operaciones administrativas no crean credenciales ni conceden membresías. Sus asignaciones son **planificación independiente**: no publican cambios al catálogo de vendedores ni a SIGO. El catálogo de QA se prepara con fixtures; esa publicación controlada y la sincronización remota de visitas/rendiciones todavía faltan. Las pantallas existentes de administración conservan la etiqueta demo y usan IndexedDB; no están conectadas automáticamente al backend. La exportación es CSV compatible con Excel, no XLSX.

Los pedidos originales solo admiten INSERT/SELECT. Cambios de etapa y financieros se guardan en tablas nuevas de eventos; no alteran el acuse ni producen movimientos de Caja, stock, ventas o facturación. Los centavos y devoluciones parciales se validan; dos operadores con la misma revisión no pueden sobrescribirse.

Las políticas SQL propuestas terminan en rollback y no son migraciones. El job CI las aplica solamente a su contenedor PostgreSQL 17 efímero, sin secretos ni conexión Supabase. Las funciones `auth.uid/auth.jwt` de ese contenedor leen el contexto de transacción que coloca el backend después de verificar el token; no se depende de metadata editable enviada por el navegador.

`sync/http-client.mjs` es opcional, exige HTTPS y usa el contrato y la cola IndexedDB existentes. Un fallo de red, acuse perdido, 401 o conflicto no elimina el pedido. No se incorporó un selector de API ni credenciales a la demo pública. El almacenamiento comercial cifrado, el alta de identidades y la recuperación de cuentas/dispositivos necesitan integración y pruebas antes de usar datos reales.

## Pruebas reproducibles

El workflow `mayorista-isolated.yml` instala dependencias bajo `demo/` y `backend/` con `npm ci --ignore-scripts`, ejecuta TypeScript/build, unitarias, RLS, API real y Chromium. No cambia dependencias raíz. Sus JSON y capturas se guardan siete días como artifacts.

El ensayo nativo sirve HTTPS **solo localhost** con certificado temporal y Chromium de pruebas. Abre dos perfiles separados, crea 100 pedidos por perfil, corta red, cierra/reabre y sincroniza contra PostgreSQL. Usa excepciones de certificado únicamente en ese Chromium efímero. No demuestra HTTPS público, instalación Android, dos teléfonos ni GPS físico.

## Condiciones para habilitar pruebas comerciales

1. Un ambiente persistente de pruebas y su identidad deben estar identificados, aislados de producción y autorizados; revisar costos antes de aprovisionar o reactivar servicios.
2. Definir administración/roles del organigrama y alta segura de usuarios; el modelo actual prueba vendedor/administrador, sin inventar una jerarquía adicional.
3. Adaptar conexión a ese ambiente, publicar configuración/catalogos de forma controlada, integrar cifrado/recuperación y conectar las pantallas explícitamente. Este guard local no se retira para probar contra producción.
4. Revisar el proyecto Vercel ya existente y habilitar solo una preview autorizada, conservando SSO. No hay despliegue autorizado en esta continuación.
5. Ejecutar la guía Android en dos teléfonos físicos y registrar URL, commit, instalación, modo avión, GPS, cierre forzado y reinicio. No sustituir esos resultados por CI.
