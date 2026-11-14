# CRIT-SPARE Inventory

A responsive spare-parts inventory and billing interface built with semantic HTML, CSS, and browser JavaScript. The app includes shop sign-in and setup, inventory tracking, an operator dashboard, scanning UI, and invoice/receipt layouts.

## Run locally

1. Open this folder in Visual Studio Code.
2. Start the Live Server extension from `index.html` (or another page).
3. Open the URL shown by Live Server.

The site uses relative file links and is intended to be served over HTTP rather than opened directly with `file://`.

## Firebase setup

Firebase Web App configuration is loaded from `js/firebase-config.local.js`, which is excluded from Git. To configure Firebase in a fresh checkout, copy `js/firebase-config.example.js` to `js/firebase-config.local.js` and fill in your Web App configuration from Firebase Console. Without the local file, the app uses mock mode.

Browser Firebase configuration is visible to users when the app runs and is not a server-side secret. Protect the project with Firebase API key restrictions, authorized domains, and reviewed Firestore security rules. Never add Firebase Admin service-account keys or private credentials to this repository.

Phone verification requires the Phone sign-in provider and SMS region policy to be configured in Firebase Authentication. Use Firebase test phone numbers during development to avoid sending real SMS messages.

## Project files

- `index.html`, `inventory.html`, `dashboard.html`, `auth.html`, `invoice.html`, `scan.html`, `legal.html` — application screens
- `css/style.css` — shared styling and responsive layouts
- `js/` — browser interactions and Firebase integration
- `firestore.rules` — Firestore access rules
- `firebase.json`, `.firebaserc` — Firebase project configuration
- `backend/README.md` — additional backend and Firebase notes

## Before publishing

Review the legal and privacy text, Firebase project settings, Firestore rules, and all sample content for your deployment. Do not include private credentials or real customer data.
