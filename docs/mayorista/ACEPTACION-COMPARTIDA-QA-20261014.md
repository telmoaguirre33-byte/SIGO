# Fuente compartida y aceptación Mayorista en QA

Se continúa desde `1bfc59f`. Se conserva PR #72 y se reconciliaron los commits `7249991` y `d9a5a9d` de main (Matriz y notificaciones). Sus archivos se incorporaron sin cambios propios; `vercel.json` conserva las funciones y cron existentes y suma únicamente la función Mayorista de homologación.

## Circuito conectado

El backend selecciona la fuente comercial por empresa desde la vinculación persistente. Verifica empresa, módulo y correspondencia de roles. Si una empresa vinculada a SIGO se deshabilita o cambia a un rol incompatible, se bloquea: **no vuelve silenciosamente al stock o cuenta QA**.

En modo compartido, el catálogo y las ventas usan `public.productos` y `public.clientes_sigo`; las asignaciones, rutas, visitas, cargas y metas siguen siendo metadatos Mayorista. Se bloquean los comandos de maestros, inventario y cobros QA. La aprobación de cargas toma nombres/clientes de SIGO y los códigos de picking se vinculan a esos productos.

La API comercial exige el UUID, cliente, cantidades y precios de una entrega registrada en su carga. Recupera vendedor y ruta desde el pedido/carga persistente; no acepta una venta aportada solamente por el navegador. La confirmación descuenta stock y registra venta/Caja/cuenta en la misma transacción. Preparación y salida no hacen otro descuento. Un reintento conserva el comprobante, y superar crédito requiere una decisión gerencial por pedido. La deuda, cobranza, ventas y metas del panel leen los asientos compartidos; factura y costos nunca se infieren del pedido. La falta de una fuente de costos o vencimientos conserva valores no confirmados.

## Integración ARCA

`api/mayorista/arca.js` deriva la venta de una entrega confirmada mediante la RPC autenticada. Reutiliza sin modificar `api/arca/cae-v2.js`, su reserva única, la consulta de comprobante y conciliación tras un acuse perdido. La nueva ruta acepta exclusivamente homologación; producción se rechaza antes de invocar WSFE. El acceso integrado ofrece facturar una entrega confirmada usando la sesión SIGO del host.

La prueba usa las migraciones SIGO reales para ventas, cuenta corriente y comprobantes en PostgreSQL. Sustituye únicamente el transporte externo (Auth/REST/Storage/WSFE) por el adaptador del fixture: reserva y CAE quedan en PostgreSQL, el acuse perdido se concilia, y el reintento no duplica factura ni stock. **No equivale a un CAE obtenido realmente en homologación.**

## Aceptación persistente aislada

`backend/verify-persistent-shared-qa.mjs` solo admite el proyecto/entorno/PG QA ya autorizados, TLS verificado y una revisión Railway de 40 caracteres. No crea servicios, dominios ni proxies. Dentro del PostgreSQL existente prepara una DB `mayorista_acceptance_<revisión>` y ejecuta:

- Declaración y activación independiente por empresa, overrides Matriz y auditoría.
- Entregas, stock único, ventas, Caja, cuenta, crédito y cobros idempotentes.
- Login y sesiones firmadas; gerencia, administración, vendedor, armador y chofer; restricción de clientes/cargas y empresas.
- Pedido conservado al reiniciar el handler, picking con código, salida y entrega; escritores QA bloqueados.
- Ventas, deuda y cobranza reales para panel; objetivos propios del vendedor.
- Reserva fiscal y conciliación del emisor existente con WSFE simulado.

Los datos permanecen para inspección posterior. Las sesiones y cuentas ficticias se revocan al terminar. Un fixture existente sin evidencia válida se rechaza; no se sobrescribe. La evidencia por revisión se guarda en `mayorista_private.acceptance_runs`; `/readiness` solo devuelve éxito si encuentra el informe del commit desplegado. Informa expresamente `persistent_isolated_shared_fixture`, `simulated_wsfe` y `productionActivation: false`.

La DB de aceptación **es un fixture aislado del esquema SIGO**, no el proyecto Supabase COMERCIAL ni una copia de sus datos. El QA operativo existente conserva sus datos. Las propuestas SQL 006/007 no se aplican a producción.

## Límites para la activación real

Falta una empresa SIGO de prueba, conexión compartida y sesión/identidades verificadas en ese entorno, junto con certificado y ticket WSAA de homologación para validar el proveedor real. No se leen ni copian secretos productivos. No se autoriza publicación productiva por el resultado de estas pruebas.

Las listas especiales se rechazan explícitamente hasta completar su integración, evitando vender a un precio general equivocado. Continúan pendientes devoluciones/notas de crédito compartidas, vencimientos, condiciones comerciales avanzadas y la totalidad de los estados/metadatos del alcance original. El control implementado de crédito corresponde a la confirmación comercial de la entrega; el bloqueo/autorización antes del picking aún debe completarse. Por eso esta etapa no certifica la entrega definitiva de todos los requisitos del módulo.

La CI conserva las pruebas offline, búsqueda con 5.000 artículos, sincronización, RLS y Chromium aprobadas y las amplía con este circuito. La evidencia de ejecución y el despliegue verificado se enlazan en PR #72 al finalizar la comprobación del HEAD. Compras mantiene su fallo previo fuera del alcance. No se modifica SOVI ni Prospección.
