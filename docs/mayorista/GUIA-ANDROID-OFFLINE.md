# Pruebas manuales Android — Mayorista aislado

## Alcance y requisitos

Usar únicamente datos ficticios. No habilitar el API real, cargar datos personales, conectar SIGO ni ejecutar migraciones. Esta guía no autoriza despliegues ni modificaciones de Vercel/Supabase.

Se necesita un Android con Chrome actualizado y una URL HTTPS **ya autorizada** de la demo independiente. Si no existe acceso autorizado, las pruebas Android quedan bloqueadas. No usar el dominio SIGO, reactivar proyectos ni quitar SSO para resolverlo. Mantener el mismo origen HTTPS en todas las pruebas: IndexedDB no se comparte entre distintos enlaces de despliegue, perfiles o navegadores.

Preparar los archivos en una máquina de pruebas con Node 24:

```sh
cd src/modules/mayorista/demo
npm install --ignore-scripts
npm run typecheck
npm run build
npm run test:unit
npm run test:security
npm run test:admin
npm run test:recovery
npm test
```

La instalación genera lockfile: conservarlo para futuras ejecuciones con `npm ci`. El build solamente transforma TypeScript; `typecheck` debe aprobar por separado. La suite `npm test` requiere Chromium y permiso de sockets localhost. Puede configurarse un entorno de pruebas permitido; no se deben modificar las restricciones de sandbox o red del entorno para eludirlas.

Los archivos generados quedan en `demo/dist`. Esta continuación **no los publicó**. Una futura habilitación HTTPS necesita una autorización aparte sobre el proyecto existente.

## Evidencia a registrar

Fecha/hora; commit bajo prueba; URL/origen; modelo Android; versión Chrome; perfil normal/incógnito; permiso de almacenamiento persistente; estado de red; resultado y mensaje de cada paso. Guardar capturas y JSON del diagnóstico. No escribir «aprobado» en pasos que no se ejecutaron. Un resultado headless no acredita Android físico ni reinicio del teléfono.

## 1. Preparar el dispositivo

1. Entrar a la App Vendedor en Chrome normal, completar SSO si corresponde y confirmar que el encabezado dice DEMOSTRACIÓN.
2. Elegir una identidad demo y descargar el catálogo. Confirmar clientes, rutas, presentaciones y precios.
3. Esperar que el service worker termine de instalarse. Cerrar y abrir la página una vez con red. Anotar el commit del contenido servido para no probar una versión anterior en cache.
4. Abrir `offline-check.html` en el mismo origen. La página usa `sigo-mayorista-diagnostics-v1` y una empresa `diagnostico-<UUID>`; no modifica los pedidos de vendedores demo. No borrar datos del sitio ni usar incógnito durante una prueba de persistencia.

## 2. Guardar y recuperar 100 pedidos reales en IndexedDB

1. Pulsar **Crear o completar 100 pedidos ficticios**. Debe terminar confirmando 100 pedidos. El listado de UUID se guarda antes de escribir los pedidos, para poder completar una escritura interrumpida.
2. Pulsar **Verificar los 100 UUID y contenidos**. Debe recuperar una sola fila por UUID y el contenido original.
3. Repetir **Crear o completar**. No debe crear otros 100 pedidos ni cambiar IDs. Consultar **Inventario**.
4. Exportar JSON como evidencia inicial.
5. Cerrar Chrome desde aplicaciones recientes. Para cierre forzado: Ajustes → Aplicaciones → Chrome → Forzar detención. No usar «Borrar almacenamiento».
6. Volver a abrir exactamente `offline-check.html` en el mismo perfil y origen. Pulsar **Verificar** y **Inventario**. Exportar otro JSON. Deben conservarse los 100 UUID y contenidos.
7. Reiniciar el teléfono y repetir. Registrar este resultado por separado del cierre de una pestaña.

**Criterio:** cero UUID perdidos o duplicados; contenido idéntico. La página puede verificar datos, pero no demuestra por sí sola que el tester haya forzado el cierre: adjuntar evidencia de esa acción.

## 3. Sin internet

