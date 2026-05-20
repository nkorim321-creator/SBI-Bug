// ==UserScript==
// @name         SBI
// @namespace    https://worker.mturk.com/
// @version      1.1
// @description  Super Fast Password-Protected Loader (HIT Catcher Optimized)
// @match        https://worker.mturk.com/*
// @match        https://*.mturk.com/*
// @match        https://*.amazonaws.com/*
// @match        https://*.mturkcontent.com/*
// @match        https://*.cloudfront.net/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        window.close
// @updateURL    https://raw.githubusercontent.com/nkorim321-creator/SBI-Bug/main/SBI%20Loader.user.js
// @downloadURL  https://raw.githubusercontent.com/nkorim321-creator/SBI-Bug/main/SBI%20Loader.user.js
// @connect      gist.githubusercontent.com
// @connect      docs.google.com
// @connect      worker.mturk.com
// @connect      *
// ==/UserScript==

(async function () {
  'use strict';

  // Gist RAW link to the encrypted payload
  const PAYLOAD_URL = 'https://gist.githubusercontent.com/nkorim321-creator/1e8742147067ebd4e5cb149dae52d178/raw/SBI.json';
  const PASS_KEY    = 'sbi_loader_pass';
  const MAX_TRIES   = 3;

  function b64ToBytes(b64) {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iter) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function decryptEncPayload(payload, password) {
    const iter = payload.iter || 10;
    const salt = b64ToBytes(payload.salt);
    const iv   = b64ToBytes(payload.iv);
    const data = b64ToBytes(payload.data);
    const key  = await deriveKey(password, salt, iter);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plain);
  }

  function fetchPayload() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: PAYLOAD_URL + '?_=' + Date.now(),
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        timeout: 20000,
        onload(r) {
          if (r.status !== 200) return reject(new Error('HTTP ' + r.status));
          try { resolve(JSON.parse(r.responseText)); }
          catch (e) { reject(new Error('Bad JSON: ' + e.message)); }
        },
        onerror() { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('Timeout')); }
      });
    });
  }

  function getStoredPassword() { return GM_getValue(PASS_KEY, ''); }
  function setStoredPassword(p) { GM_setValue(PASS_KEY, p || ''); }
  function clearStoredPassword() { GM_setValue(PASS_KEY, ''); }

  function askPassword(label) {
    const p = prompt(label || '🔒 Enter loader password:');
    return p == null ? null : p.trim();
  }

  function runScript(source) {
    try {
      // Direct eval keeps GM_* functions in scope for the loaded script
      // eslint-disable-next-line no-eval
      eval(source);
      console.log('[Loader] ✓ Script launched');
    } catch (e) {
      console.error('[Loader] Script execution failed:', e);
      alert('Loader: script execution failed — ' + e.message);
    }
  }

  try {
    const payload = await fetchPayload();

    let pass = getStoredPassword();
    let tries = 0;

    while (tries < MAX_TRIES) {
      if (!pass) pass = askPassword(tries === 0 ? '🔒 Enter loader password:' : '🔒 Wrong password — try again:');
      if (pass == null || pass === '') { console.log('[Loader] Cancelled'); return; }

      try {
        const source = await decryptEncPayload(payload, pass);
        setStoredPassword(pass);
        runScript(source);
        return;
      } catch (e) {
        tries++;
        console.warn('[Loader] Decrypt failed, attempt ' + tries + '/' + MAX_TRIES);
        clearStoredPassword();
        pass = '';
        if (tries >= MAX_TRIES) {
          alert('Loader: Wrong password ' + MAX_TRIES + ' times. Reload the page to try again.');
          return;
        }
      }
    }
  } catch (e) {
    console.error('[Loader] Fatal:', e);
    alert('Loader failed: ' + e.message);
  }
})();
