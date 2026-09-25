import fs from "node:fs";
const path="src/VentaRapidaOperativa.tsx";
let s=fs.readFileSync(path,"utf8");
function change(a,b,label){if(!s.includes(a))throw Error("CAJA_MISSING:"+label);s=s.replace(a,b)}
change('  const [busquedaResetKey, setBusquedaResetKey] = useState(0);','  const [busquedaResetKey, setBusquedaResetKey] = useState(0);\n  const [ultimoTotal, setUltimoTotal] = useState(0);\n  const [anchoTicket, setAnchoTicket] = useState<"58" | "80">(() => localStorage.getItem("sigo-ticket-ancho") === "58" ? "58" : "80");',"state");
change('      setUltimaVentaTicket(resultado.ventaId);','      setUltimaVentaTicket(resultado.ventaId);\n      setUltimoTotal(totalConfirmado);',"sale");
change('      <div className="page-header">\n        <div>\n          <h2>Venta rápida</h2>\n          <p>Pistola USB/Bluetooth, ingreso manual o cámara celular. Confirmación transaccional con descuento de stock, caja y cuenta corriente por cliente.</p>\n        </div>','      <div className="page-header sigo-caja-banner">\n        <div><h2>CAJA - VENTA</h2></div>',"banner");
const start=s.indexOf('      <div className="panel">\n        <div className="page-header">\n          <div>\n            <h3>Carrito');
const end=s.indexOf('\n      <div className="panel">',start+10);
if(start<0||end<0)throw Error("CAJA_CART_MISSING");
let cart=s.slice(start,end);
const first=cart.indexOf('          <div className="topbar-actions"');
const last=cart.indexOf('\n          </div>\n        </div>',first);
if(first<0||last<0)throw Error("CAJA_SELECTOR_MISSING");
const selector=cart.slice(first,last+'\n          </div>'.length);
cart=cart.slice(0,first)+cart.slice(last+'\n          </div>'.length);
const actionStart=cart.lastIndexOf('        <div className="form-actions" style={{ flexWrap: "wrap" }}>');
const actionEnd=cart.lastIndexOf('\n      </div>');
if(actionStart<0||actionEnd<actionStart)throw Error("CAJA_ACTIONS_MISSING");
let actions=cart.slice(actionStart,actionEnd);
const old='<button type="button" className="admin-button" disabled={!ultimaVentaTicket || confirmando} onClick={()=>{if(ultimaVentaTicket)void imprimirTicketVenta(empresaId,ultimaVentaTicket).catch(err=>setError(err instanceof Error?err.message:"No se pudo imprimir el ticket."));}}>Imprimir ticket</button>';
if(!actions.includes(old))throw Error("CAJA_TICKET_MISSING");
actions=actions.replace(old,[
'<button type="button" className="admin-button" disabled={!ultimaVentaTicket || confirmando} onClick={() => { if (ultimaVentaTicket) void imprimirTicketVenta(empresaId, ultimaVentaTicket, anchoTicket).catch(err => setError(err instanceof Error ? err.message : "No se pudo imprimir el ticket.")); }}>Imprimir ticket</button>',
'<button type="button" className="primary-button" disabled={!ultimaVentaTicket || confirmando} onClick={() => { if (ultimaVentaTicket) window.dispatchEvent(new CustomEvent("sigo:arca:venta", { detail: { empresaId, ventaId: ultimaVentaTicket } })); }}>Emitir factura · ARCA</button>'
].join('\n          '));
const small=[
'<div className="sigo-caja-small-actions">',
'<button type="button" className="admin-button" disabled={!ultimaVentaTicket} onClick={() => { const mensaje = encodeURIComponent("Ticket de venta SIGO · Total $ " + ultimoTotal.toLocaleString("es-AR")); window.open("https://wa.me/?text=" + mensaje, "_blank", "noopener,noreferrer"); }}>WhatsApp</button>',
'<button type="button" className="admin-button" disabled={!ultimaVentaTicket} onClick={() => { if (ultimaVentaTicket) void imprimirTicketVenta(empresaId, ultimaVentaTicket, "a4").catch(err => setError(err instanceof Error ? err.message : "No se pudo imprimir en A4.")); }}>Imprimir A4</button>',
'<button type="button" className="admin-button" disabled={!ultimaVentaTicket} onClick={() => { if (ultimaVentaTicket) void imprimirTicketVenta(empresaId, ultimaVentaTicket, anchoTicket).catch(err => setError(err instanceof Error ? err.message : "No se pudo imprimir el ticket.")); }}>Ticket</button>',
'<label>Formato <select aria-label="Ancho de impresora térmica" value={anchoTicket} onChange={event => { const ancho = event.target.value === "58" ? "58" : "80"; setAnchoTicket(ancho); localStorage.setItem("sigo-ticket-ancho", ancho); }}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>',
'</div>',
'<small>Para facturar, primero confirmá la venta. ARCA abrirá esta venta y pedirá los datos y la autorización fiscal. Elegí 58 u 80 mm según tu impresora.</small>'
].join('\n          ');
cart=cart.slice(0,actionStart)+'        </div>\n        <aside className="sigo-caja-checkout">\n'+selector+'\n'+actions+'\n          '+small+'\n        </aside>'+cart.slice(actionEnd);
cart=cart.replace('      <div className="panel">\n        <div className="page-header">','      <div className="panel sigo-caja-grid">\n        <div className="sigo-caja-items">\n        <div className="page-header">').replace('<div style={{ display: "grid", gap: 10 }}>','<div className="sigo-caja-list" style={{ display: "grid", gap: 10 }}>');
s=s.slice(0,start)+cart+s.slice(end);
fs.writeFileSync(path,s,"utf8");
const arcaPath="src/ArcaCaeEmission.tsx";
let arca=fs.readFileSync(arcaPath,"utf8");
const oldSelect='setVentaId((actual) => recientes.some((item) => item.id === actual) ? actual : recientes[0]?.id ?? "");';
if(!arca.includes(oldSelect))throw Error("CAJA_ARCA_SELECTION_MISSING");
arca=arca.replace(oldSelect,'setVentaId((actual) => recientes.some((item) => item.id === ventaInicialId) ? String(ventaInicialId) : recientes.some((item) => item.id === actual) ? actual : recientes[0]?.id ?? "");');
fs.writeFileSync(arcaPath,arca,"utf8");
console.log("SIGO_CAJA_LAYOUT_OK");
