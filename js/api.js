import { isLocalDev, MOCK_DELAY_MS, MOCK_RANDOM_FAILURE_RATE, STORAGE_KEYS, USE_MOCK } from './config.js';
import { firebaseRequest } from './firebase-api.js';

const seedParts = [];
const demoUser = { id: 'operator-04', name: 'Tarun K.', role: 'Lead Technician', station: 'dock-04', shopName: 'Main Station Shop', identity: 'demo@crit-spare.local' };
const cadetUser = { id: 'operator-01', name: 'Cadet Solis', role: 'Station Operator', station: 'dock-04', shopName: 'Station 04 Shop', identity: 'cadet.solis@dock04.orbit' };

function isAiSeed(p) {
  if (!p) return false;
  const id = String(p.id || '').toLowerCase();
  const sku = String(p.sku || '').toUpperCase();
  const name = String(p.name || '').toLowerCase();
  return (
    id === 'cryo-resistor' || id === 'titanium-solenoid' || id === 'optical-prism' || id === 'magnetic-flux' ||
    sku === 'CR-9041-B' || sku === 'TSV-882' || sku === 'OPC-404' || sku === 'MFS-109' ||
    name.includes('cryo-resistor') || name.includes('titanium solenoid') || name.includes('optical prism') || name.includes('magnetic flux')
  );
}

function initialState() {
  return {
    parts: [],
    accounts: [
      { user: demoUser, passkey: 'Orbit#2026' },
      { user: cadetUser, passkey: 'Orbit#2026' }
    ],
    invoices: [],
    timeline: [],
    shiftLog: [],
    orders: [],
    metrics: { trackedItems: 0, bays: 0, criticalDepletions: 0, accuracy: 100, availability: 100, consumption: [0, 0, 0, 0, 0, 0, 0, 0, 0], labels: ['06:00', '08:00', '10:00', '12:00', '14:30', '16:00', '18:00', '20:00', '22:00'] },
    shops: {}
  };
}
function readState() {
  let state;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.state));
    if (parsed) state = parsed;
  } catch { /* reset invalid local mock state */ }
  if (!state) state = initialState();

  // Purge all AI-generated seed parts from root parts
  if (Array.isArray(state.parts)) {
    state.parts = state.parts.filter(p => !isAiSeed(p));
  } else {
    state.parts = [];
  }

  // Purge all AI-generated seed parts from all existing shops
  if (state.shops && typeof state.shops === 'object') {
    for (const shop of Object.values(state.shops)) {
      if (Array.isArray(shop.parts)) {
        shop.parts = shop.parts.filter(p => !isAiSeed(p));
      }
    }
  }

  // Purge AI activity logs
  if (Array.isArray(state.timeline)) {
    state.timeline = state.timeline.filter(t => !isAiSeed({ name: t.partName, sku: t.sku, id: t.partId }));
  } else {
    state.timeline = [];
  }
  if (Array.isArray(state.shiftLog)) {
    state.shiftLog = state.shiftLog.filter(s => !isAiSeed({ name: s.partName, sku: s.sku, id: s.partId }));
  } else {
    state.shiftLog = [];
  }
  if (Array.isArray(state.invoices)) {
    state.invoices = state.invoices.filter(inv => !inv.items?.some(i => isAiSeed(i)));
  } else {
    state.invoices = [];
  }

  if (!Array.isArray(state.accounts)) state.accounts = [{ user: demoUser, passkey: 'Orbit#2026' }];
  if (!Array.isArray(state.orders)) state.orders = [];

  // Recompute live metrics based on real active stock
  const active = getActiveParts(state);
  const totalQty = active.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  const uniqueBins = new Set(active.map(p => p.bin).filter(Boolean)).size;
  const criticalCount = active.filter(p => p.status === 'critical' || p.status === 'out-of-stock').length;
  state.metrics = {
    trackedItems: totalQty,
    bays: uniqueBins,
    criticalDepletions: criticalCount,
    accuracy: 100,
    availability: 100,
    consumption: totalQty > 0 ? [5, 10, 15, 20, 18, 14, 10, 8, 5] : [0, 0, 0, 0, 0, 0, 0, 0, 0],
    labels: ['06:00', '08:00', '10:00', '12:00', '14:30', '16:00', '18:00', '20:00', '22:00']
  };

  writeState(state);
  return state;
}
function writeState(state) { localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(state)); }
function partView(part) { return { id: part.id, name: part.name, sku: part.sku, qty: part.qty, status: part.status, bin: part.bin, unitPrice: part.unitPrice, reserved: part.reserved }; }
function refreshStatus(part) {
  part.status = part.qty === 0 ? 'out-of-stock' : part.qty <= 5 ? 'critical' : part.qty <= 20 ? 'low' : 'healthy';
}
function record(state, action, part, qty, note = '') {
  const item = { id: `evt-${Date.now()}`, action, partId: part.id, partName: part.name, sku: part.sku, qty, note, timestamp: new Date().toISOString() };
  state.timeline.unshift(item); state.shiftLog.unshift(item); state.timeline = state.timeline.slice(0, 20); state.shiftLog = state.shiftLog.slice(0, 20);
}
function getActiveUser(state) {
  let current = {};
  try { current = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore */ }
  if (current?.id) {
    const account = state.accounts?.find(entry => entry.user?.id === current.id || entry.user?.identity === current.identity);
    if (account?.user) return { ...account.user, ...current };
    return current;
  }
  return demoUser;
}

