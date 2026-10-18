const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Plano offline de coordenadas descargadas; no envía ubicaciones a terceros.
 * No representa cartografía callejera ni navegación giro a giro. */
export function renderCustomerMap(customers){
 const points=customers.filter(c=>c.latitud!==null&&c.longitud!==null&&c.latitud!==undefined&&c.longitud!==undefined).map(c=>({...c,lat:Number(c.latitud),lng:Number(c.longitud)})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&Math.abs(c.lat)<=90&&Math.abs(c.lng)<=180);
 if(!points.length)return '<p>Los clientes descargados todavía no tienen coordenadas.</p>';
 const minLat=Math.min(...points.map(c=>c.lat)),maxLat=Math.max(...points.map(c=>c.lat)),minLng=Math.min(...points.map(c=>c.lng)),maxLng=Math.max(...points.map(c=>c.lng));
 return `<svg viewBox="0 0 320 210" role="img" aria-label="Ubicación relativa de clientes descargados" style="width:100%;max-height:220px;background:#e7f3ef;border-radius:12px"><path d="M20 100H300M160 20V180" stroke="#a5c8bb"/>${points.map((c,n)=>{const x=30+260*(c.lng-minLng)/(maxLng-minLng||1),y=175-140*(c.lat-minLat)/(maxLat-minLat||1);return `<g><title>${esc(c.nombre)} · ${c.lat}, ${c.lng}</title><circle cx="${x}" cy="${y}" r="8" fill="#0d9488"/><text x="${x+10}" y="${y}" font-size="11">${n+1}</text></g>`}).join('')}</svg><ol>${points.map(c=>`<li>${esc(c.nombre)} · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</li>`).join('')}</ol><small>Plano de coordenadas disponible sin conexión. No es navegación callejera.</small>`;
}
