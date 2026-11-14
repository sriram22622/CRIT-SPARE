import { getFirebase, getFirebaseUser, getVerifiedPhone, normalizePhone } from './firebase.js';

const seedParts = [
  { name: 'Cryo-Resistor Pack X9', sku: 'CR-9041-B', bin: 'A-04', qty: 428, reserved: 32, lowThreshold: 20, criticalThreshold: 5, reorderQuantity: 80, unitPrice: 1700 },
  { name: 'Titanium Solenoid Valve', sku: 'TSV-882', bin: 'C-12', qty: 14, reserved: 0, lowThreshold: 20, criticalThreshold: 5, reorderQuantity: 60, unitPrice: 14200 },
  { name: 'Optical Prism Coupler', sku: 'OPC-404', bin: 'D-01', qty: 4, reserved: 0, lowThreshold: 20, criticalThreshold: 5, reorderQuantity: 50, unitPrice: 8900 },
  { name: 'Magnetic Flux Sensor', sku: 'MFS-109', bin: 'B-08', qty: 0, reserved: 0, lowThreshold: 20, criticalThreshold: 5, reorderQuantity: 120, unitPrice: 6200 }
];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const number = value => Number(value || 0);
const validPositiveInt = value => Number.isSafeInteger(value) && value > 0 && value <= 1000000;
const validNonNegativeInt = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
const shopPath = (shopId, collectionName) => ['shops', shopId, collectionName];
const partStatus = part => number(part.qty) === 0 ? 'out-of-stock' : number(part.qty) <= number(part.criticalThreshold) ? 'critical' : number(part.qty) <= number(part.lowThreshold) ? 'low' : 'healthy';
const iso = value => value?.toDate ? value.toDate().toISOString() : value ? new Date(value).toISOString() : new Date().toISOString();

function publicPart(id, part) {
  return { id, name: part.name, sku: part.sku, qty: number(part.qty), status: partStatus(part), bin: part.bin || '', unitPrice: number(part.unitPrice), reserved: number(part.reserved) };
}

function publicUser(profile, uid) {
  return { id: uid, name: profile.name, role: profile.role || 'Station Operator', station: profile.station || 'dock-04', identity: profile.identity, phone: profile.phone || '', shopName: profile.shopName };
}

function friendlyError(error) {
  if (error?.status) return error;
  const code = error?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-email' || code === 'auth/invalid-login-credentials') return fail('Identity or passkey is incorrect.', 401);
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') return fail('An account already uses that email.', 409);
  if (code === 'auth/weak-password') return fail('Use a passkey of at least 8 characters.', 400);
  if (code === 'auth/operation-not-allowed') return fail('Firebase sign-in provider is disabled. If this happened during phone verification, enable Authentication → Sign-in method → Phone, allow the SMS destination country, and add this website domain under Authorized domains.', 503);
  if (code === 'auth/invalid-verification-code') return fail('That verification code is incorrect. Check it and try again.', 400);
  if (code === 'auth/code-expired') return fail('That verification code expired. Request a new code.', 400);
  if (code === 'auth/invalid-phone-number') return fail('Enter a valid phone number with its country code.', 400);
  if (code === 'auth/unauthorized-domain') return fail('This website address is not allowed for phone verification. Add its domain in Firebase Authentication settings.', 403);
  if (code === 'auth/captcha-check-failed') return fail('Phone verification could not pass the security check. Check Firebase allowed domains and try again.', 400);
  if (code === 'auth/too-many-requests') return fail('Too many verification attempts. Wait a while before trying again.', 429);
  if (code === 'auth/quota-exceeded') return fail('Phone verification is temporarily unavailable. Try again later.', 429);
  if (code === 'auth/network-request-failed') return fail('Could not reach Firebase. Check your connection and try again.', 0);
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return fail('Firebase blocked this request. Check the Firestore rules and signed-in account.', 403);
  if (code === 'unavailable' || code === 'firestore/unavailable') return fail('Firebase is temporarily unavailable. Try again shortly.', 503);
  return fail(error?.message || 'Firebase could not complete this request.', 500);
}

