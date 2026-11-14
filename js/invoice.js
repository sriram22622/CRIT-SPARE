import { api } from './api.js';
import { STORAGE_KEYS } from './config.js';
import { startPaperCurl } from './shaders/paper-curl.js';
import { startThermalBurnIn } from './shaders/thermal-burn-in.js';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fill(invoice, root) {
  if (!invoice || !Array.isArray(invoice.items)) throw new Error('Invoice data is incomplete.');
  const receipt = root.querySelector('.receipt'); const rows = invoice.items.map(item => `<div class="receipt__row"><div><b>${safe(item.name)}</b><small>SKU: ${safe(item.sku)} • Bin: ${safe(item.bin)}</small></div><span>${item.qty} @ ${money(item.unitPrice)}</span><b>${money(item.amount)}</b></div>`).join('');
  const taxLabel = 'GST (18%)';
  receipt.innerHTML = `<div class="receipt__top"><strong>★ CRIT-SPARE ${safe(invoice.shopName || 'INVENTORY STATION')} ★</strong><span>Orbital Inventory &amp; Spares Station</span><span>${safe(invoice.station || 'Station')}</span></div><div class="receipt__meta"><span>Slip No: ${safe(invoice.number || invoice.id)}</span><span>Date: ${safe(new Date(invoice.createdAt).toLocaleString())}</span><span>Operator: ${safe(invoice.operator || 'Station Operator')}</span><span>Slip Status: ${safe(invoice.status || 'DISPENSED')}</span></div><div class="receipt__table"><div class="receipt__row receipt__row--head"><b>PART SPECIFICATION</b><b>QTY / RATE</b><b>AMOUNT</b></div>${rows || '<p>No invoice items were returned.</p>'}</div><div class="receipt__totals"><div><span>Subtotal</span><b>${money(invoice.subtotal)}</b></div><div><span>${taxLabel}</span><b>${money(invoice.tax)}</b></div>${invoice.discount ? `<div><span>Discount</span><b>−${money(invoice.discount)}</b></div>` : ''}<div class="receipt__total"><strong>FINAL TOTAL DUE</strong><strong>${money(invoice.total)}</strong></div></div><div class="receipt__payment"><span>Payment Mode: ${safe(invoice.paymentMode || 'Ledger')}</span><span>Transaction Ref: ${safe(invoice.transactionRef || invoice.number || invoice.id)}</span><span class="paid-stamp">★ PAID ★<small>DOCK-04 AUTH</small></span></div><div class="receipt__barcode"><div class="barcode"></div><span>* ${safe(invoice.number || invoice.id)} *</span></div><p class="receipt__thanks">THANK YOU • SAFE ORBITAL PASSAGE</p>`;
  root.querySelectorAll('.summary-lines b').forEach((node, index) => node.textContent = [money(invoice.subtotal), money(invoice.tax), invoice.discount ? `−${money(invoice.discount)}` : money(0)][index]);
  const total = root.querySelector('.grand-total strong'); const dollars = Number(invoice.total || 0).toFixed(2).split('.'); total.innerHTML = `${Number(dollars[0]).toLocaleString('en-IN')}<small>.${dollars[1]}</small>`;
  root.querySelector('.machine__head strong').innerHTML = `<i class="status-dot status-dot--green"></i> ${safe(invoice.number || invoice.id)} READY`;
}
function clearInvoice(root, message) {
  let user = {}; try { user = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore malformed local profile */ }
  root.querySelector('.receipt').innerHTML = `<div class="receipt__top"><strong>★ CRIT-SPARE ${safe(user.shopName || 'INVENTORY STATION')} ★</strong><span>Orbital Inventory &amp; Spares Station</span><span>${safe(user.station || 'Station')}</span></div><div class="receipt__meta"><span>Slip No: —</span><span>Date: —</span><span>Operator: —</span><span>Slip Status: —</span></div><div class="receipt__table"><div class="receipt__row receipt__row--head"><b>PART SPECIFICATION</b><b>QTY / RATE</b><b>AMOUNT</b></div><p>${safe(message)}</p></div><p class="receipt__thanks">A receipt will appear here after a dispense.</p>`;
  root.querySelectorAll('.summary-lines b').forEach(node => { node.textContent = '—'; });
  root.querySelector('.grand-total strong').innerHTML = '0<small>.00</small>';
  root.querySelector('.machine__head strong').textContent = 'NO BILL';
}
export async function initInvoice() {
  const root = document.querySelector('[data-invoice-root]'); const region = document.querySelector('[data-receipt]'); if (!root || !region) return;
  const announce = msg => { let node = root.querySelector('[data-invoice-state]'); if (!node) { node = document.createElement('p'); node.dataset.invoiceState = ''; node.className = 'pill'; node.setAttribute('aria-live', 'polite'); region.before(node); } node.textContent = msg; };
  clearInvoice(root, 'Loading invoice…');
  const id = new URLSearchParams(location.search).get('id') || localStorage.getItem(STORAGE_KEYS.lastInvoice);
  let hasInvoice = false;
  if (id) {
    announce('Loading invoice…');
    try { const result = await api.getInvoice(id); fill(result.invoice, root); hasInvoice = true; announce('Invoice loaded.'); }
    catch (error) { clearInvoice(root, error.message); announce(error.message); document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
  } else { const message = 'No recent invoice. Dispense a part from inventory to create one.'; clearInvoice(root, message); announce(message); }
  root.querySelectorAll('[data-action="tear-slip"], [data-action="replay-dispense"]').forEach(button => { button.disabled = !hasInvoice; });
  const variantInputs = root.querySelectorAll('input[data-invoice-variant]');
  variantInputs.forEach(input => input.addEventListener('change', () => {
    root.dataset.invoiceVariant = input.value; root.classList.toggle('invoice--tearoff', input.value === 'tearoff'); root.classList.toggle('invoice--carbon', input.value === 'carbon');
    const canvas = root.querySelector('#invoice-shader-canvas'); canvas.dataset.shader = input.value === 'tearoff' ? 'thermal' : 'paper-curl';
    canvas.removeAttribute('data-shader-active');
    try { const started = input.value === 'tearoff' ? startThermalBurnIn(canvas) : startPaperCurl(canvas); if (started) root.setAttribute('data-shader-active', ''); }
    catch { root.removeAttribute('data-shader-active'); }
  }));
  const tear = () => { if (!hasInvoice) return; root.classList.add('invoice--tearoff'); root.dataset.invoiceVariant = 'tearoff'; const tearInput = root.querySelector('[data-invoice-variant="tearoff"]'); if (tearInput) tearInput.checked = true; region.classList.remove('feed-replay'); void region.offsetWidth; region.classList.add('feed-replay'); setTimeout(() => region.classList.remove('feed-replay'), 1200); };
  root.querySelector('[data-action="tear-slip"]')?.addEventListener('click', tear);
  root.querySelector('[data-action="replay-dispense"]')?.addEventListener('click', () => { tear(); document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Receipt feed replayed.' })); });
  root.querySelectorAll('[data-action="download-invoice"], [data-action="print-invoice"], [data-action="share-invoice"]').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault(); if (!hasInvoice) { document.dispatchEvent(new CustomEvent('app:toast', { detail: 'There is no invoice to share or print yet.' })); return; }
    if (link.dataset.action === 'download-invoice' || link.dataset.action === 'print-invoice') { window.print(); return; }
    try { await navigator.clipboard.writeText(location.href); document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Invoice link copied. You can paste it into WhatsApp.' })); }
    catch { document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Clipboard access is unavailable. Copy the address bar link to share this invoice.' })); }
  }));
  if (hasInvoice) { region.setAttribute('tabindex', '0'); region.setAttribute('role', 'button'); region.setAttribute('aria-label', 'Replay receipt tear animation'); region.addEventListener('click', tear); region.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tear(); } }); }
  else { region.removeAttribute('role'); region.removeAttribute('tabindex'); }
}
