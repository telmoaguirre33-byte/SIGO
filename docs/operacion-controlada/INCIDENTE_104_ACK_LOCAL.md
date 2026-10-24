# Incidente 104: confirmación local tardía y defensa del contrato

## Defecto reproducido
Una venta puede devolver su UUID después de que Caja se desmonta. Si otra instancia se monta antes de ese ACK, carga el snapshot pendiente. La instancia anterior guarda después el registro confirmado en sessionStorage, pero la nueva conserva su copia pendiente. Antes de esta corrección, Recuperar rechazaba el registro confirmado como cambiado y pedía recargar, sin emitir otra RPC.

Este defecto explica un aviso pendiente desactualizado. **No se reprodujo que mantenga indefinidamente «Verificando».** No se atribuye como causa de todos los reportes productivos.

## Corrección acotada
Al recuperar, aceptar el registro ya confirmado sólo con empresa, clave y huella idénticas, UUID válido y contexto de sesión estable conocido. Adoptar su UUID sin confirmar_venta_sigo_v2, sin crear ventas, sin borrar registros y sin emisión ni impresión automática. Mantener la protección si el registro cambió, es inválido o la sesión/empresa ya no coincide. El registro legacy no identifica al usuario que originó la venta: la guardia acredita estabilidad del contexto actual, no autoría histórica.

Además, exigir UUID escalar válido al recibir ACK. El contrato SQL actual es UUID; un objeto JSON fuera de contrato no debe convertirse en «[object Object]» ni marcar una confirmación.

## Evidencia y límites
Harness independiente con Supabase SDK real, ventas.ts, React POS y almacenamiento local; transporte HTTP y servicios auxiliares sintéticos. Incluye ACK válido en empresas/sesiones aisladas, cuerpo vacío/truncado, storage fallido, cambio de empresa, desmontaje/remontaje y reloj real de 25 segundos. No representa dispositivos físicos ni sesiones comerciales.

La lectura acotada de metadatos confirmó una sola firma SQL de seis argumentos que retorna UUID. Un RPC observado devolvió JSON con longitud38, compatible con UUID entre comillas; esto no prueba recepción en el navegador ni identidad de un intento particular.

No se ejecutan migraciones, SQL productivo, ARCA, gastos ni limpieza de pendientes. Esta propuesta requiere aprobación separada antes de producción. PR106 ya publicado sigue siendo la base; no se modifica retrospectivamente.