async function authContext() {
  const sdk = await getFirebase();
  const user = await getFirebaseUser();
  if (!user) throw fail('Please sign in to continue.', 401);
  const profileRef = sdk.doc(sdk.db, 'operators', user.uid);
  const profileSnap = await sdk.getDoc(profileRef);
  if (!profileSnap.exists()) throw fail('Operator profile was not found. Please register again.', 404);
  const profile = profileSnap.data();
  return { ...sdk, user, profile, shopId: profile.shopId, operatorId: user.uid };
}

async function getProfile(sdk, user) {
  const profileSnap = await sdk.getDoc(sdk.doc(sdk.db, 'operators', user.uid));
  if (!profileSnap.exists()) throw fail('Operator profile was not found. Please contact your administrator.', 404);
  return profileSnap.data();
}

async function login(body) {
  const { auth, signInWithEmailAndPassword, getIdToken } = await getFirebase();
  const identity = String(body.identity || '').trim().toLowerCase();
  const passkey = String(body.passkey || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity) || !passkey) throw fail('Identity or passkey is incorrect.', 401);
  const credential = await signInWithEmailAndPassword(auth, identity, passkey);
  const sdk = await getFirebase();
  const profile = await getProfile(sdk, credential.user);
  return { token: await getIdToken(credential.user), user: publicUser(profile, credential.user.uid) };
}

async function resetPassword(body) {
  const identity = String(body.identity || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) throw fail('Enter the email address for your account.', 400);
  const sdk = await getFirebase();
  try { await sdk.sendPasswordResetEmail(sdk.auth, identity); }
  catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
  return { message: 'If an account uses that email, a password reset link has been sent.' };
}

async function register(body) {
  const shopName = String(body.shopName || '').trim();
  const operatorName = String(body.operatorName || '').trim();
  const station = String(body.station || 'dock-04').trim() || 'dock-04';
  const identity = String(body.identity || '').trim().toLowerCase();
  const passkey = String(body.passkey || '');
  if (body.termsAccepted !== true) throw fail('Please agree to the Terms and Conditions before creating your shop.', 400);
  let phone;
  try { phone = normalizePhone(body.phone); } catch (error) { throw fail(error.message, 400); }
  if (!shopName || shopName.length > 160 || !operatorName || operatorName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity) || passkey.length < 8 || passkey.length > 200) {
    throw fail('Enter a shop name, operator name, valid email, and passkey of at least 8 characters.', 400);
  }
  const sdk = await getFirebase();
  const phoneUser = sdk.auth.currentUser;
  if (!phoneUser || phoneUser.phoneNumber !== phone) throw fail('Verify your phone number before creating the shop.', 400);
  const credential = await sdk.linkWithCredential(phoneUser, sdk.EmailAuthProvider.credential(identity, passkey));
  const uid = credential.user.uid;
  const batch = sdk.writeBatch(sdk.db);
  const now = sdk.serverTimestamp();
  batch.set(sdk.doc(sdk.db, 'shops', uid), { ownerUid: uid, name: shopName, station, createdAt: now });
  const profile = { shopId: uid, name: operatorName, identity, phone, role: 'Lead Technician', station, shopName, createdAt: now, termsAcceptedAt: now };
  batch.set(sdk.doc(sdk.db, 'operators', uid), profile);
  for (const seed of seedParts) {
    const partRef = sdk.doc(sdk.collection(sdk.db, ...shopPath(uid, 'parts')));
    batch.set(partRef, { ...seed, shopId: uid, createdAt: now, updatedAt: now });
  }
  try {
    await batch.commit();
  } catch (error) {
    try { await sdk.deleteUser(credential.user); } catch { /* keep the original setup error */ }
    throw error;
  }
  return { token: await sdk.getIdToken(credential.user), user: publicUser(profile, uid) };
}

