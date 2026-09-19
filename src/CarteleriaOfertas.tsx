import { useMemo, useState } from "react";
import type { ProductoSigo } from "./productos";

type Props = { productos: ProductoSigo[] };
type FormatoOferta = "a4_4" | "a4_2";
type OrientacionOferta = "horizontal" | "vertical";

function html(value: unknown) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function dinero(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(Number(valor))) return "";
  return `$ ${Number(valor).toLocaleString("es-AR",{maximumFractionDigits:2})}`;
}

export default function CarteleriaOfertas({ productos }: Props) {
  const [abierto,setAbierto]=useState(false);
  const [busqueda,setBusqueda]=useState("");
  const [productoId,setProductoId]=useState("");
  const [precioOferta,setPrecioOferta]=useState("");
  const [titulo,setTitulo]=useState("OFERTA");
  const [formato,setFormato]=useState<FormatoOferta>("a4_4");
  const [orientacion,setOrientacion]=useState<OrientacionOferta>("horizontal");
  const [error,setError]=useState("");

  const visibles=useMemo(()=>{
    const q=busqueda.trim().toLowerCase();
    if(!q) return productos.slice(0,80);
    return productos.filter(p=>[p.nombre,p.codigo_barras,p.codigo_interno,p.marca].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0,80);
  },[productos,busqueda]);
  const producto=productos.find(p=>p.id===productoId)??null;

  function elegir(id:string){
    setProductoId(id);
    const p=productos.find(x=>x.id===id);
    setPrecioOferta(p?.precio_venta!=null?String(p.precio_venta):"");
    setError("");
  }

  function imprimir(){
    setError("");
    if(!producto){setError("Seleccioná un producto.");return;}
    const oferta=Number(precioOferta.replace(",","."));
    if(!Number.isFinite(oferta)||oferta<=0){setError("Ingresá un precio de oferta mayor a cero.");return;}
    const cantidad=formato==="a4_4"?4:2;
    const horizontal=orientacion==="horizontal";
    const cartelClass=horizontal ? "cartel horizontal" : "cartel vertical";
    const carteles=Array.from({length:cantidad},()=>`<article class="${cartelClass}">
      <div class="titulo">${html(titulo.trim()||"OFERTA")}</div>
      <div class="producto">${html(producto.nombre)}</div>
      ${producto.marca?`<div class="marca">${html(producto.marca)}</div>`:""}
      ${Number(producto.precio_venta||0)>0?`<div class="antes">Precio habitual: ${html(dinero(producto.precio_venta))}</div>`:""}
      <div class="precio">${html(dinero(oferta))}</div>
    </article>`).join("");
    // La orientación describe cada cartel, no la hoja. A4 x4 siempre conserva 2x2.
    const grid=formato==="a4_4"
      ? (horizontal
          ? "grid-template-columns:1fr;grid-template-rows:repeat(4,1fr);"
          : "grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);")
      : (horizontal
          ? "grid-template-columns:1fr;grid-template-rows:repeat(2,1fr);"
          : "grid-template-columns:repeat(2,1fr);grid-template-rows:1fr;");
    const ventana=window.open("","_blank","width=980,height=760");
    if(!ventana){setError("El navegador bloqueó la ventana de impresión. Habilitá ventanas emergentes para SIGO.");return;}
    ventana.opener=null;
    ventana.document.open();
    ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SIGO · Ofertas</title><style>
      @page{size:A4 portrait;margin:8mm} *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      html,body{margin:0;padding:0;width:100%;height:100%}.hoja{width:194mm;height:281mm;display:grid;${grid}gap:4mm}
      .cartel{border:3px solid #111;border-radius:4mm;display:grid;align-items:center;justify-items:center;text-align:center;padding:6mm;overflow:hidden;break-inside:avoid;position:relative}
      .cartel:before{content:"";position:absolute;inset:2mm;border:2px solid #e11d48;border-radius:3mm;pointer-events:none}
      .cartel.vertical{grid-template-rows:minmax(42mm,1.15fr) auto auto auto;align-content:center;gap:3mm}
      .cartel.horizontal{grid-template-columns:minmax(45%,1fr) minmax(0,1fr);grid-template-rows:auto auto auto;column-gap:7mm;row-gap:1mm;align-content:center;padding:3mm 7mm}
      .titulo{position:relative;z-index:1;display:grid;place-items:center;width:min(100%,78mm);aspect-ratio:1.75/1;padding:5mm;background:#ffe500;color:#e10600;font-size:${formato==="a4_4"?"25px":"36px"};font-weight:950;letter-spacing:.06em;clip-path:polygon(50% 0%,61% 18%,80% 6%,82% 29%,100% 34%,87% 50%,100% 67%,79% 72%,78% 96%,59% 83%,50% 100%,40% 82%,20% 95%,20% 72%,0 66%,13% 50%,0 34%,19% 29%,20% 6%,40% 18%);text-shadow:1px 1px 0 #fff}
      .producto{position:relative;z-index:1;font-size:${formato==="a4_4"?"18px":"25px"};font-weight:900;line-height:1.08;max-width:100%;overflow-wrap:anywhere}
      .marca{position:relative;z-index:1;font-size:13px}
      .antes{position:relative;z-index:1;font-size:13px;text-decoration:line-through}
      .precio{position:relative;z-index:1;background:#e10600;color:#ffe500;border-radius:4mm;padding:3mm 6mm;font-size:${formato==="a4_4"?"35px":"52px"};font-weight:950;line-height:1;white-space:nowrap;max-width:100%}
      .horizontal .titulo{grid-row:1 / 4;grid-column:1;width:100%;max-width:88mm;max-height:58mm;font-size:${formato==="a4_4"?"34px":"46px"};filter:drop-shadow(2px 2px 0 #e10600)}
      .horizontal .producto{grid-column:2;grid-row:1;align-self:end;font-size:${formato==="a4_4"?"20px":"28px"}}
      .horizontal .marca{grid-column:2;grid-row:1;align-self:start;margin-top:8mm}
      .horizontal .antes{grid-column:2;grid-row:2}
      .horizontal .precio{grid-column:2;grid-row:3;align-self:start;font-size:${formato==="a4_4"?"40px":"58px"};padding:4mm 7mm}
      .vertical .titulo,.vertical .producto,.vertical .marca,.vertical .antes,.vertical .precio{max-width:92%}
      @media print{html,body{width:210mm;height:297mm}.hoja{break-after:avoid}}
    </style></head><body><main class="hoja">${carteles}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body></html>`);
    ventana.document.close();
  }

  return <div style={{marginTop:12}}>
    <button className="admin-button" type="button" disabled={productos.length===0} onClick={()=>setAbierto(v=>!v)}>📣 Crear oferta / cartel</button>
    {abierto&&<div className="panel" style={{marginTop:12}}>
      <div className="page-header"><div><h3>Ofertas / Cartelería</h3><p>Creá carteles comerciales sin modificar el precio del producto en SIGO.</p></div></div>
      <div className="form-grid">
        <div className="form-group form-span-2"><label>Buscar producto</label><input type="search" value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Producto, código o marca"/></div>
        <div className="form-group form-span-2"><label>Producto</label><select value={productoId} onChange={e=>elegir(e.target.value)}><option value="">Seleccionar…</option>{visibles.map(p=><option key={p.id} value={p.id}>{p.nombre}{p.precio_venta!=null?` · ${dinero(p.precio_venta)}`:""}</option>)}</select></div>
        <div className="form-group"><label>Título</label><select value={titulo} onChange={e=>setTitulo(e.target.value)}><option>OFERTA</option><option>PROMO</option><option>IMPERDIBLE</option></select></div>
        <div className="form-group"><label>Precio oferta</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={precioOferta} onChange={e=>setPrecioOferta(e.target.value)}/></div>
        <div className="form-group"><label>Formato de impresión</label><select value={formato} onChange={e=>setFormato(e.target.value as FormatoOferta)}><option value="a4_4">A4 dividido en 4 · cuatro carteles</option><option value="a4_2">A4 dividido en 2 · dos carteles</option></select></div>
        <div className="form-group"><label>Orientación del cartel</label><select value={orientacion} onChange={e=>setOrientacion(e.target.value as OrientacionOferta)}><option value="horizontal">Horizontal · recomendado</option><option value="vertical">Vertical</option></select></div>
      </div>
      {producto&&<div className="sigo-matriz-success" style={{marginTop:12}}><strong>Vista previa:</strong> {titulo} · {producto.nombre} · {dinero(Number(precioOferta||0))}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" type="button" disabled={!productoId} onClick={imprimir}>Imprimir carteles</button></div>
    </div>}
  </div>;
}
