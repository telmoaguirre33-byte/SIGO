/** Instalación nativa ofrecida por Chrome; nunca simula un resultado exitoso. */
export function mountInstallation(container){
 if(!container)return;
 let deferred;
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const render=()=>{
  container.replaceChildren();
  const status=document.createElement('p');status.setAttribute('role','status');
  status.textContent=standalone()?'SIGO Vendedor está abierta como aplicación.':'Instalá SIGO Vendedor desde Chrome. Si aparece solo «Crear acceso directo», la instalación PWA todavía no está disponible.';
  container.append(status);
  if(deferred&&!standalone()){
   const button=document.createElement('button');button.type='button';button.textContent='Instalar SIGO Vendedor';
   button.addEventListener('click',async()=>{button.disabled=true;const event=deferred;deferred=undefined;try{await event.prompt();const result=await event.userChoice;status.textContent=result.outcome==='accepted'?'Solicitud aceptada. Esperá la confirmación de Android.':'Instalación cancelada; tus pedidos se conservan.';}catch{status.textContent='Chrome no pudo abrir la instalación. Reintentá desde su menú.';}button.remove();});
   container.append(button);
  }
 };
 const prompt=event=>{event.preventDefault();deferred=event;render();};
 const installed=()=>{deferred=undefined;render();};
 window.addEventListener('beforeinstallprompt',prompt);window.addEventListener('appinstalled',installed);render();
 return ()=>{window.removeEventListener('beforeinstallprompt',prompt);window.removeEventListener('appinstalled',installed);};
}