function invoiceForItems(state, selections) {
  const user = getActiveUser(state);
  const operator = user.name || 'Station Operator';
  const shopName = user.shopName || (user.name ? `${user.name}'s Shop` : 'INVENTORY STATION');
  const station = user.station || 'Dock #04';
  const items = selections.map(({ part, qty }) => {
    const unitPrice = Number(part.unitPrice || 0);
    return { partId: part.id, name: part.name, sku: part.sku, bin: part.bin || '', qty, unitPrice, amount: Number((unitPrice * qty).toFixed(2)) };
  });
  const subtotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const tax = Number((subtotal * 0.18).toFixed(2));
  const now = Date.now();
  const invoice = {
    id: 'INV-' + now,
    number: 'TX-' + String(now).slice(-6),
    createdAt: new Date(now).toISOString(),
    status: 'dispensed',
    operator,
    shopName,
    station,
    items,
    subtotal,
    tax,
    discount: 0,
    total: Number((subtotal + tax).toFixed(2)),
    paymentMode: 'UPI / Quantum Ledger',
    transactionRef: 'QTM-' + now
  };
  state.invoices.unshift(invoice);
  for (const { part, qty } of selections) record(state, 'Dispense', part, qty, 'Invoice ' + invoice.number);
  return invoice;
}
function invoiceFor(state, part, qty) {
  return invoiceForItems(state, [{ part, qty }]);
}
function getActiveParts(state) {
  let current = {};
  try { current = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore */ }
  const account = state.accounts?.find(entry => entry.user.id === current.id);
  const shopId = account?.user?.shopId;
  if (shopId && state.shops && state.shops[shopId] && Array.isArray(state.shops[shopId].parts)) {
    return state.shops[shopId].parts;
  }
  if (state.shops && typeof state.shops === 'object') {
    const shops = Object.values(state.shops);
    if (shops.length > 0 && Array.isArray(shops[0].parts)) {
      return shops[0].parts;
    }
  }
  return Array.isArray(state.parts) ? state.parts : [];
}

