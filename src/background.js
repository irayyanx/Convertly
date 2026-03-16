/**
 * Convertly — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Currency conversion math (single & multi-target).
 *  - Rate fetching from Yahoo Finance (sole provider).
 *  - Stale-while-revalidate caching (in-memory + chrome.storage.local).
 *  - History management in chrome.storage.local (avoids sync 8 KB quota).
 *  - Popup state bridging: on-page conversions push highlighted amount/currency
 *    into sync storage so the popup opens pre-populated ("ghost popup" fix).
 *  - First-install currency auto-detection via IANA timezone.
 */

const YAHOO_SYMBOLS = {
  'USD': 'USD', 'EGP': 'EGP=X', 'SAR': 'SAR=X', 'AED': 'AED=X', 'KWD': 'KWD=X', 'QAR': 'QAR=X',
  'BHD': 'BHD=X', 'OMR': 'OMR=X', 'JOD': 'JOD=X', 'PAL': 'JOD=X', 'LBP': 'LBP=X', 'MAD': 'MAD=X',
  'TND': 'TND=X', 'DZD': 'DZD=X', 'IQD': 'IQD=X', 'LYD': 'LYD=X', 'YER': 'YER=X', 'EUR': 'EUR=X',
  'GBP': 'GBP=X', 'JPY': 'JPY=X', 'CAD': 'CAD=X', 'AUD': 'AUD=X', 'CHF': 'CHF=X', 'CNY': 'CNY=X',
  'HKD': 'HKD=X', 'NZD': 'NZD=X', 'SEK': 'SEK=X', 'KRW': 'KRW=X', 'SGD': 'SGD=X', 'NOK': 'NOK=X',
  'MXN': 'MXN=X', 'INR': 'INR=X', 'RUB': 'RUB=X', 'ZAR': 'ZAR=X', 'TRY': 'TRY=X', 'BRL': 'BRL=X',
  'IDR': 'IDR=X', 'MYR': 'MYR=X', 'PHP': 'PHP=X', 'THB': 'THB=X', 'VND': 'VND=X', 'PKR': 'PKR=X',
  'BDT': 'BDT=X', 'NGN': 'NGN=X', 'ILS': 'ILS=X', 'BTC': 'BTC-USD', 'ETH': 'ETH-USD',
  'ADA': 'ADA-USD', 'SOL': 'SOL-USD', 'XRP': 'XRP-USD'
};

// Cache TTL — rates are refreshed in the background after this window expires.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let ratesCache = {};
chrome.storage.local.get(['ratesCache'], (d) => { if (d.ratesCache) ratesCache = d.ratesCache; });

// --- First-Install Defaults + Cache Pre-warming ---
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    const lc = guessLocalCurrency();
    chrome.storage.sync.get(['targetCurrency'], (d) => {
      if (!d.targetCurrency) chrome.storage.sync.set({ targetCurrency: lc, selectedCurrencies: [lc], fromCurrency: 'USD' });
    });
  }
  // Pre-warm cache after install or update so the popup is instant
  prewarmCache();
});

// Pre-warm on every service worker startup (browser launch / wake from sleep)
chrome.runtime.onStartup.addListener(() => {
  prewarmCache();
});

// Silently fetch rates for the user's configured currencies so the popup
// can read from cache immediately without waiting for a network round-trip.
async function prewarmCache() {
  try {
    const data = await chrome.storage.sync.get(['fromCurrency', 'targetCurrency', 'selectedCurrencies']);
    const currencies = new Set();
    if (data.fromCurrency) currencies.add(data.fromCurrency);
    if (data.targetCurrency) currencies.add(data.targetCurrency);
    (data.selectedCurrencies || []).forEach(c => currencies.add(c));
    if (!currencies.size) currencies.add(guessLocalCurrency());
    // Fire-and-forget parallel fetches
    for (const c of currencies) {
      getRate(c).catch(() => {});
    }
  } catch (_) { /* Non-critical: popup will still work, just without pre-warmed cache */ }
}

function guessLocalCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const m = { 'Cairo':'EGP','Riyadh':'SAR','Dubai':'AED','Kuwait':'KWD','Qatar':'QAR','Bahrain':'BHD','Muscat':'OMR','Amman':'JOD','Beirut':'LBP','Casablanca':'MAD','Tunis':'TND','Algiers':'DZD','Baghdad':'IQD','Tripoli':'LYD','Aden':'YER','Istanbul':'TRY','Jerusalem':'ILS','Gaza':'ILS','London':'GBP','Tokyo':'JPY','Toronto':'CAD','Vancouver':'CAD','Sydney':'AUD','Melbourne':'AUD','Zurich':'CHF','Shanghai':'CNY','Hong_Kong':'HKD','Auckland':'NZD','Stockholm':'SEK','Oslo':'NOK','Seoul':'KRW','Singapore':'SGD','Mexico_City':'MXN','Kolkata':'INR','Moscow':'RUB','Sao_Paulo':'BRL','Johannesburg':'ZAR','Jakarta':'IDR','Kuala_Lumpur':'MYR','Manila':'PHP','Bangkok':'THB','Ho_Chi_Minh':'VND','Karachi':'PKR','Dhaka':'BDT','Lagos':'NGN' };
    for (const [k,v] of Object.entries(m)) if (tz.includes(k)) return v;
    if (tz.startsWith('Europe/')) return 'EUR';
    if (tz.startsWith('America/')) return 'USD';
  } catch(_){}
  return 'EUR';
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convert' || request.action === 'convertMulti') {
    if (request.action === 'convert') {
      handleConversion(request.amount, request.fromCurrency, request.targetCurrency).then(sendResponse);
    } else {
      convertMultiCurrency(request.amount, request.fromCurrency)
        .then(data => sendResponse({ success: true, data, symbol: request.fromCurrency }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
    return true;
  }

  // On-page conversions — bridge context to popup ("ghost popup" fix)
  if (request.action === 'convertFromPage' || request.action === 'convertMultiFromPage') {
    bridgeOnPageToPopup(request.amount, request.fromCurrency);
    if (request.action === 'convertFromPage') {
      handleConversion(request.amount, request.fromCurrency, request.targetCurrency).then(sendResponse);
    } else {
      convertMultiCurrency(request.amount, request.fromCurrency)
        .then(data => sendResponse({ success: true, data, symbol: request.fromCurrency }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
    return true;
  }

  if (request.action === 'saveToHistory') {
    const target = request.targetCurrency || guessLocalCurrency();
    saveToHistory(request.amount, request.fromCurrency, target, request.title, request.domain, request.url, request.billingCycle)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'archiveManualEntry') {
    archiveManualEntry(request.amount, request.fromCurrency, request.targetCurrency)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Return the latest cache timestamp for the API status indicator.
  if (request.action === 'getCacheStatus') {
    let latest = 0, provTs = null;
    for (const s of Object.keys(ratesCache)) {
      if (ratesCache[s].timestamp > latest) {
        latest = ratesCache[s].timestamp;
        provTs = ratesCache[s].providerTimestamp || null;
      }
    }
    sendResponse({ lastUpdated: latest > 0 ? latest : null, providerTimestamp: provTs });
    return true;
  }
});

// --- Ghost Popup Fix: bridge on-page context into sync storage ---
function bridgeOnPageToPopup(amount, fromCurrency) {
  chrome.storage.sync.get(['lastAmount', 'fromCurrency'], (d) => {
    if (d.lastAmount && d.lastAmount != amount) {
      archiveManualEntry(d.lastAmount, d.fromCurrency || 'USD');
    }
    chrome.storage.sync.set({ lastAmount: String(amount), fromCurrency });
  });
}

// --- History Management ---
// Context-aware dedup: uses exact URL match (includes #:~:text= fragment)
async function saveToHistory(amount, from, to, pageTitle, pageDomain, pageUrl, billingCycle) {
  return new Promise(resolve => {
    chrome.storage.local.get(['history'], (data) => {
      let history = data.history || [];
      const newItem = {
        id: Date.now(), amount, from, to,
        title: pageTitle || 'Unknown Item',
        domain: (pageDomain && pageDomain.trim() !== '') ? pageDomain : 'Unknown Website',
        url: pageUrl || null,
        billingCycle: billingCycle || null,
        timestamp: Date.now()
      };
      // Only block if EXACT same amount AND EXACT same URL (text fragment makes it location-specific)
      const isDup = history.some(i => i.amount == newItem.amount && i.from === newItem.from && i.url && newItem.url && i.url === newItem.url);
      if (!isDup) {
        history.unshift(newItem);
        if (history.length > 50) history.length = 50;
        chrome.storage.local.set({ history }, resolve);
      } else { resolve(); }
    });
  });
}

async function archiveManualEntry(amount, from, to) {
  return new Promise(resolve => {
    chrome.storage.local.get(['history'], (data) => {
      let history = data.history || [];
      if (history.length > 0 && history[0].amount == amount && history[0].from === from && history[0].domain === 'Manual Entry') return resolve();
      history.unshift({ id: Date.now(), amount, from, to: to || guessLocalCurrency(), title: 'Calculator', domain: 'Manual Entry', timestamp: Date.now() });
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ history }, resolve);
    });
  });
}

// --- Conversion Engine ---
async function handleConversion(amount, from, to) {
  try {
    if (from === to) return { success: true, result: amount, rate: 1, symbol: to };
    const rF = await getRate(from), rT = await getRate(to);
    return { success: true, result: (amount / rF) * rT, rate: rT / rF, symbol: to };
  } catch (e) { return { success: false, error: e.message }; }
}

// --- Rate Fetching (Stale-While-Revalidate, Yahoo Finance only) ---
// Returns a cached rate immediately if available, then silently refreshes
// in the background when stale. Calculations resolve in <1 ms from cache.
async function getRate(currency) {
  if (currency === 'USD') return 1;
  const symbol = YAHOO_SYMBOLS[currency];
  if (!symbol) throw new Error(`Currency ${currency} not supported`);

  const cached = ratesCache[symbol];
  const now = Date.now();

  if (cached) {
    if (now - cached.timestamp > CACHE_TTL_MS) {
      // Stale — spawn a silent background refresh, return stale rate now
      fetchAndCache(symbol, symbol.endsWith('-USD'), now).catch(() => {});
    }
    return cached.rate;
  }

  // Cold start — must fetch synchronously
  return fetchAndCache(symbol, symbol.endsWith('-USD'), now);
}

async function fetchAndCache(symbol, isCrypto, now) {
  const { rate, providerTimestamp } = await fetchYahooRate(symbol, isCrypto);
  ratesCache[symbol] = { rate, timestamp: now, providerTimestamp };
  persistCache();
  return rate;
}

async function fetchYahooRate(symbol, isCrypto) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const d = await r.json();
  if (!d.chart.result?.length) throw new Error('Invalid Yahoo API response');
  const meta = d.chart.result[0].meta;
  let rate = meta.regularMarketPrice;
  if (isCrypto) rate = 1 / rate;
  const providerTimestamp = meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now();
  return { rate, providerTimestamp };
}

function persistCache() { chrome.storage.local.set({ ratesCache }); }

async function convertMultiCurrency(amount, from) {
  const s = await chrome.storage.sync.get(['selectedCurrencies']);
  const targets = s.selectedCurrencies?.length > 0 ? s.selectedCurrencies : [guessLocalCurrency()];
  return Promise.all(targets.map(async (c) => {
    try { const r = await handleConversion(amount, from, c); return { currency: c, value: r.result }; }
    catch(_) { return { currency: c, value: 0 }; }
  }));
}