async function listParts(path) {
  const context = await authContext();
  const { searchParams } = new URL(path, location.origin);
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const status = (searchParams.get('status') || '').trim();
  const snapshot = await context.getDocs(context.collection(context.db, ...shopPath(context.shopId, 'parts')));
  return snapshot.docs.map(item => publicPart(item.id, item.data()))
    .filter(part => !search || `${part.name} ${part.sku} ${part.bin}`.toLowerCase().includes(search))
    .filter(part => !status || status === 'all' || part.status === status)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function movementData({ context, part, action, delta, note = '', invoiceId = null }) {
  return {
    shopId: context.shopId,
    operatorId: context.operatorId,
    partId: part.id,
    partName: part.name,
    sku: part.sku,
    action,
    quantityDelta: delta,
    quantityAfter: number(part.qty),
    note,
    invoiceId,
    createdAt: context.serverTimestamp()
  };
}

function publicInvoice(id, invoice) {
  return {
    id,
    number: invoice.number,
    createdAt: iso(invoice.createdAt),
    status: invoice.status || 'dispensed',
    operator: invoice.operator,
    station: invoice.station,
    shopName: invoice.shopName || '',
    subtotal: number(invoice.subtotal),
    tax: number(invoice.tax),
    discount: number(invoice.discount),
    total: number(invoice.total),
    paymentMode: invoice.paymentMode,
    transactionRef: invoice.transactionRef,
    items: Array.isArray(invoice.items) ? invoice.items : []
  };
}

async function dispense(partId, body) {
  const qty = Number(body.qty);
  if (!validPositiveInt(qty)) throw fail('Enter a whole quantity greater than zero.', 400);
  const context = await authContext();
  const partRef = context.doc(context.db, ...shopPath(context.shopId, 'parts'), partId);
  const invoiceRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'invoices')));
  const movementRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'stockMovements')));
  const createdAt = context.serverTimestamp();
  const result = await context.runTransaction(context.db, async transaction => {
    const snapshot = await transaction.get(partRef);
    if (!snapshot.exists()) throw fail('Part not found.', 404);
    const part = { id: snapshot.id, ...snapshot.data() };
    if (number(part.qty) < qty) throw fail(`Only ${part.qty} units are available.`, 409);
    const updated = { ...part, qty: number(part.qty) - qty };
    const subtotal = Number((qty * number(part.unitPrice)).toFixed(2));
    const tax = Number((subtotal * 0.18).toFixed(2));
    const invoice = {
      shopId: context.shopId, operatorId: context.operatorId, number: `TX-${invoiceRef.id.slice(-6).toUpperCase()}`,
      createdAt, status: 'dispensed', operator: context.profile.name, station: context.profile.station || 'Dock #04', shopName: context.profile.shopName || '',
      subtotal, tax, discount: 0, total: Number((subtotal + tax).toFixed(2)), paymentMode: 'UPI / Quantum Ledger',
      transactionRef: `QTM-${Date.now()}`,
      items: [{ partId, name: part.name, sku: part.sku, bin: part.bin || '', qty, unitPrice: number(part.unitPrice), amount: subtotal }]
    };
    transaction.update(partRef, { qty: updated.qty, updatedAt: createdAt });
    transaction.set(invoiceRef, invoice);
    transaction.set(movementRef, movementData({ context, part: updated, action: 'dispense', delta: -qty, note: `Invoice ${invoice.number}`, invoiceId: invoiceRef.id }));
    return { part: publicPart(partId, updated), invoice: publicInvoice(invoiceRef.id, { ...invoice, createdAt: new Date() }) };
  });
  return result;
}

async function adjustStock(partId, body, mode) {
  const rawQty = mode === 'audit' ? body.countedQty : body.qty;
  const qty = Number(rawQty);
  if (mode === 'audit' ? !validNonNegativeInt(qty) : !validPositiveInt(qty)) throw fail(mode === 'audit' ? 'Enter a valid counted quantity.' : 'Enter a whole quantity greater than zero.', 400);
  const context = await authContext();
  const partRef = context.doc(context.db, ...shopPath(context.shopId, 'parts'), partId);
  const movementRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'stockMovements')));
  const createdAt = context.serverTimestamp();
  return context.runTransaction(context.db, async transaction => {
    const snapshot = await transaction.get(partRef);
    if (!snapshot.exists()) throw fail('Part not found.', 404);
    const previous = { id: snapshot.id, ...snapshot.data() };
    const nextQty = mode === 'audit' ? qty : number(previous.qty) + qty;
    const part = { ...previous, qty: nextQty };
    const discrepancy = nextQty - number(previous.qty);
    transaction.update(partRef, { qty: nextQty, updatedAt: createdAt });
    transaction.set(movementRef, movementData({ context, part, action: mode, delta: discrepancy, note: mode === 'audit' ? `${discrepancy} variance` : '' }));
    return { part: publicPart(partRef.id, part), ...(mode === 'audit' ? { discrepancy } : {}) };
  });
}