1. Con los datos y shell descargados, activar modo avión y comprobar que Wi-Fi y datos móviles estén apagados.
2. Recargar App Vendedor y diagnóstico. Deben abrirse sin red. Si aparece login SSO del proveedor o error al iniciar, registrar bloqueo; no quitar protección para evitarlo.
3. Consultar catálogo/clientes/rutas. En App Vendedor, agregar renglones a un borrador, cerrar Chrome y recuperar el borrador con el mismo vendedor.
4. Guardar un pedido desde ese borrador. Debe quedar pendiente y conservar UUID después de reabrir.
5. En diagnóstico, pulsar **Verificar** y, antes de confirmar pedidos, **Simular error de envío**. El número de pedidos debe permanecer intacto. Esta acción simula un error controlado; no prueba una caída de red remota.
6. Intentar sincronizar sin red. No debe marcar recepción. Restablecer Wi-Fi/datos y repetir sincronización ficticia.

**Criterio:** no informar guardado hasta terminar la transacción; no borrar pedidos por error de red; no marcar sincronizado sin acuse válido. Sincronización en esta versión significa receptor local ficticio, no servidor remoto.

## 4. Caída después de recepción y reintento

1. En diagnóstico, volver a conectar y pulsar **Simular caída después de recepción**. Se crea un pedido adicional de recuperación: ahora el inventario puede mostrar 101 pedidos.
2. Debe existir un acuse ficticio, pero el pedido debe quedar en error con su UUID original.
3. Cerrar/reabrir Chrome y pulsar **Verificar reintento del mismo UUID**.
4. Deben mantenerse la fecha del acuse, el UUID y una sola recepción ficticia. Exportar JSON.
5. No repetir «Simular caída» después de haber confirmado ese mismo pedido: no es una nueva prueba y la cola correctamente evita reenviarlo.

**Criterio:** una fila y un acuse por pedido. Estos resultados no acreditan el índice único ni una transacción PostgreSQL; esa verificación requiere un ambiente servidor de pruebas autorizado.

## 5. Dos pestañas y cierre durante envío

1. Antes de sincronizar todos los pedidos, abrir el diagnóstico en dos pestañas del mismo perfil/origen. Pulsar sincronizar en ambas casi al mismo tiempo.
2. Una llamada puede devolver 0 porque la otra mantiene el Web Lock; no debe reportarlo como fallo ni enviar simultáneamente el mismo pedido.
3. Verificar inventario y UUID en ambas. El inventario único no demuestra por sí solo un solo intento de envío: la suite CDP preparada cuenta los envíos de ambas pestañas y debe aprobar también.
4. Ejecutar la suite Chromium en un entorno permitido para cerrar una pestaña durante una recepción sin resolver. Debe quedar `sincronizando` en disco, liberarse el lock al cerrar y reintentarse desde otra instancia con el mismo UUID.
5. En App Vendedor, abrir el mismo borrador en dos pestañas, editar una y luego la otra. La segunda debe avisar conflicto de revisión. No sobrescribir automáticamente ni limpiar el borrador.

## 6. Condiciones adicionales

- Cambiar empresa/vendedor debe aislar catálogo, borrador, pedidos y visitas. Volver al anterior debe recuperar sus datos. El selector demo no equivale a autenticación real.
- Catálogo antiguo o con fecha demasiado futura debe avisar revisión antes de confirmar un envío.
- Almacenamiento lleno: un fallo de escritura no debe mostrar éxito ni vaciar el pedido. Preparar ese ensayo en un dispositivo desechable de pruebas; no llenar ni borrar el teléfono de uso comercial.
- Actualizar shell no debe borrar IndexedDB. Si existe una actualización pendiente, cerrar otras pestañas y comprobar qué versión se activó.
- No borrar datos del sitio con pedidos pendientes. Exportar primero el diagnóstico ficticio. Para datos reales todavía falta un flujo de respaldo/cifrado/autenticación integrado y probado.

## Matriz de resultados

| Ensayo | Resultado / evidencia |
| --- | --- |
| TypeScript | Pendiente hasta ejecutar `typecheck` con dependencias instaladas |
| 100 pedidos guardados y recuperados | Registrar UUID, conteo y JSON |
| Cierre forzado y reapertura | Registrar acción física y JSON posterior |
| Reinicio Android | Registrar por separado |
| Recarga modo avión | Registrar captura y origen |
| Borrador y pedido offline | Registrar UUID antes/después |
| Error y retorno de conexión | Registrar estados y reintento |
| Dos pestañas / cierre durante envío | Registrar resultados de ambas y suite CDP |
| Servidor, JWT y RLS | No evaluados por diagnóstico local |

Estado actual de esta guía: preparada; las pruebas Android no fueron ejecutadas desde el entorno Codex.
