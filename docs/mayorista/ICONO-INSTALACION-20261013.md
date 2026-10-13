# SIGO Vendedor: identidad de instalación

Corrección exclusiva de Mayorista: S negra sobre fondo blanco, nombre `SIGO Vendedor`, PNG opacos 192/512 y variantes maskable con el glifo dentro del círculo seguro de Android. La marca negra se preparó tomando la S oficial del repositorio como referencia. Se conservan los IDs, URLs de inicio y scopes de las dos entradas PWA existentes, para no cambiar las identidades de almacenamiento.

Se actualizan favicon PNG, apple-touch-icon, archivos publicados y caches de ambos Service Workers. Los iconos tienen versión explícita y respuestas `no-cache`. No se borra IndexedDB, no se modifican pedidos, cifrado ni sincronización. La entrada segura usa un bootstrap externo permitido por CSP y muestra el botón cuando Chrome emite `beforeinstallprompt`. Aceptar ese diálogo no se presenta como instalación física confirmada.

## Actualizar en Android

1. Abrir la Preview privada exacta en Chrome e iniciar sesión Vercel si lo solicita. No usar el navegador interno de otra aplicación. El acceso SSO debe seguir vigente al abrir el manifest y los iconos.
2. Si ya hay pedidos en el dispositivo, conservarlos y generar el respaldo cifrado antes de desinstalar. No borrar datos del sitio ni IndexedDB para cambiar el icono. Verificar primero que los pedidos conservados pueden recuperarse.
3. Abrir la misma entrada utilizada anteriormente: `/` para la entrada de demostración o `/secure.html` para la entrada operativa. La entrada operativa conserva su activación/API independiente; corregir el icono no activa una base ni una empresa.
4. Cerrar todas las ventanas de la aplicación anterior y reabrir la URL con conexión, para que se active el Service Worker actualizado. Android puede tardar en renovar metadatos de una PWA instalada.
5. Si se decide reinstalar después del respaldo, retirar la instalación anterior desde Android y usar «Instalar SIGO Vendedor» o la opción «Instalar aplicación» de Chrome. Si solo ofrece «Crear acceso directo», registrar el bloqueo y no presentarlo como WebAPK instalado.
6. Verificar el nombre e icono en el lanzador y Ajustes → Aplicaciones, apertura standalone sin barra de Chrome, reinicio del teléfono y recuperación offline de pedidos. Registrar modelo, versión Android/Chrome, URL exacta y commit.

## Límites de la verificación

Las pruebas automatizadas comprueban dimensiones, PNG opaco negro/blanco, máscara segura, manifest y criterios Chromium, además de la regresión de pedidos. No sustituyen una instalación física ni confirman actualización del icono en el lanzador Android.

Una Preview con SSO puede impedir que el servicio de Android descargue el manifest/iconos sin las cookies del teléfono y provocar instalación como acceso directo. No se deshabilita la protección para ocultarlo. Se debe comprobar este caso en el teléfono autorizado; si ocurre, hace falta acordar un mecanismo de distribución privada compatible con WebAPK antes de afirmar instalación Android completa.
