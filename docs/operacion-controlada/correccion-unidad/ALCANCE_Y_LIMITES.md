# Cambio de unidad: alcance de esta entrega

## Implementado como candidato

Corregir un error de carga inicial en ambos sentidos, por ejemplo unidad → kg o kg → unidad, conservando el mismo producto y los seis valores numéricos. Puede repetirse mientras no haya historia comercial. Se exige confirmar que stock, límites, precio y costos ya estaban expresados en la unidad elegida. No se hace una conversión física ni se asume equivalencia 1:1.

Se aplica la precisión de la unidad destino. Un stock de 1,250 kg no puede convertirse en 1,250 unidades enteras mediante esta corrección. Si realmente hay otra cantidad de piezas, hace falta el procedimiento de conversión todavía no habilitado.

Cada corrección deja auditoría y aumenta una revisión. Caja, compras manuales y edición capturan esa revisión; una operación vieja se rechaza incluso si la unidad volvió al valor original. Los cálculos masivos de margen y redondeo conservan su contrato de operar sobre valores actuales del servidor, no sobre una revisión de unidad capturada en pantalla.

La baja comercial es un estado separado: conserva stock e historia, excluye el producto de nuevas ventas/compras y permite consulta y reactivación. No permite corregir la unidad de un producto archivado hasta reactivarlo. Devoluciones y anulaciones previas deben seguir siendo posibles sin crear ventas nuevas.

## No incluido: conversión con historia

Cambiar el significado físico de cantidades con historia requiere otro contrato. Debe preservar la unidad/cantidad/precio originales de cada documento y sus futuras devoluciones o anulaciones. No se habilita renombrando el maestro ni duplicando productos automáticamente.

La propuesta futura usa un factor explícito: cantidad destino = cantidad origen × factor; precio/costo unitario destino = precio/costo origen ÷ factor. Debe conservar el valor del inventario y tratar precisión, depósitos, lotes, reservas y pendientes. Si la equivalencia varía, se necesita conteo o pesaje por operación. No se asume un factor para carne, helado o envases.

Sólo se podrá activar tras implementar y probar unidades versionadas o un traslado documentado a una presentación sucesora, y obtener la aprobación específica del plan. Ninguna de esas operaciones forma parte de esta publicación candidata.

## Evidencia y límites

Las pruebas automáticas usan datos sintéticos. No acreditan una sesión autenticada real en Supabase, documentos fiscales reales ni impresora física. Preview no equivale a producción. La instalación de funciones, permisos y guardas necesita aprobación informada antes de ejecutarse; corregir un producto real necesita además identificarlo y confirmar sus valores.
