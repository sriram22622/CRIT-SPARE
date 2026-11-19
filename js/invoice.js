import { api } from './api.js';
import { STORAGE_KEYS } from './config.js';
import { startPaperCurl } from './shaders/paper-curl.js';
import { startThermalBurnIn } from './shaders/thermal-burn-in.js';
import { getRole, getCart, clearCart, saveCustomerBill } from './customer.js';

const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roundMoney = value => Number(Number(value || 0).toFixed(2));

function fill(invoice, root) {
  if (!invoice || !Array.isArray(invoice.items)) throw new Error('Invoice data is incomplete.');
  const receipt = root.querySelector('.receipt');
  const rows = invoice.items.map(item => '<div class="receipt__row"><div><b>' + safe(item.name) + '</b><small>SKU: ' + safe(item.sku) + ' • Bin: ' + safe(item.bin) + '</small></div><span>' + Number(item.qty) + ' @ ' + money(item.unitPrice) + '</span><b>' + money(item.amount) + '</b></div>').join('');
  const isDraft = invoice.status === 'draft';
  const taxLabel = 'GST (18%)';
  const createdAt = invoice.createdAt ? new Date(invoice.createdAt).toLocaleString() : new Date().toLocaleString();
  const user = cachedUser();
  const shopName = invoice.shopName || user.shopName || 'INVENTORY STATION';
  const stationName = invoice.station || user.station || 'Station';
  const operatorName = invoice.operator || user.name || 'Station Operator';
  receipt.innerHTML = '<div class="receipt__top"><strong>★ CRIT-SPARE ' + safe(shopName) + ' ★</strong><span>Orbital Inventory &amp; Spares Station</span><span>' + safe(stationName) + '</span></div>' +
    '<div class="receipt__meta"><span>Slip No: ' + safe(invoice.number || invoice.id) + '</span><span>Date: ' + safe(createdAt) + '</span><span>Operator: ' + safe(operatorName) + '</span><span>Slip Status: ' + (isDraft ? 'DRAFT' : safe(invoice.status || 'DISPENSED')) + '</span></div>' +
    '<div class="receipt__table"><div class="receipt__row receipt__row--head"><b>PART SPECIFICATION</b><b>QTY / RATE</b><b>AMOUNT</b></div>' + (rows || '<p>No invoice items were returned.</p>') + '</div>' +
    '<div class="receipt__totals"><div><span>Subtotal</span><b>' + money(invoice.subtotal) + '</b></div><div><span>' + taxLabel + '</span><b>' + money(invoice.tax) + '</b></div>' +
    (invoice.discount ? '<div><span>Discount</span><b>−' + money(invoice.discount) + '</b></div>' : '') +
    '<div class="receipt__total"><strong>FINAL TOTAL DUE</strong><strong>' + money(invoice.total) + '</strong></div></div>' +
    '<div class="receipt__payment"><span>Payment Mode: ' + safe(invoice.paymentMode || (isDraft ? 'Payment pending' : 'Ledger')) + '</span><span>Transaction Ref: ' + safe(invoice.transactionRef || invoice.number || invoice.id) + '</span><span class="paid-stamp">★ ' + (isDraft ? 'DRAFT' : 'READY') + ' ★<small>' + (isDraft ? 'NOT SAVED' : 'BILL RECORD') + '</small></span></div>' +
    '<div class="receipt__barcode"><div class="barcode"></div><span>* ' + safe(invoice.number || invoice.id) + ' *</span></div><p class="receipt__thanks">THANK YOU • SAFE PASSAGE</p>';

  root.querySelectorAll('.summary-lines b').forEach((node, index) => node.textContent = [money(invoice.subtotal), money(invoice.tax), invoice.discount ? '−' + money(invoice.discount) : money(0)][index]);
  const total = root.querySelector('.grand-total strong');
  const dollars = Number(invoice.total || 0).toFixed(2).split('.');
  total.innerHTML = Number(dollars[0]).toLocaleString('en-IN') + '<small>.' + dollars[1] + '</small>';
  root.querySelector('.machine__head strong').textContent = (invoice.number || invoice.id) + (isDraft ? ' DRAFT' : ' READY');
  root.querySelector('.summary-card .pill--gold').textContent = isDraft ? 'Draft' : 'Cleared';
  root.querySelector('.verified').lastChild.textContent = isDraft ? 'Bill preview' : 'Bill saved';
}

function cachedUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); }
  catch { return {}; }
}

function clearInvoice(root, message) {
  const user = cachedUser();
  const shopName = user.shopName || (user.name ? `${user.name}'s Shop` : 'INVENTORY STATION');
  const stationName = user.station || 'Station';
  const operatorName = user.name || 'Station Operator';
  root.querySelector('.receipt').innerHTML = '<div class="receipt__top"><strong>★ CRIT-SPARE ' + safe(shopName) + ' ★</strong><span>Orbital Inventory &amp; Spares Station</span><span>' + safe(stationName) + '</span></div>' +
    '<div class="receipt__meta"><span>Slip No: —</span><span>Date: —</span><span>Operator: ' + safe(operatorName) + '</span><span>Slip Status: —</span></div>' +
    '<div class="receipt__table"><div class="receipt__row receipt__row--head"><b>PART SPECIFICATION</b><b>QTY / RATE</b><b>AMOUNT</b></div><p>' + safe(message) + '</p></div><p class="receipt__thanks">Your saved bill will appear here.</p>';
  root.querySelectorAll('.summary-lines b').forEach(node => { node.textContent = '—'; });
  root.querySelector('.grand-total strong').innerHTML = '0<small>.00</small>';
  root.querySelector('.machine__head strong').textContent = 'NO BILL';
  root.querySelector('.summary-card .pill--gold').textContent = 'Draft';
  root.querySelector('.verified').lastChild.textContent = 'Add items to begin';
}

function draftInvoice(lines) {
  const user = cachedUser();
  const items = lines.map(line => ({ partId: line.partId, name: line.name, sku: line.sku, bin: line.bin, qty: line.qty, unitPrice: line.unitPrice, amount: roundMoney(line.qty * line.unitPrice) }));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  const tax = roundMoney(subtotal * 0.18);
  const operator = user.name || 'Station Operator';
  const shopName = user.shopName || (user.name ? `${user.name}'s Shop` : 'INVENTORY STATION');
  const station = user.station || 'Station';
  return { id: 'DRAFT', number: 'DRAFT', createdAt: new Date().toISOString(), status: 'draft', operator, station, shopName, items, subtotal, tax, discount: 0, total: roundMoney(subtotal + tax), paymentMode: 'Payment pending', transactionRef: 'Not yet issued' };
}