async function reorder(partId) {
  const context = await authContext();
  const partRef = context.doc(context.db, ...shopPath(context.shopId, 'parts'), partId);
  const orderRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'reorderOrders')));
  const movementRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'stockMovements')));
  const createdAt = context.serverTimestamp();
  return context.runTransaction(context.db, async transaction => {
    const snapshot = await transaction.get(partRef);
    if (!snapshot.exists()) throw fail('Part not found.', 404);
    const part = { id: snapshot.id, ...snapshot.data() };
    const qty = Math.max(number(part.reorderQuantity), number(part.lowThreshold) * 2 - number(part.qty), 1);
    const order = { id: orderRef.id, partId, sku: part.sku, shopId: context.shopId, operatorId: context.operatorId, qty, status: 'submitted', createdAt };
    transaction.set(orderRef, order);
    transaction.set(movementRef, movementData({ context, part, action: 'emergency_reorder', delta: 0, note: orderRef.id }));
    return { order: { ...order, createdAt: iso(new Date()) } };
  });
}

async function reconcile(body) {
  const code = String(body.code || '').trim();
  if (!code) throw fail('Scan code is required.', 400);
  const context = await authContext();
  const partsCollection = context.collection(context.db, ...shopPath(context.shopId, 'parts'));
  let partRef = context.doc(partsCollection, code);
  let snapshot = await context.getDoc(partRef);
  if (!snapshot.exists()) {
    const found = await context.getDocs(context.query(partsCollection, context.where('sku', '==', code.toUpperCase()), context.limit(1)));
    if (found.empty) throw fail('No part matches that scan code.', 404);
    snapshot = found.docs[0];
    partRef = snapshot.ref;
  }
  const movementRef = context.doc(context.collection(context.db, ...shopPath(context.shopId, 'stockMovements')));
  const part = { id: snapshot.id, ...snapshot.data() };
  await context.setDoc(movementRef, movementData({ context, part, action: 'scan_reconcile', delta: 0, note: 'Scan verified' }));
  return { part: publicPart(snapshot.id, part), discrepancy: 0 };
}

async function invoiceById(id) {
  const context = await authContext();
  const snapshot = await context.getDoc(context.doc(context.db, ...shopPath(context.shopId, 'invoices'), id));
  if (!snapshot.exists()) throw fail('Invoice not found.', 404);
  return { invoice: publicInvoice(snapshot.id, snapshot.data()) };
}

async function saveVerifiedPhone(body) {
  const context = await authContext();
  let phone;
  try { phone = normalizePhone(body.phone); } catch (error) { throw fail(error.message, 400); }
  if (context.user.phoneNumber !== phone || getVerifiedPhone() !== phone) throw fail('Verify this phone number before saving it to your profile.', 400);
  await context.updateDoc(context.doc(context.db, 'operators', context.operatorId), { phone });
  return { user: publicUser({ ...context.profile, phone }, context.operatorId) };
}

async function updateOperatorProfile(body) {
  const context = await authContext();
  const name = String(body.name || '').trim();
  const shopName = String(body.shopName || '').trim();
  const station = String(body.station || '').trim();
  if (!name || name.length > 120 || !shopName || shopName.length > 160 || !station || station.length > 80) {
    throw fail('Enter a name, shop name, and station within the allowed length.', 400);
  }
  const batch = context.writeBatch(context.db);
  batch.update(context.doc(context.db, 'operators', context.operatorId), { name, shopName, station });
  batch.update(context.doc(context.db, 'shops', context.shopId), { name: shopName, station });
  await batch.commit();
  return { user: publicUser({ ...context.profile, name, shopName, station }, context.operatorId) };
}

async function currentOperatorProfile() {
  const context = await authContext();
  return { user: publicUser(context.profile, context.operatorId) };
}

