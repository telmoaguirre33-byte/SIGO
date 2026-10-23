# Preparación de habilitación controlada · SIGO Gestión / PR #78

2026-10-20. **PREPARADO, NO PUBLICADO NI ACTIVADO.** Este paquete complementa la matriz oficial existente; no la reemplaza ni acredita pruebas físicas. La rama de integración contiene las correcciones y el paquete, pero ningún cambio de producción está autorizado por esta preparación.

## Baseline inicial comprobado

- `main`: `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`.
- Producción Vercel: `dpl_DJDmPUwNLy1uUG3PCWN481h79rmf`, READY, mismo SHA; `www.sigo-gestion.com` y `sigo-gestion.com` apuntan a esa aplicación. Deployment inmutable: `comercial-7gy7dthjn-telmoaguirre33-byte.vercel.app`.
- Base revisada PR #78: `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`, abierto/draft, sin conflictos; main es ancestro y no hay commits pendientes de main. La comparación de árboles completa detectó 312 archivos diferentes y ninguno eliminado. No cambian los archivos de `supabase/migrations`, scripts generales, Caja, Ventas, Compras, Productos, Stock, Clientes ni emisores ARCA existentes. Los nueve archivos compartidos añaden entradas/componentes modulares, dos endpoints fiscales sólo homologación, configuración de esas funciones y CI Mayorista.
- COMERCIAL: `pafnbxfgpedbvpimjmun`, PostgreSQL 17.6, organización Free. Sólo se consultó metadata de configuración y catálogos de esquema, mediante transacciones READ ONLY. No se exportaron filas comerciales, usuarios o credenciales.
- El flag Mayorista de lapizcito5 **ya estaba TRUE**. Hay otras dos empresas con flag TRUE que se preservan; el flag no prueba por sí mismo autorización para incorporarlas al nuevo runtime. Aún no existen esquemas Mayorista, ledger, tipo canónico o destinos Mayorista en COMERCIAL.
- Railway QA permanece en `a1d36afc`, deployment `fcad3f07-21ab-4c46-b1be-330010e2301e`. Sin cambios de variables, deployments, P0 ni pedidos Android durante esta preparación.

El SHA de este paquete es el del commit que lo contiene; `a1d36afc` es su baseline, no una afirmación de que el nuevo código ya esté desplegado. CI y metadata de Preview se verifican para el SHA preparado antes de entregar.

## Actualización concurrente de main preservada

Durante el cierre, main y producción avanzaron a `8e0f49d8a109aa6f0781a4c8fc9a4bd05c70752b` por PR #85 (Contabilidad y conciliación fiscal inicial). Producción ahora es `dpl_621d1vNYM26ekXSQmU3MPqkMKBVw`, READY, URL inmutable `comercial-gad2of0q5-telmoaguirre33-byte.vercel.app`. Las referencias d9a5a9dd de este paquete describen el baseline inicial, no el rollback final.

Los 14 commits entrantes cambian seis archivos; ninguno coincide con un archivo modificado por Mayorista. Se preservan los seis blobs byte por byte desde main en la rama de integración, mediante un commit explícito de reconciliación, sin merge, cambio de main o edición funcional. Esto incluye las correcciones de pruebas de Compra IA ya incorporadas por main; no se corrigió Compras dentro de Mayorista. El plan productivo debe tomar esta versión vigente como rollback inicial y revalidarla antes de publicar.

## Segundo avance de main preservado

Mientras se completaba esta preparación, main incorporó PR #86 y quedó en `aa104b572bc1af9d4b97054c702b444c693721a5`. Producción verificada: `dpl_5wiuaSNWuATzwz4i7KsD3fg1S9V7`, READY, `comercial-6y42noxb4-telmoaguirre33-byte.vercel.app`. Se preservan los cuatro blobs adicionales de IVA/Contabilidad byte por byte, sin modificar su comportamiento. Nueve archivos de main son distintos del baseline inicial y se conservan exactos. Éste es el último punto productivo observado y el candidato a rollback, sujeto a revalidación al publicar. No se ejecutó merge ni se cambió producción.

