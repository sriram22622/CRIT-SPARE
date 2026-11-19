const emptyFirebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

let localFirebaseConfig = {};
try {
  ({ FIREBASE_CONFIG: localFirebaseConfig = {} } = await import('./firebase-config.local.js'));
} catch {
  // Local Firebase config is optional; without it, the app uses mock mode.
}

export const FIREBASE_CONFIG = Object.freeze({ ...emptyFirebaseConfig, ...localFirebaseConfig });
export const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/13.2.0';

export const isLocalDev = Boolean(
  typeof location !== 'undefined' && (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '::1' ||
    location.protocol === 'file:' ||
    String(location.hostname || '').endsWith('.local') ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.)/.test(location.hostname || '')
  )
);

export const USE_MOCK = !FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId || !FIREBASE_CONFIG.appId;
export const MOCK_DELAY_MS = 400;
export const MOCK_RANDOM_FAILURE_RATE = 0;
export const STORAGE_KEYS = Object.freeze({
  state: 'crit-spare.mock-state.v1',
  token: 'crit-spare.token',
  user: 'crit-spare.user',
  lastInvoice: 'crit-spare.last-invoice',
  rememberSignIn: 'crit-spare.remember-sign-in',
  cookieChoice: 'crit-spare.cookie-choice'
});

export function cacheProfile(user = {}) {
  return {
    id: String(user.id || ''),
    name: String(user.name || ''),
    role: String(user.role || 'Station Operator'),
    station: String(user.station || ''),
    shopName: String(user.shopName || ''),
    shopId: String(user.shopId || ''),
    phoneVerified: Boolean(user.phoneVerified || user.phone)
  };
}