async function listMovements() {
  const context = await authContext();
  const movements = context.collection(context.db, ...shopPath(context.shopId, 'stockMovements'));
  const snapshot = await context.getDocs(context.query(movements, context.orderBy('createdAt', 'desc'), context.limit(50)));
  return snapshot.docs.map(item => {
    const row = item.data();
    return { action: String(row.action || '').replaceAll('_', ' '), partId: row.partId, partName: row.partName, sku: row.sku, qty: row.action === 'audit' ? number(row.quantityAfter) : Math.abs(number(row.quantityDelta)), note: row.note || '', timestamp: iso(row.createdAt) };
  });
}

async function metrics() {
  const context = await authContext();
  const [partSnapshot, movementSnapshot] = await Promise.all([
    context.getDocs(context.collection(context.db, ...shopPath(context.shopId, 'parts'))),
    context.getDocs(context.query(context.collection(context.db, ...shopPath(context.shopId, 'stockMovements')), context.orderBy('createdAt', 'desc'), context.limit(200)))
  ]);
  const parts = partSnapshot.docs.map(item => item.data());
  const movements = movementSnapshot.docs.map(item => item.data());
  const now = new Date();
  const labels = [];
  const consumption = [];
  for (let offset = 8; offset >= 0; offset--) {
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    hour.setHours(hour.getHours() - offset);
    labels.push(hour.toISOString().slice(11, 16));
    consumption.push(movements.reduce((sum, movement) => {
      const time = movement.createdAt?.toDate?.();
      return sum + (movement.action === 'dispense' && time && time.getTime() >= hour.getTime() && time.getTime() < hour.getTime() + 3600000 ? Math.abs(number(movement.quantityDelta)) : 0);
    }, 0));
  }
  const available = parts.filter(part => number(part.qty) > 0).length;
  return {
    trackedItems: parts.reduce((sum, part) => sum + number(part.qty), 0),
    bays: new Set(parts.map(part => part.bin).filter(Boolean)).size,
    criticalDepletions: parts.filter(part => number(part.qty) === 0 || number(part.qty) <= number(part.criticalThreshold)).length,
    accuracy: 100,
    availability: parts.length ? Number((100 * available / parts.length).toFixed(1)) : 0,
    consumption,
    labels
  };
}

export async function firebaseRequest(method, path, body = {}) {
  try {
    const url = new URL(path, location.origin);
    const route = url.pathname.replace(/\/$/, '') || '/';
    if (method === 'POST' && route === '/auth/login') return await login(body);
    if (method === 'POST' && route === '/auth/reset-password') return await resetPassword(body);
    if (method === 'POST' && route === '/auth/register') return await register(body);
    if (method === 'GET' && route === '/health') return { status: 'ok' };
    if (method === 'GET' && route === '/parts') return await listParts(path);
    const match = route.match(/^\/parts\/([^/]+)(?:\/(dispense|restock|audit|reorder))?$/);
    if (match) {
      const partId = decodeURIComponent(match[1]);
      if (method === 'POST' && match[2] === 'dispense') return await dispense(partId, body);
      if (method === 'POST' && match[2] === 'restock') return await adjustStock(partId, body, 'restock');
      if (method === 'POST' && match[2] === 'audit') return await adjustStock(partId, body, 'audit');
      if (method === 'POST' && match[2] === 'reorder') return await reorder(partId);
    }
    if (method === 'POST' && route === '/scan/reconcile') return await reconcile(body);
    const invoiceMatch = route.match(/^\/invoices\/([^/]+)$/);
    if (method === 'GET' && invoiceMatch) return await invoiceById(decodeURIComponent(invoiceMatch[1]));
    if (method === 'GET' && route === '/operator/metrics') return await metrics();
    if (method === 'GET' && route === '/operator/profile') return await currentOperatorProfile();
    if (method === 'POST' && route === '/operator/profile/phone') return await saveVerifiedPhone(body);
    if (method === 'POST' && route === '/operator/profile') return await updateOperatorProfile(body);
    if (method === 'GET' && (route === '/operator/timeline' || route === '/operator/shift-log')) return await listMovements();
    throw fail('Firebase endpoint not found.', 404);
  } catch (error) {
    throw friendlyError(error);
  }
}