## Resultado y límites

Se prepara una allowlist de empresas **sólo de servidor**, vinculada al hash del perfil comercial. Sin lista explícita válida el runtime comercial no arranca; una empresa excluida no puede autenticarse, recuperar una sesión ni enviar pedidos al runtime. QA/P0 conservan sus modos existentes. No se alteran roles, membresías, permisos, licencias, suscripciones o flags comerciales existentes. La allowlist no reemplaza las políticas RLS ni cambia las RPC de declaración de tipo.

Las 21 migraciones reutilizan los maestros canónicos en la misma base; no crean un espejo de productos, clientes, stock, ventas, Caja o cuenta corriente. El paquete no reemplaza las funciones Minorista canónicas. Las operaciones Mayorista autorizadas sí producen efectos comerciales en esos maestros, de forma transaccional e idempotente. No afirmar que el stock queda separado del Minorista.

El preflight real encontró **114/114 columnas compatibles, 7/7 funciones requeridas y cero columnas NOT NULL adicionales sin default en los INSERT revisados**. Se exportaron definiciones sin datos para ampliar el ensayo aislado con constraints, índices y guards reales. Esto no acredita un restore Supabase ni igualdad de propietarios/grants del futuro runtime.

## Evidencia nueva

El candidato `a486e906143ad3737f64e84489cf57b2713eb114` aprobó el [run 39421303759](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/39421303759): nuevo ensayo del esquema productivo sin datos, 21 migraciones/rollback/replay/drift, operaciones sintéticas, RLS/API, Chromium, IndexedDB y Docker. El job 118622633658 y sus logs registran PASS; no es una ejecución en COMERCIAL ni un restore del proveedor. El commit posterior preserva los seis blobs de main 8e0f49d8 y requiere sus propios estados CI antes de la entrega.

## Archivos de operación preparada

- [Orden de publicación, configuración y rollback](PLAN-PUBLICACION-CONTROLADA.md).
- [Habilitación por empresa y plantillas que terminan en ROLLBACK](activation/README.md).
- [Revisión de migraciones y hashes](migrations/REVISION-MIGRACIONES-PR78.md).
- [Backup y restauración: estado NO ACREDITADO](recovery/README.md).
- [Checklist físico reducido](CHECKLIST-ACEPTACION.md).

## Recomendación para habilitar lapizcito5

**NO-GO para ejecutar la habilitación ahora**, por condiciones concretas:

1. Falta destino de runtime comercial autorizado, dominio/TLS, perfil vinculado por hash y roles/secretos privados correspondientes. Los únicos servicios Railway accesibles son MAYORISTA-QA y SIGO ARCA Bridge; ninguno se modifica o reutiliza para esta instalación. No se presupone que un nuevo servicio sea gratuito.
2. Falta acreditar backup recuperable y restauración aislada del proveedor con conciliación y RPO/RTO; consultar plan Free o health no lo acredita.
3. Falta autorización explícita del paquete productivo concreto —migraciones, publicación y activación por empresa— y revisar las dos habilitaciones previas antes de completar excepciones del perfil. El esquema existente y la configuración deben volver a verificarse inmediatamente antes de ejecutar.
4. La aceptación real de pantallas publicadas y dispositivos sigue pendiente. CI Chromium aislado y pruebas HTTP publicadas de QA tienen alcances diferentes y no se presentan como aceptación física de lapizcito5.

ARCA Mayorista permanece sólo en simulación/homologación. No se cambia el ARCA Minorista vigente. GPS, cámara/lector, impresión y cobros recurrentes pueden quedar fuera de un piloto acordado; integridad, aislamiento, recuperación y trazabilidad no pueden excluirse.

No se ejecutó merge, cambio de main, migración productiva, publicación productiva, activación, cobro, infraestructura adicional ni modificación de pedidos Android.
