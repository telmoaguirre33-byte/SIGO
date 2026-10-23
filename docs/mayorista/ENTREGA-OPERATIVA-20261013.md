# Mayorista: avance operativo y evidencia

Rama exclusiva: `feat/mayorista-distribuidora-offline-20261012`. PR #72, sin merge ni publicación productiva. Continuación de `8def113`; último commit de código probado: `f98a6d45e36d6d2a1d7548054a76455734e318ec`.

## Funciones conectadas

- Autenticación firmada con sesiones persistentes; empresa habilitada y rol vigente comprobados en cada petición. Gestión de usuarios, roles, desactivación y restablecimiento de contraseña por gerencia. RLS por empresa y cargas asignadas a armador/chofer.
- Portal real conectado a PostgreSQL mediante API: vendedores, clientes/asignaciones, rutas, productos, listas, unidad/pack/caja/bulto, promociones, objetivos, recepción/aprobación de pedidos e informes agregados.
- Vendedor: identidad legible, catálogo asignado, rutas, mapa de coordenadas disponible offline, visitas/GPS, ofertas y objetivos; almacén cifrado, pedidos estables e idempotentes, sincronización y recuperación. El mapa de coordenadas no incluye cartografía vial ni navegación.
- Cargas individuales y consolidadas: camión/ruta/usuarios responsables, picking y lectura de códigos, faltantes/sobrantes, reserva de inventario propio, hojas imprimibles, despacho, entregas, devoluciones, rendiciones/revisión, recepción física en depósito, cierre e historial. Cancelación y reasignación sin duplicación.
- Cuentas corrientes propias, cobros parciales de oficina, créditos/reembolsos y rechazo de cobros concurrentes excesivos. Consolidación de precios distintos del mismo producto mantiene el total exacto.
- Runtime e instalación SQL explícita para Railway QA privado, TLS con CA y hostname verificados, integración desactivada por defecto.

## Commits de esta continuación

| Commit | Cambio |
| --- | --- |
| `12ad3b3` | Destino Railway QA y TLS estricto |
| `ba62ec6` | Roles persistentes y cargas asignadas |
| `46fedf9` | Catálogo, precios/promociones y publicación de asignaciones |
| `2425abf` | Portal conectado, usuarios y recepción de devoluciones |
| `6788a30` | Navegador real: gerencia y picking de armador |
| `b49cbc4` | Cobranzas, informes y runtime independiente |
| `f51118a` | Instalación SQL e imagen operativa |
| `89fd2a7` | Precios consolidados y corrección del fixture PostgreSQL |
| `f98a6d4` | Cancelación y reasignación de pedidos probadas contra API/SQL |

## Pruebas realmente ejecutadas

Ejecución de código `f98a6d4`: [Mayorista CI](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38325666332) y [Build SIGO](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38325666328), ambas exitosas.

- TypeScript Mayorista mediante `tsc`, build independiente y compilación del proyecto.
- Pruebas Node de dominio, recuperación, seguridad, cargas, rendiciones y políticas. Matriz pura de roles: 24 controles. Handshake TLS real en fixture: 3 controles.
- PostgreSQL 17 efímero de CI: 7 controles RLS dedicados y 81 controles API/PostgreSQL. Incluyen membresías persistentes, concurrencia, revocación, catálogo, cobros, cancelación y paquete SQL completo en una base vacía dentro de la misma instancia de CI. Este ensayo no activa una segunda instancia Railway.
- Navegador real conectado: gerencia crea un producto por UI/API y armador prepara su carga; incluidos en los 81 controles anteriores.
- Chromium/IndexedDB: 43 pruebas, incluidas 100 órdenes cifradas, cierre y reapertura del navegador, pérdida/recuperación de internet, dos pestañas, reintentos, UUID estables y respaldo cifrado. Incluyen GPS simulado y generación de PDF; no son pruebas físicas.
- Imagen Docker compilada y runtime importado sin red; bloqueo por defecto verificado. No desplegado.

Evidencia descargable temporal: [artefacto CI](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38325666332/artifacts/11781061650), retención de siete días. Los controles y ejecuciones se solapan; no sumarlos como casos independientes.

El workflow previo de Compras continúa fallando: [ejecución](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38325666294). Se conserva la investigación previa del desajuste `150 !== null`; no se alteraron ese módulo, su prueba ni su workflow.

El diff desde `8def113` solo contiene `src/modules/mayorista`, su workflow aislado y documentación propia. `main` sigue en `aca5a09cd2fe3ca66537d9d07598b6d450437241` al comprobar esta entrega.

## Bloqueos y aceptación restante

No hay despliegue QA activo ni enlace Android verificable. Railway tiene una sola base pendiente; faltan plan/consumo/límite y alcance del presupuesto US$15. El límite de gasto es compartido con otro proyecto y no se modificó. No se aceptó el despliegue ni se crearon servicios adicionales.

Pendientes: TLS y persistencia reales Railway; aceptación HTTPS en dos dispositivos Android, GPS/lector/impresora físicos; respaldo y restauración persistentes; monitoreo y procedimientos de soporte/recuperación local. El historial del vendedor usa su almacén cifrado; no se certifica consulta histórica completa entre dispositivos. La activación integrada en Administrar requiere una futura habilitación controlada; permanece preparada y desactivada.

Ver `RAILWAY-QA-OPERACION.md` y `ANDROID-PRUEBAS-REALES-20261012.md`. El código conectado y probado en CI no equivale a certificar el sistema para comercialización sin estas aceptaciones.
