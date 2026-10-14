import {buildProductIndex, customerFrequencies, searchProducts} from './product-search.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = price => new Intl.NumberFormat('es-AR', {style:'currency', currency:price.moneda ?? 'ARS'}).format(Number(price.precio));

/** Combobox reutilizable en las entradas independientes del vendedor. */
export function createProductPicker() {
  let host, index = [], catalogRef, pricesRef, customer, frequencies = new Map(), results = [], highlighted = -1;
  let query = '', productId = '', priceId = '', open = false, stopCamera = () => {};
  const selected = () => index.find(entry => entry.product.id === productId);
  function paint() {
    if (!host) return;
    const input = host.querySelector('[data-product-query]'), list = host.querySelector('[role=listbox]');
    input.value = query; input.setAttribute('aria-expanded', String(open));
    if (open && highlighted >= 0 && results[highlighted]) input.setAttribute('aria-activedescendant', 'product-result-' + highlighted);
    else input.removeAttribute('aria-activedescendant');
    list.hidden = !open;
    list.innerHTML = open ? results.map((entry, i) => {
      const p = entry.product, price = entry.prices[0], code = [p.codigo ?? p.codigoInterno, p.ean ?? p.codigoBarras].filter(Boolean).join(' · ');
      return `<li id="product-result-${i}" role="option" aria-selected="${i === highlighted}" data-result="${i}"><b>${esc(p.nombre ?? p.descripcion ?? p.id)}</b><span>${esc(price.presentacion ?? `${price.unidadesBase} unidades`)} · ${esc(money(price))}</span><small>${esc([p.marca, code, entry.frequency ? 'Frecuente de este cliente' : ''].filter(Boolean).join(' · '))}</small></li>`;
    }).join('') : '';
    host.querySelector('[data-search-status]').textContent = open ? (results.length ? (query.trim() ? `${results.length} resultados · ↑ ↓ y Enter para elegir` : (results.some(r => r.frequency) ? 'Frecuentes de este cliente · también podés buscar todo el catálogo' : 'Catálogo local · escribí para buscar')) : 'Sin coincidencias en el catálogo local') : (productId ? 'Producto elegido' : 'Buscá por nombre, marca, código o EAN');
    const presentation = host.querySelector('[data-product-presentation]'), entry = selected();
    presentation.innerHTML = '<option value="">Elegir producto primero</option>' + (entry?.prices ?? []).map(p => `<option value="${esc(p.id)}">${esc(p.presentacion ?? `${p.unidadesBase} unidades`)} · ${esc(money(p))}</option>`).join('');
    presentation.value = priceId; presentation.disabled = !entry;
  }
  function search() {results = searchProducts(index, query, frequencies); highlighted = results.length ? 0 : -1; open = true; paint();}
  function choose(entry) {
    if (!entry) return;
    productId = entry.product.id; priceId = entry.prices[0].id;
    query = entry.product.nombre ?? entry.product.descripcion ?? entry.product.id; open = false; highlighted = -1; paint();
    host.querySelector('[data-product-presentation]').focus();
  }
  async function camera() {
    const status = host.querySelector('[data-camera-status]');
    const panel = host.querySelector('[data-camera-panel]'), video = panel.querySelector('video');
    stopCamera(); panel.hidden = false; status.textContent = 'Solicitando cámara…';
    let cancelled = false, stream, timer;
    stopCamera = () => {cancelled = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); video.srcObject = null; panel.hidden = true;};
    try {
      const formats = await globalThis.BarcodeDetector.getSupportedFormats();
      const supported = ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf'].filter(f => formats.includes(f));
      if (!supported.length) throw new Error('El dispositivo no reconoce códigos de barras. Usá un lector o escribí el código.');
      const detector = new globalThis.BarcodeDetector({formats:supported});
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if (cancelled) {stream.getTracks().forEach(track => track.stop()); return;}
      video.srcObject = stream; await video.play();
      const scan = async () => {
        if (cancelled) return;
        const codes = await detector.detect(video);
        if (cancelled) return;
        if (codes[0]?.rawValue) {
          query = codes[0].rawValue; productId = ''; priceId = ''; stopCamera(); search();
          // Un escaneo solo selecciona códigos exactos y no agrega líneas automáticamente.
          const matches = results.filter(entry => entry.codes.includes(query.toLowerCase()));
          if (matches.length === 1) choose(matches[0]); else focus();
          status.textContent = matches.length === 1 ? 'Código encontrado' : 'Revisá los resultados del código leído';
          return;
        }
        timer = setTimeout(() => {void scan().catch(fail);}, 150);
      };
      status.textContent = 'Apuntá al código de barras'; await scan();
    } catch (error) {fail(error);}
    function fail(error) {if (cancelled) return; stopCamera(); status.textContent = error.name === 'NotAllowedError' ? 'Cámara sin permiso. Podés escribir el código o usar un lector.' : error.message; focus();}
  }
  function focus() {host?.querySelector('[data-product-query]')?.focus();}
  function mount(element, {products = [], prices = [], orders = [], customerId = ''} = {}) {
    stopCamera(); host = element;
    if (!host) return;
    if (catalogRef !== products || pricesRef !== prices) {catalogRef = products; pricesRef = prices; index = buildProductIndex(products, prices); if (!selected()?.prices.some(p => p.id === priceId)) clear();}
    if (customer !== customerId) {customer = customerId; clear();}
    frequencies = customerFrequencies(orders, customerId);
    const capable = globalThis.isSecureContext && typeof globalThis.BarcodeDetector?.getSupportedFormats === 'function' && !!navigator.mediaDevices?.getUserMedia;
    host.innerHTML = `<label for="product-query">Producto</label><div class="product-search-row"><input id="product-query" data-product-query type="search" role="combobox" aria-autocomplete="list" aria-controls="product-results" aria-expanded="false" aria-describedby="product-search-status" autocomplete="off" placeholder="Nombre, marca, código o EAN">${capable ? '<button type="button" data-scan aria-label="Leer código de barras con cámara">Cámara</button>' : ''}</div><ul id="product-results" role="listbox" aria-label="Productos" hidden></ul><small id="product-search-status" data-search-status role="status"></small><p data-camera-status role="status"></p><div data-camera-panel hidden><video muted playsinline aria-label="Cámara de códigos de barras"></video><button type="button" data-stop-camera>Cerrar cámara</button></div><label>Presentación<select data-product-presentation name="precioId"></select></label>`;
    const input = host.querySelector('[data-product-query]');
    input.addEventListener('input', () => {query = input.value; productId = ''; priceId = ''; search();});
    input.addEventListener('focus', () => {if (!productId) search();});
    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!open) {search(); if (e.key === 'ArrowUp') highlighted = results.length - 1;}
        else if (results.length) highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        paint(); host.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});
      }
      if (e.key === 'Enter') {e.preventDefault(); e.stopPropagation(); if (open) choose(results[highlighted]);}
      if (e.key === 'Escape') {e.preventDefault(); open = false; paint(); stopCamera();}
    });
    host.addEventListener('focusout', () => {queueMicrotask(() => {if (host && !host.contains(document.activeElement)) {open = false; paint();}});});
    host.querySelector('[role=listbox]').addEventListener('pointerdown', e => {if (e.target.closest('[data-result]')) e.preventDefault();});
    host.querySelector('[role=listbox]').addEventListener('click', e => {const row = e.target.closest('[data-result]'); if (row) choose(results[Number(row.dataset.result)]);});
    host.querySelector('[data-product-presentation]').addEventListener('change', e => {priceId = e.target.value;});
    host.querySelector('[data-scan]')?.addEventListener('click', () => {void camera();});
    host.querySelector('[data-stop-camera]').addEventListener('click', () => {stopCamera(); focus();});
    results = searchProducts(index, query, frequencies); paint();
  }
  function clear() {query = ''; productId = ''; priceId = ''; open = false; highlighted = -1;}
  return {mount, clear, focus, chooseProduct(id) {choose(index.find(entry => entry.product.id === id));},
    price() {return selected()?.prices.find(price => price.id === priceId);},
    dispose() {stopCamera(); host = null; index = []; catalogRef = undefined; pricesRef = undefined; frequencies.clear(); clear();}};
}
