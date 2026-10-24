# Incidente 104: evidencia y límites

Fecha: 2026-10-24. Base inspeccionada: bcadd782ca9ceca0b37dfe8bbbc75f236560a068.

## Hechos comprobados

- El usuario reportó bloqueo en varias cajas tras intentar cobrar, tanto productos por unidad como por peso. Issue: https://github.com/telmoaguirre33-byte/SIGO/issues/104.
- El frontend persiste la clave y el pedido antes de confirmar. Conserva el intento cuando desconoce el resultado para evitar una venta duplicada.
- En la base inspeccionada, dos lecturas previas al RPC y el RPC no tienen un plazo máximo de aplicación. Una promesa que no termina puede mantener el indicador y la exclusión de cobro indefinidamente.
- Prueba sintética sobre los tres módulos reales de main: una lectura previa que no resuelve mantiene pendiente el intento, sin haber enviado el RPC. Rechazos simulados de autenticación/permisos/contrato no pertenecientes a la lista P0001 también permanecen pendientes. Estos casos demuestran recorridos de código, NO su ocurrencia comercial.
- Consulta acotada de registros del servidor entre 16:00 y 20:50 UTC: cinco POST al RPC de confirmación devolvieron HTTP 200; la consulta no encontró HTTP >=400. No se correlacionaron con registros, personas ni pedidos comerciales. No se debe inferir el resultado de una venta concreta a partir de estos registros.
- Contrato RPC verificado mediante metadatos: una única función de seis argumentos (empresa, items, medio, clave, cliente, descuento), retorno UUID escalar. Coincide con el frontend. Índice único por empresa y clave, y comprobación de huella, presentes.
- El SDK espera token antes de fetch y consumo del cuerpo después del status. HTTP 200 en servidor no demuestra recepción completa ni actualización del estado del navegador.

## No comprobado

No está acreditado qué promesa, red o condición produjo cada incidente real. No se inspeccionaron sesiones comerciales ni se conciliaron intentos reales. No se atribuye la falla a una caída de Supabase, a ARCA ni al candidato Productos #105.

## Límites de seguridad

No borrar almacenamiento pendiente. No crear una clave nueva para una operación incierta. Una lectura vacía, fallo de permisos o rechazo del reintento actual no descarta una escritura anterior. No automatizar reintentos, impresión ni emisión fiscal al recuperar. Datos de prueba exclusivamente sintéticos; ninguna operación comercial, migración ni cambio de permisos.

## Criterio de entrega

La corrección debe demostrar fin de la espera de interfaz, cancelación de transporte y barreras contra continuación tardía, conservando pedido y clave originales. La producción permanece sin cambios hasta autorización separada. CI y Preview no sustituyen conciliación de los incidentes ni validación con hardware físico.
