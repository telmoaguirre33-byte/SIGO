# CONTINGENCIA: pausa de nuevas ventas por medidas. NO ACTIVAR como versión normal

Fuente exacta: c6e808b091314cdb5098765f4c9b164dfd0a4d77. No había flag de contención en el componente inspeccionado. Rama independiente basada en PR97. Esta variante deshabilita nuevas ventas por medidas deliberadamente; no reemplaza la activación normal ni debe fusionarse por defecto.

## Cambio mínimo

Añade módulo contencionMedidas.ts con constante true para una variante de contención compilada. Bloquea nuevas confirmaciones si algún renglón usa una unidad distinta de «unidad» (también presentaciones empaquetadas, por prudencia). No recategoriza productos. La caja muestra aviso, deshabilita cobrar nuevo por medidas y verifica el bloqueo antes de generar claves o persistir intentos. Cambios sólo en componente de caja y nuevo módulo.

La rama explícita recuperar=true continúa intacta: relee el intento persistido, verifica huella y envía exactamente el payload/key originales. No se borra sessionStorage, no hay migración de datos ni autoreintento. Una vez confirmada la recuperación, conserva payload/key y UUID. No reanuda impresión ni fiscalización. Ventas nuevas por unidad siguen habilitadas.

## Pruebas nuevas: 2 PASS

Ejecutar npm run test:contencion-medidas. tests/contencion.dom.test.mjs. React real y jsdom; servicios/RPC simulados, NO backend comercial, navegador físico ni impresora.

1. Guardia bloquea kg/g/l/ml/m/cm/m²/m³ y presentaciones/valores desconocidos; permite «unidad»; modo desactivado no bloquea.
2. Componente real modificado: montaje no cobra; carrito kg no cobra por F9/F10/F11 y no crea almacenamiento. Montaje con cobro pendiente no cambia su registro ni envía. Recuperación manual con respuesta incierta conserva payload/key pendiente y no reintenta automáticamente. Segundo clic manual envía mismo payload/key, confirma y no imprime/emite. Posterior venta por unidad funciona.

La prueba DOM usa stubs de servicios para observar llamadas. Se complementa, no sustituye, con las pruebas PostgreSQL de V4; La integración local completa aprobó TypeScript, npm run build, 26 pruebas de persistencia/devoluciones y verify:critical. No acredita sesión autenticada ni producción; CI y Preview se informan en el PR.

## Límite indispensable

Es contención de esta versión de interfaz, NO interruptor global de base ni mantenimiento de todas las empresas. Pestañas antiguas, otros clientes y llamadas directas siguen pudiendo escribir según sus permisos actuales. Un despliegue no obliga a recargar pestañas abiertas. No afirmar que esta variante garantiza cero nuevas operaciones globales ni habilita revertir V4: la base debe conservarse y corregirse hacia adelante después de nuevas escrituras. Recuperar un pendiente puede finalizar la primera venta si antes no había sido registrada: es el mismo intento explícito, no una creación libre.

No toca RLS, credenciales, cuerpo SQL, Productos, Mayorista ni F11/F12 fiscal. No modifica PR97. Para usar: revisar la variante, comprobar CI/Preview y aprobar despliegue de contención. La constante true no es configuración remota ni depende de Railway.

El checkout local reprodujo el código fuente del árbol base; el conector no materializó diez assets binarios (íconos/logo). El commit remoto conserva esos blobs sin cambios por base-tree. El build definitivo del árbol completo debe acreditarse mediante CI/Preview.
