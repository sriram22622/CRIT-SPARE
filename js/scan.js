import { api } from './api.js';

const isMobileMode = () => window.matchMedia('(max-width: 760px) and (pointer: coarse)').matches
  || (navigator.maxTouchPoints > 0 && window.innerWidth <= 760);

export function initScan() {
  const controls = document.querySelector('[data-scan-controls]');
  const desktopNote = document.querySelector('[data-desktop-scan-note]');
  const video = document.querySelector('[data-scan-video]');
  const status = document.querySelector('[data-scan-status]');
  const startButton = document.querySelector('[data-action="start-camera"]');
  const form = document.querySelector('[data-manual-scan]');
  const result = document.querySelector('[data-scan-result]');
  const codeInput = form?.querySelector('[name="code"]');
  let stream = null;
  let active = false;
  let frame = 0;

  if (!isMobileMode()) {
    controls.hidden = true;
    desktopNote.hidden = false;
    status.textContent = 'This scanner works on a phone.';
    return;
  }

  const requestedCode = new URLSearchParams(location.search).get('code');
  if (requestedCode && codeInput) codeInput.value = requestedCode;

  const stopCamera = () => {
    active = false;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    startButton.disabled = false;
  };

  const showPart = part => {
    result.hidden = false;
    result.querySelector('[data-result-name]').textContent = part.name;
    result.querySelector('[data-result-details]').textContent = `${part.sku} • ${part.qty} in stock • ${part.status}`;
    result.querySelector('[data-result-link]').href = `inventory.html?search=${encodeURIComponent(part.sku)}`;
  };

  const reconcile = async code => {
    const cleanCode = String(code || '').trim();
    if (!cleanCode) { status.textContent = 'Enter or scan a part code.'; return; }
    status.textContent = 'Looking up the part…';
    try {
      const response = await api.reconcile(cleanCode);
      showPart(response.part);
      status.textContent = 'Part found.';
      stopCamera();
    } catch (error) {
      status.textContent = error.message || 'Could not find that part. Try again.';
    }
  };

  const scanFrame = async detector => {
    if (!active) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) { await reconcile(codes[0].rawValue); return; }
      } catch { /* wait for the next camera frame */ }
    }
    frame = requestAnimationFrame(() => scanFrame(detector));
  };

  startButton.addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      status.textContent = 'Camera scanning is not supported here. Enter the code below instead.';
      form.querySelector('[name="code"]').focus();
      return;
    }
    startButton.disabled = true; status.textContent = 'Opening camera…';
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; video.hidden = false; await video.play(); active = true;
      status.textContent = 'Camera is on. Hold it over the part code.';
      scanFrame(detector);
    } catch (error) {
      stopCamera();
      status.textContent = error.name === 'NotAllowedError'
        ? 'Allow camera access in your browser settings, then try again.'
        : 'Could not open the camera. Enter the part code below instead.';
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    reconcile(new FormData(form).get('code')).finally(() => { button.disabled = false; });
  });

  window.addEventListener('pagehide', stopCamera, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
}
