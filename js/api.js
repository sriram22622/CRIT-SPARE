import { MOCK_DELAY_MS, MOCK_RANDOM_FAILURE_RATE, STORAGE_KEYS, USE_MOCK } from './config.js';
import { firebaseRequest } from './firebase-api.js';

const seedParts = [
  { id: 'cryo-resistor', name: 'Cryo-Resistor Pack X9', sku: 'CR-9041-B', qty: 428, status: 'healthy', bin: 'A-04', unitPrice: 1700, reserved: 32 },
  { id: 'titanium-solenoid', name: 'Titanium Solenoid Valve', sku: 'TSV-882', qty: 14, status: 'low', bin: 'C-12', unitPrice: 14200, reserved: 0 },
  { id: 'optical-prism', name: 'Optical Prism Coupler', sku: 'OPC-404', qty: 4, status: 'critical', bin: 'D-01', unitPrice: 8900, reserved: 0 },
  { id: 'magnetic-flux', name: 'Magnetic Flux Sensor', sku: 'MFS-109', qty: 0, status: 'out-of-stock', bin: 'B-08', unitPrice: 6200, reserved: 0 }
];
const demoUser = { id: 'operator-04', name: 'Tarun K.', role: 'Lead Technician', station: 'dock-04', identity: 'demo@crit-spare.local' };

function initialState() {
  return { parts: seedParts, accounts: [{ user: demoUser, passkey: 'Orbit#2026' }], invoices: [], timeline: [], shiftLog: [], orders: [], metrics: { trackedItems: 446, bays: 14, criticalDepletions: 2, accuracy: 99.91, availability: 98.4, consumption: [31, 42, 38, 54, 73, 98, 84, 66, 81], labels: ['06:00', '08:00', '10:00', '12:00', '14:30', '16:00', '18:00', '20:00', '22:00'] } };
}
function readState() {
  let state;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.state));
    if (parsed?.parts && parsed?.invoices) state = parsed;
  } catch { /* reset invalid local mock state */ }
  if (!state) state = initialState();
  if (!Array.isArray(state.accounts)) state.accounts = [{ user: demoUser, passkey: 'Orbit#2026' }];
  if (!Array.isArray(state.timeline)) state.timeline = [];
  if (!Array.isArray(state.shiftLog)) state.shiftLog = [];
  if (!Array.isArray(state.orders)) state.orders = [];
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
function invoiceFor(state, part, qty) {
  const subtotal = part.unitPrice * qty;
  const tax = Math.round(subtotal * 0.18 * 100) / 100;
  const invoice = { id: `INV-${Date.now()}`, number: `TX-${String(Date.now()).slice(-6)}`, createdAt: new Date().toISOString(), status: 'dispensed', operator: demoUser.name, station: 'Dock #04', items: [{ partId: part.id, name: part.name, sku: part.sku, bin: part.bin, qty, unitPrice: part.unitPrice, amount: subtotal }], subtotal, tax, discount: 0, total: subtotal + tax, paymentMode: 'UPI / Quantum Ledger', transactionRef: `QTM-${Date.now()}` };
  state.invoices.unshift(invoice); record(state, 'Dispense', part, qty, `Invoice ${invoice.number}`); return invoice;
}
function httpError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
async function mockRequest(method, path, body = {}) {
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS));
  if (MOCK_RANDOM_FAILURE_RATE > 0 && Math.random() < MOCK_RANDOM_FAILURE_RATE) throw httpError('Simulated network failure. Please try again.', 503);
  const state = readState();
  if (method === 'POST' && path === '/auth/login') {
    const account = state.accounts.find(entry => entry.user.identity.toLowerCase() === String(body.identity || '').trim().toLowerCase() && entry.passkey === body.passkey);
    if (!account) throw httpError('Identity or passkey is incorrect.', 401);
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
    const user = { id: `operator-${Date.now()}`, name: body.operatorName.trim(), shopName: body.shopName.trim(), role: 'Station Operator', station: body.station || 'dock-04', identity: body.identity.trim() };
    state.accounts.push({ user, passkey: body.passkey }); writeState(state);
    return { token: `mock.${btoa(`${user.id}:${Date.now()}`)}`, user };
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
    const query = new URLSearchParams(path.split('?')[1] || ''); const search = (query.get('search') || '').toLowerCase(); const status = query.get('status');
    return state.parts.filter(p => (!search || `${p.name} ${p.sku} ${p.bin}`.toLowerCase().includes(search)) && (!status || status === 'all' || p.status === status)).map(partView);
  }
  const partMatch = path.match(/^\/parts\/([^/]+)(?:\/(dispense|restock|audit|reorder))?$/);
  if (partMatch) {
    const part = state.parts.find(p => p.id === decodeURIComponent(partMatch[1])); if (!part) throw httpError('Part not found.', 404);
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
    const part = state.parts.find(p => p.sku.toLowerCase() === String(body.code || '').toLowerCase() || p.id.toLowerCase() === String(body.code || '').toLowerCase()); if (!part) throw httpError('No part matches that scan code.', 404);
    const discrepancy = 0; record(state, 'Scan reconcile', part, part.qty, 'Scan verified'); writeState(state); return { part: partView(part), discrepancy };
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
  return firebaseRequest(method, path, body);
}
export const api = {
  login: data => apiRequest('POST', '/auth/login', data), register: data => apiRequest('POST', '/auth/register', data), resetPassword: identity => apiRequest('POST', '/auth/reset-password', { identity }),
  getParts: (search = '', status = '') => apiRequest('GET', `/parts?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  dispense: (id, qty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/dispense`, { qty }), restock: (id, qty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/restock`, { qty }), audit: (id, countedQty) => apiRequest('POST', `/parts/${encodeURIComponent(id)}/audit`, { countedQty }), reorder: id => apiRequest('POST', `/parts/${encodeURIComponent(id)}/reorder`, {}), reconcile: code => apiRequest('POST', '/scan/reconcile', { code }),
  getInvoice: id => apiRequest('GET', `/invoices/${encodeURIComponent(id)}`), getMetrics: () => apiRequest('GET', '/operator/metrics'), getTimeline: () => apiRequest('GET', '/operator/timeline'), getShiftLog: () => apiRequest('GET', '/operator/shift-log'), getProfile: () => apiRequest('GET', '/operator/profile'), verifyProfilePhone: phone => apiRequest('POST', '/operator/profile/phone', { phone }), updateProfile: data => apiRequest('POST', '/operator/profile', data)
};