export async function initInvoice() {
  const root = document.querySelector('[data-invoice-root]');
  const region = document.querySelector('[data-receipt]');
  if (!root || !region) return;

  const builder = root.querySelector('[data-bill-builder]');
  const itemForm = root.querySelector('[data-bill-item-form]');
  const partSelect = root.querySelector('[data-bill-part]');
  const qtyInput = root.querySelector('[data-bill-qty]');
  const linesNode = root.querySelector('[data-bill-lines]');
  const createButton = root.querySelector('[data-action="create-bill"]');
  const stockStatus = root.querySelector('[data-stock-status]');
  const announce = message => {
    let node = root.querySelector('[data-invoice-state]');
    if (!node) {
      node = document.createElement('p');
      node.dataset.invoiceState = '';
      node.className = 'pill';
      node.setAttribute('aria-live', 'polite');
      region.before(node);
    }
    node.textContent = message;
  };
  const toast = message => document.dispatchEvent(new CustomEvent('app:toast', { detail: message }));

  clearInvoice(root, 'Add stock items to start a bill.');
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('id');
  const id = requestedId || (params.get('new') === '1' ? '' : localStorage.getItem(STORAGE_KEYS.lastInvoice) || '');
  let hasInvoice = false;
  let currentInvoice = null;
  let inventoryParts = [];
  let draftLines = [];
  let feedTimer = 0;
  const hasReceipt = () => hasInvoice || draftLines.length > 0;

  const isAiSeed = p => {
    if (!p) return false;
    const id = String(p.id || p.partId || '').toLowerCase();
    const sku = String(p.sku || '').toUpperCase();
    const name = String(p.name || '').toLowerCase();
    return (
      id === 'cryo-resistor' || id === 'titanium-solenoid' || id === 'optical-prism' || id === 'magnetic-flux' ||
      sku === 'CR-9041-B' || sku === 'TSV-882' || sku === 'OPC-404' || sku === 'MFS-109' ||
      name.includes('cryo-resistor') || name.includes('titanium solenoid') || name.includes('optical prism') || name.includes('magnetic flux')
    );
  };

  if (id) {
    announce('Loading bill…');
    try {
      const result = await api.getInvoice(id);
      if (result.invoice?.items?.some(isAiSeed)) {
        localStorage.removeItem(STORAGE_KEYS.lastInvoice);
        clearInvoice(root, 'Add stock items to start a bill.');
      } else {
        currentInvoice = result.invoice;
        fill(currentInvoice, root);
        hasInvoice = true;
        announce('Bill loaded.');
      }
    } catch (error) {
      clearInvoice(root, error.message);
      announce(error.message);
    }
  }

  if (builder) builder.hidden = hasInvoice;

  const renderPartOptions = () => {
    if (!partSelect) return;
    if (!inventoryParts.length) {
      partSelect.innerHTML = '<option value="">No stock items in inventory (use Custom Item tab or Add Stock)</option>';
    } else {
      partSelect.innerHTML = '<option value="">Choose a stock item…</option>' + inventoryParts.map(part => {
        const label = part.name + ' (' + part.sku + ') — ' + part.qty + ' available — ' + money(part.unitPrice);
        return '<option value="' + safe(part.id) + '"' + (part.qty < 1 ? ' disabled' : '') + '>' + safe(label) + '</option>';
      }).join('');
    }
    if (stockStatus) stockStatus.textContent = inventoryParts.length ? inventoryParts.length + ' stock items' : '0 stock items';
  };

  const renderDraft = () => {
    if (!draftLines.length) {
      clearInvoice(root, 'Add stock items to start a bill.');
      linesNode.innerHTML = '<p class="bill-lines__empty">Choose a stock item to start a bill.</p>';
      if (createButton) createButton.disabled = true;
      return;
    }
    linesNode.innerHTML = draftLines.map(line => {
      const isCustom = !line.partId || String(line.partId).startsWith('custom-') || line.sku === 'CUSTOM';
      const available = isCustom ? 999999 : (inventoryParts.find(part => part.id === line.partId)?.qty || 0);
      const stockInfo = isCustom ? 'Custom item' : `${Math.max(0, available - line.qty)} left in stock`;
      return '<div class="bill-line"><div class="bill-line__info"><strong>' + safe(line.name) + '</strong><small>' + safe(line.sku) + ' • ' + stockInfo + '</small></div>' +
        '<span class="bill-line__quantity">' + line.qty + ' × ' + money(line.unitPrice) + '</span><strong class="bill-line__amount">' + money(line.qty * line.unitPrice) + '</strong>' +
        '<div class="bill-line__controls"><button type="button" data-draft-action="decrease" data-part-id="' + safe(line.partId) + '" aria-label="Decrease ' + safe(line.name) + ' quantity">−</button><button type="button" data-draft-action="increase" data-part-id="' + safe(line.partId) + '" aria-label="Increase ' + safe(line.name) + ' quantity"' + (!isCustom && line.qty >= available ? ' disabled' : '') + '>＋</button><button type="button" class="bill-line__remove" data-draft-action="remove" data-part-id="' + safe(line.partId) + '">Remove</button></div></div>';
    }).join('');
    fill(draftInvoice(draftLines), root);
    if (createButton) createButton.disabled = false;
  };

  const updateQuantityLimit = () => {
    if (!partSelect || !qtyInput) return;
    const part = inventoryParts.find(candidate => candidate.id === partSelect.value);
    if (!part) {
      qtyInput.max = '';
      return;
    }
    const existing = draftLines.find(line => line.partId === part.id)?.qty || 0;
    const available = Math.max(0, part.qty - existing);
    qtyInput.max = String(available);
    if (available > 0) qtyInput.value = String(Math.min(Math.max(1, Number(qtyInput.value) || 1), available));
  };

  const updateReceiptControls = () => {
    const enabled = hasReceipt();
    root.querySelectorAll('[data-action="tear-slip"], [data-action="replay-dispense"]').forEach(button => { button.disabled = !enabled; });
    if (!enabled) {
      root.removeAttribute('data-shader-active');
      root.querySelector('#invoice-shader-canvas')[Symbol.for('crit-spare.shader.stop')]?.();
    }
  };

  const applyVariant = value => {
    root.dataset.invoiceVariant = value;
    root.classList.toggle('invoice--tearoff', value === 'tearoff');
    root.classList.toggle('invoice--carbon', value === 'carbon');
    const canvas = root.querySelector('#invoice-shader-canvas');
    const stopKey = Symbol.for('crit-spare.shader.stop');
    canvas[stopKey]?.();
    root.removeAttribute('data-shader-active');
    if (!hasReceipt() || value === 'base') return;
    canvas.dataset.shader = value === 'tearoff' ? 'thermal' : 'paper-curl';
    try {
      const started = value === 'tearoff' ? startThermalBurnIn(canvas) : startPaperCurl(canvas);
      if (started) root.setAttribute('data-shader-active', '');
    } catch {
      root.removeAttribute('data-shader-active');
    }
  };

  root.querySelectorAll('input[data-invoice-variant]').forEach(input => {
    input.addEventListener('change', () => applyVariant(input.value));
  });

  const replayReceipt = () => {
    if (!hasReceipt()) {
      toast('Add stock items before playing the receipt.');
      return;
    }
    region.classList.remove('feed-replay');
    void region.offsetWidth;
    region.classList.add('feed-replay');
    window.clearTimeout(feedTimer);
    feedTimer = window.setTimeout(() => region.classList.remove('feed-replay'), 1200);
  };

  const tearReceipt = () => {
    if (!hasReceipt()) {
      toast('Add stock items before tearing the receipt.');
      return;
    }
    const tearInput = root.querySelector('[data-invoice-variant="tearoff"]');
    if (tearInput) tearInput.checked = true;
    applyVariant('tearoff');
    replayReceipt();
  };

  root.querySelector('[data-action="tear-slip"]')?.addEventListener('click', tearReceipt);
  root.querySelector('[data-action="replay-dispense"]')?.addEventListener('click', replayReceipt);
  region.addEventListener('click', tearReceipt);
  region.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      tearReceipt();
    }
  });
  region.setAttribute('tabindex', '0');
  region.setAttribute('role', 'button');
  region.setAttribute('aria-label', 'Replay the receipt tear animation');
  updateReceiptControls();

  if (!hasInvoice && itemForm && partSelect && qtyInput && linesNode) {
    try {
      inventoryParts = await api.getParts();
      renderPartOptions();
      const isCustomer = getRole() === 'customer';
      if (isCustomer) {
        const builderTitle = root.querySelector('#bill-builder-title');
        if (builderTitle) builderTitle.textContent = 'Customer Bill Items';
        const builderEyebrow = root.querySelector('[data-bill-builder] .eyebrow');
        if (builderEyebrow) builderEyebrow.textContent = 'CART ITEMS FOR BILLING';
        const cart = getCart();
        if (cart.length > 0 && draftLines.length === 0) {
          draftLines = cart.map(item => ({
            partId: item.partId,
            name: item.name,
            sku: item.sku,
            bin: item.bin || 'A-01',
            qty: item.qty,
            unitPrice: item.unitPrice
          }));
          renderDraft();
          updateReceiptControls();
          applyVariant(root.dataset.invoiceVariant || 'base');
        }
      }
    } catch (error) {
      if (partSelect) partSelect.innerHTML = '<option value="">Could not load stock — sign in and try again</option>';
      if (stockStatus) stockStatus.textContent = 'Stock unavailable';
      announce(error.message);
    }

    const stockFields = root.querySelector('[data-bill-stock-fields]');
    const customFields = root.querySelector('[data-bill-custom-fields]');
    const tabChips = root.querySelectorAll('[data-bill-tab]');
    let currentItemMode = 'stock';

    tabChips.forEach(tab => {
      tab.addEventListener('click', () => {
        currentItemMode = tab.dataset.billTab;
        tabChips.forEach(t => {
          const isActive = t === tab;
          t.classList.toggle('tab-chip--active', isActive);
          t.style.background = isActive ? 'var(--gold)' : 'rgba(255,255,255,0.06)';
          t.style.color = isActive ? 'var(--void)' : 'var(--muted)';
          t.style.borderColor = isActive ? 'var(--line-gold)' : 'var(--line)';
        });
        if (currentItemMode === 'stock') {
          if (stockFields) stockFields.hidden = false;
          if (customFields) customFields.hidden = true;
        } else {
          if (stockFields) stockFields.hidden = true;
          if (customFields) customFields.hidden = false;
        }
      });
    });

    partSelect.addEventListener('change', updateQuantityLimit);
    itemForm.addEventListener('submit', event => {
      event.preventDefault();
      const wasEmpty = draftLines.length === 0;

      if (currentItemMode === 'custom') {
        const customNameInput = root.querySelector('[data-bill-custom-name]');
        const customPriceInput = root.querySelector('[data-bill-custom-price]');
        const customQtyInput = root.querySelector('[data-bill-custom-qty]');
        const name = String(customNameInput?.value || '').trim();
        const price = Number(customPriceInput?.value || 0);
        const qty = Number(customQtyInput?.value || 1);
        if (!name) {
          toast('Enter a description or name for the custom item.');
          customNameInput?.focus();
          return;
        }
        if (!Number.isSafeInteger(qty) || qty < 1) {
          toast('Enter a whole quantity greater than zero.');
          customQtyInput?.focus();
          return;
        }
        const customId = `custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        draftLines.push({
          partId: customId,
          name,
          sku: 'CUSTOM',
          bin: 'CUSTOM',
          qty,
          unitPrice: Math.max(0, price)
        });
        if (customNameInput) customNameInput.value = '';
        if (customQtyInput) customQtyInput.value = '1';
        renderDraft();
        updateReceiptControls();
        if (wasEmpty) applyVariant(root.dataset.invoiceVariant || 'base');
        toast(`Added "${name}" to bill.`);
        return;
      }

      const part = inventoryParts.find(candidate => candidate.id === partSelect.value);
      const qty = Number(qtyInput.value);
      if (!part) {
        toast('Choose an item from current stock, or click "Custom Item".');
        partSelect.focus();
        return;
      }
      if (!Number.isSafeInteger(qty) || qty < 1) {
        toast('Enter a whole quantity greater than zero.');
        qtyInput.focus();
        return;
      }
      const existing = draftLines.find(line => line.partId === part.id);
      const alreadyInBill = existing?.qty || 0;
      if (qty > part.qty - alreadyInBill) {
        toast('Only ' + Math.max(0, part.qty - alreadyInBill) + ' more units of ' + part.name + ' are available.');
        updateQuantityLimit();
        qtyInput.focus();
        return;
      }
      if (existing) existing.qty += qty;
      else draftLines.push({ partId: part.id, name: part.name, sku: part.sku, bin: part.bin || '', qty, unitPrice: Number(part.unitPrice || 0) });
      partSelect.value = '';
      qtyInput.value = '1';
      qtyInput.max = '';
      renderDraft();
      updateReceiptControls();
      if (wasEmpty) applyVariant(root.dataset.invoiceVariant || 'base');
    });

    linesNode.addEventListener('click', event => {
      const button = event.target.closest('[data-draft-action]');
      if (!button) return;
      const line = draftLines.find(item => item.partId === button.dataset.partId);
      if (!line) return;
      if (button.dataset.draftAction === 'remove') draftLines = draftLines.filter(item => item.partId !== line.partId);
      else if (button.dataset.draftAction === 'decrease') {
        line.qty -= 1;
        if (line.qty < 1) draftLines = draftLines.filter(item => item.partId !== line.partId);
      } else if (button.dataset.draftAction === 'increase') {
        const isCustom = !line.partId || String(line.partId).startsWith('custom-') || line.sku === 'CUSTOM';
        if (isCustom) {
          line.qty += 1;
        } else {
          const part = inventoryParts.find(item => item.id === line.partId);
          if (part && line.qty < part.qty) line.qty += 1;
        }
      }
      renderDraft();
      updateReceiptControls();
    });

    createButton?.addEventListener('click', async () => {
      if (!draftLines.length) {
        toast('Add at least one stock item to the bill.');
        return;
      }
      createButton.disabled = true;
      createButton.textContent = 'Saving bill…';
      try {
        const result = await api.createInvoice(draftLines.map(line => ({
          partId: line.partId,
          qty: line.qty,
          name: line.name,
          sku: line.sku,
          unitPrice: line.unitPrice
        })));
        currentInvoice = result.invoice;
        hasInvoice = true;
        if (getRole() === 'customer') {
          saveCustomerBill(currentInvoice);
          clearCart();
        }
        draftLines = [];
        localStorage.setItem(STORAGE_KEYS.lastInvoice, currentInvoice.id);
        history.replaceState(null, '', location.pathname + '?id=' + encodeURIComponent(currentInvoice.id));
        fill(currentInvoice, root);
        builder.hidden = true;
        announce('Bill saved. Stock quantities updated.');
        updateReceiptControls();
        toast('Bill saved and stock updated.');
      } catch (error) {
        toast(error.message);
      } finally {
        if (hasInvoice) createButton.disabled = true;
        else createButton.disabled = draftLines.length === 0;
        createButton.textContent = 'Create bill';
      }
    });
  }

  root.querySelectorAll('[data-action="download-invoice"], [data-action="print-invoice"], [data-action="share-invoice"], [data-action="email-invoice"]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      if (!hasReceipt()) {
        toast('Add stock items before printing or sharing a bill.');
        return;
      }
      if (link.dataset.action === 'download-invoice' || link.dataset.action === 'print-invoice') {
        window.print();
        return;
      }
      if (!hasInvoice) {
        toast('Create the bill before sharing it so the link opens a saved bill.');
        return;
      }
      const invoice = currentInvoice;
      if (link.dataset.action === 'email-invoice') {
        const subject = encodeURIComponent('CRIT-SPARE Bill ' + (invoice.number || invoice.id) + ' - ' + (invoice.shopName || 'Inventory'));
        const bodyLines = [
          'CRIT-SPARE Bill Reference: ' + (invoice.number || invoice.id),
          'Station: ' + (invoice.station || 'Station'),
          'Operator: ' + (invoice.operator || 'Operator'),
          'Total: ' + money(invoice.total),
          '',
          'Items:',
          ...(invoice.items || []).map(i => '- ' + i.name + ' (Qty: ' + i.qty + ' @ ' + money(i.unitPrice) + ' = ' + money(i.amount) + ')'),
          '',
          'View bill online: ' + location.href
        ];
        window.location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(bodyLines.join('\n'));
        return;
      }
      const shareText = 'CRIT-SPARE bill ' + (invoice.number || invoice.id) + ' • Total ' + money(invoice.total) + ' • ' + location.href;
      const shareUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
      const opened = window.open(shareUrl, '_blank');
      if (opened) opened.opener = null;
      else toast('Allow pop-ups to open WhatsApp and share this bill.');
    });
  });

  if (hasInvoice) {
    if (builder) builder.hidden = true;
    updateReceiptControls();
  } else if (builder) {
    builder.hidden = false;
    renderDraft();
  }
}