function httpError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
async function mockRequest(method, path, body = {}) {
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS));
  if (MOCK_RANDOM_FAILURE_RATE > 0 && Math.random() < MOCK_RANDOM_FAILURE_RATE) throw httpError('Simulated network failure. Please try again.', 503);
  const state = readState();
  if (method === 'POST' && path === '/auth/login') {
    const ident = String(body.identity || '').trim().toLowerCase();
    let account = state.accounts.find(entry => entry.user.identity.toLowerCase() === ident && entry.passkey === body.passkey);
    if (!account && (ident === 'cadet.solis@dock04.orbit' || ident === 'demo@crit-spare.local') && (body.passkey === 'Orbit#2026' || String(body.passkey).length >= 6)) {
      account = { user: ident.includes('cadet') ? cadetUser : demoUser };
    }
    if (!account) throw httpError('Identity or passkey is incorrect. (Use demo@crit-spare.local or cadet.solis@dock04.orbit with passkey Orbit#2026)', 401);
    return { token: `mock.${btoa(`${account.user.id}:${Date.now()}`)}`, user: account.user };
  }
  if (method === 'POST' && path === '/auth/reset-password') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.identity || '').trim())) throw httpError('Enter a valid email address.', 400);
    return { message: 'If an account uses that email, a password reset link has been sent.' };
  }
  if (method === 'POST' && path === '/auth/register') {
    if (body.termsAccepted !== true) throw httpError('Please agree to the Terms and Conditions before creating your shop.', 400);
    if (!body.shopName?.trim() || !body.operatorName?.trim() || !body.identity?.trim() || String(body.passkey || '').length < 8) throw httpError('Complete all required fields and use a passkey of at least 8 characters.', 400);
    if (state.accounts.some(entry => entry.user.identity.toLowerCase() === body.identity.trim().toLowerCase())) throw httpError('An account already uses that email.', 409);
    const shopId = `shop-${Date.now()}`;
    const user = { id: `operator-${Date.now()}`, name: body.operatorName.trim(), shopName: body.shopName.trim(), role: 'Station Operator', station: body.station || 'dock-04', identity: body.identity.trim(), shopId };
    state.accounts.push({ user, passkey: body.passkey });
    // New user starts with 0 stocks (empty parts array)
    state.shops[shopId] = { id: shopId, name: user.shopName, ownerId: user.id, parts: [] };
    writeState(state);
    return { token: `mock.${btoa(`${user.id}:${Date.now()}`)}`, user };
  }
  if (method === 'POST' && (path === '/parts' || (path.startsWith('/shops/') && path.endsWith('/parts')))) {
    const { name, sku, qty = 0, bin = '', unitPrice = 0 } = body;
    if (!name?.trim() || !sku?.trim()) throw httpError('Part name and SKU are required.', 400);
    const numQty = Number(qty) || 0;
    const part = {
      id: `part-${Date.now()}`,
      name: name.trim(),
      sku: sku.trim().toUpperCase(),
      qty: numQty,
      status: numQty === 0 ? 'out-of-stock' : numQty <= 5 ? 'critical' : numQty <= 20 ? 'low' : 'healthy',
      bin: (bin || 'A-01').trim().toUpperCase(),
      unitPrice: Number(unitPrice) || 0,
      reserved: 0
    };
    const partsList = getActiveParts(state);
    partsList.unshift(part);
    record(state, 'Initial Stock', part, numQty, 'Added new part');
    writeState(state);
    return { part: partView(part) };
  }
  if (method === 'POST' && path === '/operator/profile') {
    let current = {}; try { current = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore invalid cached profile */ }
    const account = state.accounts.find(entry => entry.user.id === current.id);
    if (!account) throw httpError('Please sign in to update your profile.', 401);
    const name = String(body.name || '').trim(); const shopName = String(body.shopName || '').trim(); const station = String(body.station || '').trim();
    if (!name || name.length > 120 || !shopName || shopName.length > 160 || !station || station.length > 80) throw httpError('Enter a name, shop name, and station within the allowed length.', 400);
    account.user = { ...account.user, name, shopName, station }; writeState(state);
    return { user: account.user };
  }
  if (method === 'GET' && path === '/operator/profile') {
    let current = {}; try { current = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore invalid cached profile */ }
    const account = state.accounts.find(entry => entry.user.id === current.id);
    if (!account) throw httpError('Please sign in to view your profile.', 401);
    return { user: account.user };
  }
  if (method === 'GET' && path.startsWith('/parts')) {
    const partsSource = getActiveParts(state);
    const query = new URLSearchParams(path.split('?')[1] || '');
    const search = (query.get('search') || '').toLowerCase();
    const status = query.get('status');
    return partsSource.filter(p => (!search || `${p.name} ${p.sku} ${p.bin}`.toLowerCase().includes(search)) && (!status || status === 'all' || p.status === status)).map(partView);
  }
  const partMatch = path.match(/^\/parts\/([^/]+)(?:\/(dispense|restock|audit|reorder))?$/);
  if (partMatch) {
    const partsSource = getActiveParts(state);
    const part = partsSource.find(p => p.id === decodeURIComponent(partMatch[1])) || state.parts.find(p => p.id === decodeURIComponent(partMatch[1]));
    if (!part) throw httpError('Part not found.', 404);
    switch (partMatch[2]) {
      case 'dispense': {
        const qty = Number(body.qty); if (!Number.isInteger(qty) || qty < 1) throw httpError('Enter a whole quantity greater than zero.'); if (qty > part.qty) throw httpError(`Only ${part.qty} units are available.`, 409);
        part.qty -= qty; refreshStatus(part); const invoice = invoiceFor(state, part, qty); writeState(state); localStorage.setItem(STORAGE_KEYS.lastInvoice, invoice.id); return { part: partView(part), invoice };
      }
      case 'restock': {
        const qty = Number(body.qty); if (!Number.isInteger(qty) || qty < 1) throw httpError('Enter a whole restock quantity greater than zero.'); part.qty += qty; refreshStatus(part); record(state, 'Restock', part, qty); writeState(state); return { part: partView(part) };
      }
      case 'audit': {
        const countedQty = Number(body.countedQty); if (!Number.isInteger(countedQty) || countedQty < 0) throw httpError('Enter a valid counted quantity.'); const discrepancy = countedQty - part.qty; part.qty = countedQty; refreshStatus(part); record(state, 'Audit', part, countedQty, `${discrepancy} variance`); writeState(state); return { part: partView(part), discrepancy };
      }
      case 'reorder': {
        const order = { id: `ORD-${Date.now()}`, partId: part.id, sku: part.sku, qty: Math.max(50, 100 - part.qty), status: 'submitted', createdAt: new Date().toISOString() }; state.orders.unshift(order); record(state, 'Emergency reorder', part, order.qty, order.id); writeState(state); return { order };
      }
      default: return partView(part);
    }
  }
  if (method === 'POST' && path === '/scan/reconcile') {
    const partsSource = getActiveParts(state);
    const part = partsSource.find(p => p.sku.toLowerCase() === String(body.code || '').toLowerCase() || p.id.toLowerCase() === String(body.code || '').toLowerCase()) || state.parts.find(p => p.sku.toLowerCase() === String(body.code || '').toLowerCase());
    if (!part) throw httpError('No part matches that scan code.', 404);
    const discrepancy = 0; record(state, 'Scan reconcile', part, part.qty, 'Scan verified'); writeState(state); return { part: partView(part), discrepancy };
  }
  if (method === 'POST' && path === '/invoices') {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) throw httpError('Add between 1 and 20 items to the bill.');
    const partsSource = getActiveParts(state);
    const selections = body.items.map(item => {
      const qty = Number(item?.qty);
      if (!Number.isSafeInteger(qty) || qty < 1) throw httpError('Item quantity must be a whole number greater than zero.');
      const partId = item.partId || item.part?.id;
      if (partId) {
        const part = partsSource.find(p => p.id === partId) || state.parts.find(p => p.id === partId);
        if (part) {
          if (qty > part.qty) throw httpError(`Only ${part.qty} units of ${part.name} are available.`);
          part.qty -= qty;
          refreshStatus(part);
          return { part, qty };
        }
      }
      const unitPrice = Number(item.unitPrice || 0);
      const customPart = {
        id: item.partId || `custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: String(item.name || 'Custom item').trim(),
        sku: String(item.sku || 'CUSTOM').trim().toUpperCase(),
        bin: 'CUSTOM',
        unitPrice,
        qty: 0
      };
      return { part: customPart, qty };
    });
    const invoice = invoiceForItems(state, selections);
    writeState(state);
    localStorage.setItem(STORAGE_KEYS.lastInvoice, invoice.id);
    return { invoice, parts: selections.map(({ part }) => partView(part)) };
  }
  const invoiceMatch = path.match(/^\/invoices\/([^/]+)$/);
  if (method === 'GET' && invoiceMatch) { const invoice = state.invoices.find(i => i.id === decodeURIComponent(invoiceMatch[1]) || i.number === decodeURIComponent(invoiceMatch[1])); if (!invoice) throw httpError('Invoice not found.', 404); return { invoice }; }
  if (method === 'GET' && path === '/operator/metrics') return state.metrics;
  if (method === 'GET' && path === '/operator/timeline') return state.timeline;
  if (method === 'GET' && path === '/operator/shift-log') return state.shiftLog;
  throw httpError(`Mock endpoint not found: ${method} ${path}`, 404);
}
export async function apiRequest(method, path, body) {
  if (USE_MOCK) return mockRequest(method, path, body);
  const isCustomer = typeof localStorage !== 'undefined' && localStorage.getItem('crit-spare.role') === 'customer';
  // On local dev (e.g. Live Server on 127.0.0.1 or localhost) or in customer mode, check if a Firebase session is active.
  // If not, gracefully use local mock state so browsing, cart, and billing work out-of-the-box.
  if (isLocalDev || isCustomer) {
    try {
      const { getFirebaseUser } = await import('./firebase.js');
      const user = await getFirebaseUser();
      if (!user) return mockRequest(method, path, body);
    } catch {
      return mockRequest(method, path, body);
    }
  }
  return firebaseRequest(method, path, body);
}
export { mockRequest };
export const api = {
  login: data => apiRequest('POST', '/auth/login', data), register: data => apiRequest('POST', '/auth/register', data), resetPassword: identity => apiRequest('POST', '/auth/reset-password', { identity }),
  getParts: (search = '', status = '') => apiRequest('GET', `/parts?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  addPart: data => apiRequest('POST', '/parts', data),
  dispense: (id, qty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/dispense`, { qty }), restock: (id, qty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/restock`, { qty }), audit: (id, countedQty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/audit`, { countedQty }), reorder: id => apiRequest('POST', `/parts/${encodeURIComponent(id)}/reorder`, {}), reconcile: code => apiRequest('POST', '/scan/reconcile', { code }),
  createInvoice: items => apiRequest('POST', '/invoices', { items }),
  getInvoice: id => apiRequest('GET', '/invoices/' + encodeURIComponent(id)), getMetrics: () => apiRequest('GET', '/operator/metrics'), getTimeline: () => apiRequest('GET', '/operator/timeline'), getShiftLog: () => apiRequest('GET', '/operator/shift-log'), getProfile: () => apiRequest('GET', '/operator/profile'), verifyProfilePhone: phone => apiRequest('POST', '/operator/profile/phone', { phone }), updateProfile: data => apiRequest('POST', '/operator/profile', data)
};
