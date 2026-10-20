# Preparación de habilitación controlada · SIGO Gestión / PR #78

2026-10-20. **PREPARADO, NO PUBLICADO NI ACTIVADO.** Este paquete complementa la matriz oficial existente; no la reemplaza ni acredita pruebas físicas. La rama de integración contiene las correcciones y el paquete, pero ningún cambio de producción está autorizado por esta preparación.

## Baseline comprobado

- `main`: `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`.
- Producción Vercel: `dpl_DJDmPUwNLy1uUG3PCWN481h79rmf`, READY, mismo SHA; `www.sigo-gestion.com` y `sigo-gestion.com` apuntan a esa aplicación. Deployment inmutable: `comercial-7gy7dthjn-telmoaguirre33-byte.vercel.app`.
- Base revisada PR #78: `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`, abierto/draft, sin conflictos; main es ancestro y no hay commits pendientes de main. La comparación de árboles completa detectó 312 archivos diferentes y ninguno eliminado. No cambian los archivos de `supabase/migrations`, scripts generales, Caja, Ventas, Compras, Productos, Stock, Clientes ni emisores ARCA existentes. Los nueve archivos compartidos añaden entradas/componentes modulares, dos endpoints fiscales sólo homologación, configuración de esas funciones y CI Mayorista.
- COMERCIAL: `pafnbxfgpedbvpimjmun`, PostgreSQL 17.6, organización Free. Sólo se consultó metadata de configuración y catálogos de esquema, mediante transacciones READ ONLY. No se exportaron filas comerciales, usuarios o credenciales.
- El flag Mayorista de lapizcito5 **ya estaba TRUE**. Hay otras dos empresas con flag TRUE que se preservan; el flag no prueba por sí mismo autorización para incorporarlas al nuevo runtime. Aún no existen esquemas Mayorista, ledger, tipo canónico o destinos Mayorista en COMERCIAL.
- Railway QA permanece en `a1d36afc`, deployment `fcad3f07-21ab-4c46-b1be-330010e2301e`. Sin cambios de variables, deployments, P0 ni pedidos Android durante esta preparación.

El SHA de este paquete es el del commit que lo contiene; `a1d36afc` es su baseline, no una afirmación de que el nuevo código ya esté desplegado. CI y metadata de Preview se verifican para el SHA preparado antes de entregar.

## Resultado y límites

Se prepara una allowlist de empresas **sólo de servidor**, vinculada al hash del perfil comercial. Sin lista explícita válida el runtime comercial no arranca; una empresa excluida no puede autenticarse, recuperar una sesión ni enviar pedidos al runtime. QA/P0 conservan sus modos existentes. No se alteran roles, membresías, permisos, licencias, suscripciones o flags comerciales existentes. La allowlist no reemplaza las políticas RLS ni cambia las RPC de declaración de tipo.

Las 21 migraciones reutilizan los maestros canónicos en la misma base; no crean un espejo de productos, clientes, stock, ventas, Caja o cuenta corriente. El paquete no reemplaza las funciones Minorista canónicas. Las operaciones Mayorista autorizadas sí producen efectos comerciales en esos maestros, de forma transaccional e idempotente. No afirmar que el stock queda separado del Minorista.

El preflight real encontró **114/114 columnas compatibles, 7/7 funciones requeridas y cero columnas NOT NULL adicionales sin default en los INSERT revisados**. Se exportaron definiciones sin datos para ampliar el ensayo aislado con constraints, índices y guards reales. Esto no acredita un restore Supabase ni igualdad de propietarios/grants del futuro runtime.

## Archivos de operación preparada

- [Orden de publicación, configuración y rollback](PLAN-PUBLICACION-CONTROLADA.md).
- [Habilitación por empresa y plantillas que terminan en ROLLBACK](activation/README.md).
- [Revisión de migraciones y hashes](migrations/REVISION-MIGRACIONES-PR78.md).
- [Backup y restauración: estado NO ACREDITADO](recovery/README.md).
- [Checklist físico reducido](CHECKLIST-ACEPTACION.md).

## Recomendación para habilitar lapizcito5

**NO-GO para ejecutar la habilitación ahora**, por condiciones concretas:

1. Falta destino de runtime comercial autorizado, dominio/TLS, perfil firmado por hash y roles/secretos privados correspondientes. Los únicos servicios Railway accesibles son MAYORISTA-QA y SIGO ARCA Bridge; ninguno se modifica o reutiliza para esta instalación. No se presupone que un nuevo servicio sea gratuito.
2. Falta acreditar backup recuperable y restauración aislada del proveedor con conciliación y RPO/RTO; consultar plan Free o health no lo acredita.
3. Falta autorización explícita del paquete productivo concreto —migraciones, publicación y activación por empresa— y revisar las dos habilitaciones previas antes de completar excepciones del perfil. El esquema existente y la configuración deben volver a verificarse inmediatamente antes de ejecutar.
4. La aceptación real de pantallas publicadas y dispositivos sigue pendiente. CI Chromium aislado y pruebas HTTP publicadas de QA tienen alcances diferentes y no se presentan como aceptación física de lapizcito5.

ARCA Mayorista permanece sólo en simulación/homologación. No se cambia el ARCA Minorista vigente. GPS, cámara/lector, impresión y cobros recurrentes pueden quedar fuera de un piloto acordado; integridad, aislamiento, recuperación y trazabilidad no pueden excluirse.

No se ejecutó merge, cambio de main, migración productiva, publicación productiva, activación, cobro, infraestructura adicional ni modificación de pedidos Android.
