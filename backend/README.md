# Firebase backend

This project uses Firebase Authentication and Cloud Firestore directly from the browser. Firebase Web App configuration is loaded from `js/firebase-config.local.js` (ignored by Git); use `js/firebase-config.example.js` as the template. There is no local API server or private service-account key.

## Already configured

- Firebase project: `critical-alert-inventory`
- Web app: `Critical Alert Inventory Web`
- Firestore: Standard Native database in Mumbai (`asia-south1`), free-tier eligible, deletion protection enabled
- Firestore access rules: `firestore.rules`
- Email/password authentication: configured for deployment in `firebase.json`
- Phone OTP UI: implemented for new accounts and for adding a verified number to an existing profile. Phone provider and SMS-region permissions must be enabled in Firebase Console before sending real codes.

The first operator creates an account from the sign-up form. Registration provisions a private shop and operator profile starting with 0 stock items, ready for manual stock addition. Subsequent accounts create their own isolated shop. The dashboard profile card lets the signed-in operator update their name, shop, and station; existing accounts can add a verified phone there.

## Enable and test phone verification

In Firebase Console, open Authentication → Sign-in method and enable **Phone**. Then open Authentication → Settings → SMS region policy and allow India if your users are in India. Add a fictional test phone and fixed code under the Phone provider’s testing section for local development. Firebase documents that localhost is not an authorized hosted domain for real SMS phone auth; use a configured, hosted domain for real SMS. Real verification texts are billed per SMS, so test numbers avoid sending paid texts.

## Run locally

Open the project folder in VS Code, start Live Server, and open the local `index.html` URL. Use HTTP rather than opening the files directly. Sign up with an email address and a passkey of at least eight characters. To publish updated Firestore rules or auth settings later, run Firebase CLI deploy from this folder with the project in `.firebaserc`.

Firebase browser configuration is public by design. Never put an Admin SDK service account, private key, or database password in this folder.

