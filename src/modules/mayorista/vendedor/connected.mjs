import {createMayoristaClient} from '../sync/http-client.mjs';
import {PedidosIndexedDB} from '../offline/pedidos-indexeddb.js';
import {guardarCatalogo,leerCatalogo,antiguedadCatalogoHoras} from '../offline/catalogo-indexeddb.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Pantalla conectada exclusiva QA. Desactivada y sin endpoint comercial por defecto. */
export function mountConnectedSeller(app,{enabled=false,qa=false,baseUrl}={}){
  if(!enabled||!qa){app.textContent='Conexión de pruebas pendiente de habilitación autorizada. La App Vendedor demo sigue disponible.';return;}
  if(new URL(baseUrl).origin!==location.origin)throw new Error('La pantalla QA exige API en su propio origen aislado');
  const client=createMayoristaClient({enabled:true,baseUrl});let identity,catalog,queue,orders=[],message='',busy=false;
  const render=()=>{
    if(!identity){app.innerHTML=`<h1>App Vendedor · QA conectada</h1><p>Solo datos ficticios. Conexión real al backend aislado.</p><form id="login"><label>Empresa<input name="empresaId" required></label><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label><button>Iniciar sesión QA</button></form><p role="status">${esc(message)}</p>`;return;}
    app.innerHTML=`<h1>App Vendedor · QA conectada</h1><p>Empresa ${esc(identity.empresaId)} · Vendedor ${esc(identity.vendedorId)}</p><p role="status">${esc(message)}</p><button id="download">Descargar catálogo propio</button><form id="order"><label>Cliente<select name="clienteId">${(catalog?.clientes??[]).map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select></label><label>Producto / presentación<select name="precioId">${(catalog?.precios??[]).map(p=>`<option value="${esc(p.id)}">${esc(catalog.productos.find(x=>x.id===p.productoId)?.nombre)} · ${p.unidadesBase} unidades · ARS ${p.precio}</option>`).join('')}</select></label><label>Cantidad de presentaciones<input name="cantidad" type="number" min="1" step="1" value="1" required></label><button>Guardar pedido en el dispositivo</button></form><button id="sync">Sincronizar con API QA</button><button id="logout">Cerrar sesión</button><h2>Pedidos persistidos</h2>${orders.map(p=>`<article data-order-id="${esc(p.id)}"><b>${esc(p.estado)}</b> · ${esc(p.id)}${p.error?`<p>${esc(p.error)}</p>`:''}</article>`).join('')}`;
  };
  const download=async()=>{
    const raw=await client.catalog();if(raw.empresaId!==identity.empresaId||raw.vendedorId!==identity.vendedorId||!Array.isArray(raw.clientes)||!Array.isArray(raw.productos)||!Array.isArray(raw.precios)||!Number.isFinite(Date.parse(raw.descargadoEn)))throw new Error('Catálogo fuera de la sesión/estructura inválida');
    const stamp=raw.descargadoEn;
    catalog={empresaId:identity.empresaId,vendedorId:identity.vendedorId,version:stamp,descargadoEn:stamp,clientes:raw.clientes.map(c=>({...c,habilitado:true,actualizadoEn:stamp})),productos:raw.productos.map(p=>({...p,codigo:p.id,unidadBase:'unidad',activo:true,actualizadoEn:stamp})),precios:raw.precios.map(p=>({...p,precio:Number(p.precio),listaId:'qa',presentacion:p.unidadesBase===1?'unidad':`pack ${p.unidadesBase}`,moneda:'ARS',actualizadoEn:stamp}))};
    if(catalog.precios.some(p=>!Number.isFinite(p.precio)||p.precio<0||!Number.isSafeInteger(p.unidadesBase)||p.unidadesBase<1))throw new Error('Precios inválidos');await guardarCatalogo(catalog);message='Catálogo descargado y persistido.';
  };
  async function run(fn){if(busy)return;busy=true;try{await fn();if(queue)orders=await queue.listar();}catch(e){message=e.message;}finally{busy=false;render();}}
  app.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const id=e.target.id;run(async()=>{
    if(id==='login'){identity=await client.login(d);queue=new PedidosIndexedDB(identity.empresaId,identity.vendedorId);catalog=await leerCatalogo(identity.empresaId,identity.vendedorId);await download();return;}
    if(id==='order'){if(!catalog||antiguedadCatalogoHoras(catalog)>24)throw new Error('Descargá un catálogo vigente');const p=catalog.precios.find(p=>p.id===d.precioId);if(!p||!catalog.clientes.some(c=>c.id===d.clienteId))throw new Error('Cliente/producto no asignado');const cantidad=Number(d.cantidad)*p.unidadesBase;const saved=await queue.crear(d.clienteId,[{productoId:p.productoId,cantidad,precioUnitario:p.precio/p.unidadesBase}]);message='Pedido guardado: '+saved.id;}
  });});
  app.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(!id)return;run(async()=>{if(id==='download')await download();if(id==='sync'){const r=await queue.sincronizar(p=>client.send(p));message=`Sincronizados: ${r.enviados}; pendientes con error: ${r.fallidos}`;}if(id==='logout'){await client.logout();identity=null;catalog=null;queue=null;orders=[];message='Sesión cerrada. Pedidos conservados.';}});});
  render();return {client};
}
