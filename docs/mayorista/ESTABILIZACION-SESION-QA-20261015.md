# Estabilización de navegación y sesión Mayorista QA

Base: `0396cb06005fb7a96b3e2c5c147d75d911131f8c`, PR #72. El usuario confirmó operación real PC en QA AISLADO. No se rehace el módulo ni se modifica la fuente comercial real de lapizcito5.

## Diagnóstico con evidencia del deployment

Deployment Railway `314cd403-b7bd-4625-83d7-7c047167763b`, SUCCESS, entorno qa del proyecto MAYORISTA-QA.

- `/portal.html`: 12 respuestas 503 entre 20:00:02 y 20:00:06 UTC del 15/10. `fileURLToPath(new URL('../demo/dist/',...))` deja barra final; `root+path.sep` construía `dist//`. La ruta resuelta `dist/portal.html` nunca cumplía ese prefijo. El catch devolvía 503 antes de leer un archivo válido. Se normaliza la raíz y se comparte el lector estático real con las pruebas HTTP/Chromium, incluida CSP con hash.
- Navegación integrada: `/admin/users/candidates` devolvió 503 a las 20:10:29 UTC, duración 10.211 ms. El verificador de identidad remoto tenía timeout de 10 s sin recuperación. La excepción alcanzaba el catch genérico 503. Los registros anteriores no permiten distinguir cuál de las tres lecturas remotas agotó el plazo; no se atribuye una caída específica a Supabase sin evidencia. CORS/OPTIONS respondió 204 y las demás lecturas 200.
- El portal refrescaba toda su información en cada navegación e incluía candidatos de Usuarios en todas las páginas. Ahora pide esos candidatos solo en Usuarios y roles y agrupa lecturas independientes. El verificador repite una vez únicamente lecturas remotas transitorias (red/timeout/429/5xx), con plazo individual de 4 s y presupuesto global de 15 s. Si no puede verificar, sigue devolviendo 503: no usa permisos cacheados ni devuelve un éxito ficticio. Diagnóstico 503 registra evento, ruta normalizada y categoría; nunca tokens, cuerpos ni errores con secretos.

## Segundo login

El render sin identidad mostraba siempre Empresa/Email/Contraseña, incluso con una sesión anfitriona SIGO. El transporte borraba identidad tanto por 401 como por 403 de cualquier función. Además, al recibir foco/visibility o SIGNED_IN, el launcher vaciaba empresa/configuración/página, desmontaba el portal y revocaba su sesión.

- La modalidad SIGO tiene estados de verificación y una acción `Revalidar acceso desde SIGO`; jamás ofrece el formulario de contraseña del portal independiente.
- Un 401 puede revalidarse una sola vez mediante la sesión actual SIGO y `/auth/sigo` + `/me`. Las solicitudes concurrentes comparten esa renovación. Exige conservar usuario/empresa/rol y el binding QA confirmado; un cambio no se acepta silenciosamente. No se reintenta un 403 para elevar permisos.
- Logout/cambio de empresa/desmontaje cancelan ingresos/renovaciones pendientes. Tokens del módulo en memoria; ninguna contraseña SIGO, token en URL o persistencia adicional.
- Volver a enfocar la misma empresa autorizada conserva portal/página. Un evento explícito de empresa, configuración o salida invalida el acceso. Toda comprobación fallida cierra el launcher; el backend conserva validación server-side por solicitud.
- Las lecturas se publican como conjunto completo; un error inicial no renderiza un panel con estructuras incompletas. Un 503/desconexión informa el fallo y conserva contexto/UUID; Actualizar permite reintentar. Ninguna escritura se repite automáticamente por 503 o pérdida de red.

## Pruebas

`tests/session-stability.mjs`: recursos estáticos/CSP, recuperación remota acotada, 401/403/503, renovación concurrente, identidad constante, logout durante renovación y escrituras sin repetición automática.

`tests/operational-ui.mjs`: usa el lector estático del servidor real; launcher React conserva portal al recuperar foco; dos recorridos de Panel → Vendedores → Objetivos → Pedidos → Administración → Depósito → Cargas → Reparto → Entregas → Rendiciones → Clientes/rutas → Precios/ofertas → Cuenta corriente → Usuarios/roles → Informes → Panel; fallos 503 controlados visibles, desconexión CDP, reconexión, renovación desde SIGO y acción de revalidación tras fallo. Los fallos inducidos pertenecen exclusivamente al servidor efímero CI.

Se ejecuta la batería existente de TypeScript, build SIGO/Mayorista, RLS/API PostgreSQL, cinco roles, aislamiento, UI y offline/Chromium. Los resultados finales se registran en el PR y en la entrega, sin equiparar la ejecución CI a una sesión real del usuario.

## Alcance operativo

Solo archivos Mayorista y esta documentación. Sin migraciones comerciales nuevas, sin cambios a Minorista/Compras/SOVI/Prospección, main o producción. Se conservan namespace y empresa QA sintéticos persistentes. ARCA simulada, sin credenciales productivas.

Al actualizar el único backend QA existente debe aplicarse el nuevo SHA y el origen exacto del nuevo Preview READY en `MAYORISTA_SIGO_ORIGIN`. No se amplía CORS por wildcard ni se agregan servicios, bases o proyectos. Verificar SUCCESS, health/readiness con el nuevo SHA, `/portal.html` y sus recursos y repetir ingreso real PC/Android. La etapa UX queda separada y no se declara apto para producción.
