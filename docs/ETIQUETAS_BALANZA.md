# Etiquetas de balanza — primera integración, pendiente de publicación

Esta rama agrega lectura de una etiqueta impresa, no controla ni programa una balanza. Deshabilitada por defecto. No cambia SQL, RLS, datos comerciales, facturación fiscal ni Mayorista.

## Configuración

En Caja → Etiquetas de balanza, un usuario con permiso de editar Productos puede indicar prefijo (dos dígitos), longitud de PLU, peso en kg o cantidad de unidades y decimales. Vincula cada PLU explícitamente a un producto de la empresa; se conservan ceros iniciales. Para peso, el producto debe tener unidad kg, stock y precio por kg. La cantidad de unidades es entera.

El perfil se guarda sólo en localStorage de ese usuario, empresa y navegador. No sincroniza cajas, empleados, dispositivos o cambios del administrador. No es una política de seguridad del servidor. La base conserva sus validaciones de autorización, stock, cantidades y cobro. Si se necesita configuración empresarial centralizada, requiere una entrega independiente con persistencia y permisos de servidor; no está fingida en esta versión.

La estructura admitida es exclusivamente: prefijo + PLU + valor + dígito EAN-13. No hay dígito interno adicional. Debe cotejarse una etiqueta real contra el manual del modelo antes de habilitar. No se asignan prefijos universales automáticamente. Perfiles de importe se rechazan: dividir importe redondeado por precio no determina peso exacto.

## Operación

Primero se consulta el código exacto normal, incluidos alias del servidor. Sólo una consulta exitosa sin coincidencias habilita decodificar una etiqueta. Un error de red/permisos nunca se toma como ausencia. Si un código normal coincide también con un PLU válido del perfil, se bloquea por ambigüedad.

La etiqueta agrega producto y cantidad al carrito, NO cobra. Descripción y precio provienen de SIGO, no del texto impreso. Ofertas/descuentos habituales de SIGO siguen aplicándose; una etiqueta de peso no verifica que el precio impreso sea igual. Dos lecturas deliberadas del mismo código son dos paquetes; la protección temporal de cámara se conserva. Stock acumulado y confirmación final se validan por el flujo existente.

Desactivar el perfil no borra ventas ni intentos pendientes. Cambiar perfil/empresa/usuario invalida lecturas en curso. Los errores de almacenamiento se muestran; no se promete persistencia si el navegador la rechaza.

## Límites y aceptación pendiente

Pruebas sólo con datos sintéticos. Pendientes etiqueta real, modelo/layout, lector físico, impresora de la balanza y sesión comercial autenticada. Sin promesa de compatibilidad EAN-128/Code128/QR ni de todos los fabricantes.

Fuentes: GS1 General Specifications 26.0 https://ref.gs1.org/standards/genspecs/ ; GS1 Argentina manual histórico 2009 https://www.gs1.org.ar/documentos/MANUAL%20USUARIO.pdf ; ejemplo de formatos programables https://www.dibal.com/en/retail-scales-wind-series . No sustituir la configuración real por ejemplos del manual histórico.
