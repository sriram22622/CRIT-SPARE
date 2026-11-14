import { FIREBASE_CONFIG, FIREBASE_SDK_BASE } from './config.js';
let sdkPromise;
let recaptchaVerifier;
let recaptchaContainerId = '';
let phoneConfirmation;
let verifiedPhone = '';

export function isFirebaseConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.authDomain && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId);
}

export async function getFirebase() {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured yet. Add the web app settings in js/config.js.');
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(`${FIREBASE_SDK_BASE}/firebase-app.js`),
      import(`${FIREBASE_SDK_BASE}/firebase-auth.js`),
      import(`${FIREBASE_SDK_BASE}/firebase-firestore.js`)
    ]).then(async ([appSdk, authSdk, dbSdk]) => {
      const app = appSdk.getApps().find(item => item.name === 'crit-spare') || appSdk.initializeApp(FIREBASE_CONFIG, 'crit-spare');
      const auth = authSdk.getAuth(app);
      const remember = localStorage.getItem('crit-spare.remember-sign-in') === 'true';
      await authSdk.setPersistence(auth, remember ? authSdk.browserLocalPersistence : authSdk.browserSessionPersistence);
      return { app, auth, db: dbSdk.getFirestore(app), ...authSdk, ...dbSdk };
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

export async function getFirebaseUser() {
  const sdk = await getFirebase();
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = sdk.onAuthStateChanged(sdk.auth, user => {
      unsubscribe();
      resolve(user);
    }, () => {
      unsubscribe();
      resolve(null);
    });
  });
}

export async function signOutFirebase() {
  const sdk = await getFirebase();
  await sdk.signOut(sdk.auth);
}

export function normalizePhone(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  throw new Error('Enter a valid phone number with country code, for example +91 98765 43210.');
}

async function getPhoneRecaptcha(sdk, containerId) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error('Phone verification is unavailable on this page.');
  if (recaptchaVerifier && recaptchaContainerId === containerId) return recaptchaVerifier;
  if (recaptchaVerifier) {
    try { await recaptchaVerifier.clear(); } catch { /* reset a stale verifier */ }
  }
  recaptchaVerifier = new sdk.RecaptchaVerifier(sdk.auth, container, { size: 'normal' });
  recaptchaContainerId = containerId;
  await recaptchaVerifier.render();
  return recaptchaVerifier;
}

export async function initializePhoneRecaptcha(containerId = 'recaptcha-container') {
  const sdk = await getFirebase();
  await getPhoneRecaptcha(sdk, containerId);
}

export async function resetPhoneRecaptcha() {
  if (recaptchaVerifier) {
    try { await recaptchaVerifier.clear(); } catch { /* clear an expired verifier */ }
  }
  recaptchaVerifier = undefined;
  recaptchaContainerId = '';
  phoneConfirmation = undefined;
  verifiedPhone = '';
}

async function preparePhoneCode(value, containerId, send) {
  const phone = normalizePhone(value);
  const sdk = await getFirebase();
  const verifier = await getPhoneRecaptcha(sdk, containerId);
  phoneConfirmation = await send(sdk, phone, verifier);
  verifiedPhone = '';
  return phone;
}

export async function beginPhoneVerification(value) {
  return preparePhoneCode(value, 'recaptcha-container', (sdk, phone, verifier) => sdk.signInWithPhoneNumber(sdk.auth, phone, verifier));
}

export async function beginPhoneLink(value) {
  const sdk = await getFirebase();
  const user = sdk.auth.currentUser;
  if (!user) throw new Error('Sign in before verifying a phone number.');
  const phone = normalizePhone(value);
  if (user.phoneNumber === phone) { verifiedPhone = phone; return phone; }
  return preparePhoneCode(phone, 'profile-recaptcha-container', (authSdk, number, verifier) => authSdk.linkWithPhoneNumber(user, number, verifier));
}

export async function verifyPhoneCode(code) {
  if (!phoneConfirmation && verifiedPhone) return verifiedPhone;
  if (!phoneConfirmation) throw new Error('Request a verification code first.');
  if (!/^\d{6}$/.test(String(code || '').trim())) throw new Error('Enter the 6-digit code sent to your phone.');
  const result = await phoneConfirmation.confirm(String(code).trim());
  verifiedPhone = result.user.phoneNumber || '';
  if (!verifiedPhone) throw new Error('Firebase did not confirm this phone number. Request a new code.');
  return verifiedPhone;
}

export function getVerifiedPhone() { return verifiedPhone; }

export async function setRememberSignIn(remember) {
  const sdk = await getFirebase();
  await sdk.setPersistence(sdk.auth, remember ? sdk.browserLocalPersistence : sdk.browserSessionPersistence);
}
