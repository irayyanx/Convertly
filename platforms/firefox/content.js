/**
 * Convertly — Content Script (On-Page Conversion Engine) [Firefox Build]
 *
 * Firefox-specific version using strict DOM-safe methods (createElement,
 * textContent, setAttribute) instead of innerHTML, to comply with
 * Firefox/AMO Content Security Policy requirements.
 *
 * All business logic is identical to content.js (Chrome version).
 */

let currentTooltip = null;
let prefs = { decimalDigits: 2, onPageMode: 'single', theme: 'dark', lang: 'en' };
let isEnabled = false;

function guessLocalCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const tzMap = {
      'Cairo': 'EGP', 'Riyadh': 'SAR', 'Dubai': 'AED', 'Kuwait': 'KWD', 'Qatar': 'QAR',
      'Bahrain': 'BHD', 'Muscat': 'OMR', 'Amman': 'JOD', 'Beirut': 'LBP', 'Casablanca': 'MAD',
      'Tunis': 'TND', 'Algiers': 'DZD', 'Baghdad': 'IQD', 'Tripoli': 'LYD', 'Aden': 'YER',
      'Istanbul': 'TRY', 'Jerusalem': 'ILS', 'Gaza': 'ILS', 'London': 'GBP', 'Tokyo': 'JPY',
      'Toronto': 'CAD', 'Vancouver': 'CAD', 'Sydney': 'AUD', 'Melbourne': 'AUD', 'Zurich': 'CHF',
      'Shanghai': 'CNY', 'Hong_Kong': 'HKD', 'Auckland': 'NZD', 'Stockholm': 'SEK', 'Oslo': 'NOK',
      'Seoul': 'KRW', 'Singapore': 'SGD', 'Mexico_City': 'MXN', 'Kolkata': 'INR', 'Moscow': 'RUB',
      'Sao_Paulo': 'BRL', 'Johannesburg': 'ZAR', 'Jakarta': 'IDR', 'Kuala_Lumpur': 'MYR',
      'Manila': 'PHP', 'Bangkok': 'THB', 'Ho_Chi_Minh': 'VND', 'Karachi': 'PKR', 'Dhaka': 'BDT',
      'Lagos': 'NGN'
    };
    for (const [key, curr] of Object.entries(tzMap)) if (tz.includes(key)) return curr;
    if (tz.startsWith('Europe/')) return 'EUR';
    if (tz.startsWith('America/')) return 'USD';
  } catch (_) { /* Fall through to default */ }
  return 'EUR';
}

const CURRENCY_NAMES_AR = {
  'USD': 'دولار أمريكي', 'EUR': 'يورو', 'GBP': 'جنيه إسترليني', 'EGP': 'جنيه مصري',
  'SAR': 'ريال سعودي', 'AED': 'درهم إماراتي', 'KWD': 'دينار كويتي', 'QAR': 'ريال قطري',
  'JOD': 'دينار أردني', 'PAL': 'دينار أردني', 'LBP': 'ليرة لبنانية', 'MAD': 'درهم مغربي',
  'TND': 'دينار تونسي', 'DZD': 'دينار جزائري', 'IQD': 'دينار عراقي', 'LYD': 'دينار ليبي',
  'YER': 'ريال يمني', 'TRY': 'ليرة تركية', 'ILS': 'شيكل', 'JPY': 'ين ياباني',
  'CAD': 'دولار كندي', 'AUD': 'دولار أسترالي', 'CHF': 'فرنك سويسري', 'CNY': 'يوان صيني',
  'RUB': 'روبل روسي', 'INR': 'روبية هندية', 'BTC': 'بيتكوين', 'ETH': 'إيثيريوم',
  'BHD': 'دينار بحريني', 'OMR': 'ريال عماني', 'HKD': 'دولار هونج كونج', 'NZD': 'دولار نيوزيلندي',
  'SEK': 'كرونة سويدية', 'NOK': 'كرونة نرويجية', 'KRW': 'وون كوري', 'SGD': 'دولار سنغافوري',
  'MXN': 'بيزو مكسيكي', 'BRL': 'ريال برازيلي', 'ZAR': 'راند جنوب أفريقيا', 'IDR': 'روبية إندونيسية',
  'MYR': 'رينغيت ماليزي', 'PHP': 'بيزو فلبيني', 'THB': 'بات تايلاندي', 'VND': 'دونغ فيتنامي',
  'PKR': 'روبية باكستانية', 'BDT': 'تاكا بنغلاديشي', 'NGN': 'نايرا نيجيري', 'ADA': 'كاردانو',
  'SOL': 'سولانا', 'XRP': 'ريبل'
};

const link = document.createElement('link');
link.href = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap';
link.rel = 'stylesheet';
document.head.appendChild(link);

chrome.storage.sync.get(['prefs', 'onPageEnabled'], (res) => {
  if (res.prefs) prefs = { ...prefs, ...res.prefs };
  isEnabled = res.onPageEnabled || false;
});

chrome.storage.onChanged.addListener((ch) => {
  if (ch.prefs) prefs = { ...prefs, ...ch.prefs.newValue };
  if (ch.onPageEnabled) isEnabled = ch.onPageEnabled.newValue;
});

function formatNum(num, currencyCode) {
  const isCrypto = ['BTC', 'ETH', 'ADA', 'SOL', 'XRP'].includes(currencyCode);
  const digits = isCrypto ? 6 : parseInt(prefs.decimalDigits);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: isCrypto ? 8 : digits
  }).format(num);
}

function detectCurrency(text) {
  const upper = text.toUpperCase();
  const symbolMatches = [['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₺', 'TRY'], ['₽', 'RUB'], ['₹', 'INR'], ['₩', 'KRW'], ['₦', 'NGN']];
  for (const [sym, code] of symbolMatches) if (upper.includes(sym)) return code;
  const arabicTokens = [['ج.م', 'EGP'], ['ر.س', 'SAR'], ['د.إ', 'AED'], ['د.ك', 'KWD'], ['ر.ق', 'QAR'], ['د.أ', 'JOD']];
  for (const [tok, code] of arabicTokens) if (upper.includes(tok.toUpperCase())) return code;
  const hasWordToken = (token) => new RegExp(`(^|[^A-Z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`, 'i').test(upper);
  const isoCodes = ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD', 'ILS', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'RUB', 'INR', 'KRW', 'SGD', 'MXN', 'BRL', 'ZAR', 'IDR', 'MYR', 'PHP', 'THB', 'VND', 'PKR', 'BDT', 'NGN', 'HKD', 'NZD', 'SEK', 'NOK', 'BTC', 'ETH', 'ADA', 'SOL', 'XRP', 'BHD', 'OMR', 'MAD', 'TND', 'DZD', 'IQD', 'LYD', 'YER', 'TRY'];
  for (const code of isoCodes) if (hasWordToken(code)) return code;
  const shortTokens = [['LE', 'EGP'], ['TL', 'TRY'], ['SR', 'SAR'], ['JD', 'JOD'], ['RS', 'INR'], ['DHS', 'AED']];
  for (const [tok, code] of shortTokens) if (hasWordToken(tok)) return code;
  return null;
}

function parseAmount(text) {
  if (!detectCurrency(text)) return null;
  let clean = text.trim().toUpperCase();
  let multiplier = 1;
  if (clean.endsWith('K')) multiplier = 1000;
  else if (clean.endsWith('M')) multiplier = 1_000_000;
  else if (clean.endsWith('B')) multiplier = 1_000_000_000;
  clean = clean.replace(/[KMB]/g, '');
  const numericMatch = clean.match(/[\d][,.\d]*/);
  if (!numericMatch) return null;
  let numStr = numericMatch[0];
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');
  if (lastComma > lastDot) {
    const afterComma = numStr.substring(lastComma + 1);
    if (afterComma.length <= 2) numStr = numStr.replace(/\./g, '').replace(',', '.');
    else numStr = numStr.replace(/,/g, '');
  } else {
    numStr = numStr.replace(/,/g, '');
  }
  const val = parseFloat(numStr);
  return isNaN(val) ? null : val * multiplier;
}

function guessItemName(selection) {
  try {
    function cleanText(txt) {
      let clean = txt.substring(0, 200).trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
      if (clean.length > 55) clean = clean.substring(0, 52) + '...';
      return clean;
    }
    const itemProp = document.querySelector('[itemprop="name"]');
    if (itemProp?.textContent) return cleanText(itemProp.textContent);
    if (selection?.anchorNode) {
      let current = selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentNode : selection.anchorNode;
      let fallbackText = '';
      try { fallbackText = (current.innerText || current.textContent || '').substring(0, 200); } catch (_) {}
      for (let i = 0; i < 5; i++) {
        if (!current || current === document.body) break;
        if (current.tagName?.match(/^H[1-6]$/)) {
          const txt = current.textContent.toLowerCase();
          if (!txt.includes('accessibility') && !txt.includes('skip to')) return cleanText(current.textContent);
        }
        const headings = current.querySelectorAll?.('h1, h2, h3, h4, h5, h6') || [];
        for (const h of headings) {
          const txt = h.textContent.toLowerCase();
          if (!txt.includes('accessibility') && !txt.includes('skip to')) return cleanText(h.textContent);
        }
        current = current.parentNode;
      }
      if (fallbackText && fallbackText.length > 5 && fallbackText.length < 150) return cleanText(fallbackText);
    }
    const ogTitle = document.querySelector('meta[property="og:title"]') || document.querySelector('meta[name="twitter:title"]');
    if (ogTitle?.content) return cleanText(ogTitle.content);
    if (document.title) return cleanText(document.title.split(/ - | \| | : | – | — /)[0]);
  } catch (_) {}
  return 'Unknown Context';
}

function detectBillingCycle(selection) {
  try {
    if (!selection || selection.rangeCount === 0) return null;
    const node = selection.anchorNode;
    if (!node) return null;
    const parent = node.parentElement;
    let textContext = '';
    if (parent) {
      const container = parent.parentElement?.parentElement || parent.parentElement || parent;
      textContext = (container.innerText || container.textContent || '').substring(0, 500);
    }
    textContext = textContext.toLowerCase().replace(/\s+/g, '');
    if (textContext.match(/\/(mo|month)|monthly|permonth|billedmonthly|شهري|فيالشهر/i)) return 'monthly';
    if (textContext.match(/\/(yr|year)|annually|yearly|peryear|billedannually|سنوي|فيالسنة/i)) return 'annually';
    if (textContext.match(/\/(wk|week)|weekly|perweek|أسبوعي|فيالأسبوع/i)) return 'weekly';
    if (textContext.match(/\/day|daily|perday|يومي|فياليوم/i)) return 'daily';
  } catch (_) {}
  return null;
}

function buildTextFragmentUrl(selection, selectedText) {
  const baseUrl = window.location.href.split('#')[0];
  const encodedText = encodeURIComponent(selectedText);
  try {
    if (!selection || selection.rangeCount === 0) return `${baseUrl}#:~:text=${encodedText}`;
    const range = selection.getRangeAt(0);
    let prefix = '';
    try {
      const prefixRange = document.createRange();
      const startContainer = range.startContainer;
      const startNode = startContainer.nodeType === 3 ? startContainer : startContainer.firstChild || startContainer;
      prefixRange.setStart(startNode, 0);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const rawPrefix = prefixRange.toString().trim();
      const prefixWords = rawPrefix.split(/\s+/).filter(Boolean);
      prefix = prefixWords.slice(-4).join(' ');
    } catch (_) {}
    let suffix = '';
    try {
      const suffixRange = document.createRange();
      const endContainer = range.endContainer;
      const endNode = endContainer.nodeType === 3 ? endContainer : endContainer.lastChild || endContainer;
      const endLength = endNode.nodeType === 3 ? endNode.textContent.length : 0;
      suffixRange.setStart(range.endContainer, range.endOffset);
      suffixRange.setEnd(endNode, endLength);
      const rawSuffix = suffixRange.toString().trim();
      const suffixWords = rawSuffix.split(/\s+/).filter(Boolean);
      suffix = suffixWords.slice(0, 4).join(' ');
    } catch (_) {}
    if (prefix || suffix) {
      const prefixPart = prefix ? `${encodeURIComponent(prefix)}-,` : '';
      const suffixPart = suffix ? `,-${encodeURIComponent(suffix)}` : '';
      return `${baseUrl}#:~:text=${prefixPart}${encodedText}${suffixPart}`;
    }
  } catch (_) {}
  return `${baseUrl}#:~:text=${encodedText}`;
}

// ---------------------------------------------------------------------------
// SVG Icon Builders (DOM-safe, no innerHTML)
// ---------------------------------------------------------------------------

function createSvgElement(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildCopyIcon() {
  const svg = createSvgElement('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
  svg.appendChild(createSvgElement('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }));
  svg.appendChild(createSvgElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }));
  return svg;
}

function buildCheckIcon() {
  const svg = createSvgElement('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: '#4caf50', 'stroke-width': '2' });
  svg.appendChild(createSvgElement('polyline', { points: '20 6 9 17 4 12' }));
  return svg;
}

function buildSaveIcon() {
  const svg = createSvgElement('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
  svg.appendChild(createSvgElement('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }));
  return svg;
}

// ---------------------------------------------------------------------------
// Mouse Selection Handler — Core On-Page Conversion Flow
// ---------------------------------------------------------------------------

document.addEventListener('mouseup', (e) => {
  if (!isEnabled) return;
  if (currentTooltip?.contains(e.target)) return;
  const selection = window.getSelection();
  const txt = selection.toString().trim();
  if (currentTooltip) removeTooltip();
  if (txt.length > 0 && txt.length < 30) {
    const val = parseAmount(txt);
    const detectedFrom = detectCurrency(txt);
    if (val !== null && val > 0 && detectedFrom !== null) {
      chrome.storage.sync.get(['selectedCurrencies'], (s) => {
        const userSavedList = s.selectedCurrencies?.length > 0 ? s.selectedCurrencies : [guessLocalCurrency()];
        const targets = (prefs.onPageMode === 'multi') ? userSavedList : [userSavedList[0]];
        const validTargets = targets.filter(t => t !== detectedFrom);
        if (validTargets.length === 0) return;
        const productName = guessItemName(selection);
        const pageDomain = window.location.hostname.replace('www.', '');
        const highlightUrl = buildTextFragmentUrl(selection, txt);
        const cycle = detectBillingCycle(selection);
        createTooltip(selection);
        const payloadBase = { amount: val, fromCurrency: detectedFrom, title: productName, domain: pageDomain, url: highlightUrl, billingCycle: cycle };
        if (currentTooltip) currentTooltip._convertlyContext = { ...payloadBase, targetCurrency: validTargets[0] };
        const messagePayload = prefs.onPageMode === 'multi'
          ? { action: 'convertMultiFromPage', ...payloadBase }
          : { action: 'convertFromPage', targetCurrency: validTargets[0], ...payloadBase };
        chrome.runtime.sendMessage(messagePayload, (res) => {
          if (chrome.runtime.lastError) { console.warn('Convertly:', chrome.runtime.lastError.message); updateError(); return; }
          if (prefs.onPageMode === 'multi') handleMultiResponse(res, detectedFrom);
          else { if (res?.success) render([{ currency: res.symbol, value: res.result }]); else updateError(); }
        });
      });
    }
  }
});

function handleMultiResponse(res, detectedFrom) {
  if (res?.success) {
    let data = Array.isArray(res.data) ? res.data : [{ currency: res.symbol || 'Target', value: res.result }];
    data = data.filter(item => item.currency !== detectedFrom);
    if (data.length === 0) { removeTooltip(); return; }
    chrome.storage.sync.get(['selectedCurrencies'], (s) => {
      const mainTarget = s.selectedCurrencies?.length > 0 ? s.selectedCurrencies[0] : guessLocalCurrency();
      data.sort((a, b) => (a.currency === mainTarget ? -1 : b.currency === mainTarget ? 1 : 0));
      render(data);
    });
  } else updateError();
}

document.addEventListener('mousedown', (e) => {
  if (currentTooltip && !currentTooltip.contains(e.target)) { removeTooltip(); window.getSelection().removeAllRanges(); }
});

// ---------------------------------------------------------------------------
// Tooltip UI — DOM-safe (no innerHTML)
// ---------------------------------------------------------------------------

function createTooltip(sel) {
  if (currentTooltip) removeTooltip();
  if (sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  currentTooltip = document.createElement('div');
  currentTooltip.className = 'currency-pro-tooltip';
  currentTooltip.setAttribute('data-theme', prefs.theme);
  currentTooltip.setAttribute('dir', prefs.lang === 'ar' ? 'rtl' : 'ltr');
  const loader = document.createElement('div');
  loader.className = 'cpt-loader';
  currentTooltip.appendChild(loader);
  currentTooltip.addEventListener('mousedown', (e) => e.stopPropagation());
  currentTooltip.addEventListener('mouseup', (e) => e.stopPropagation());
  document.body.appendChild(currentTooltip);
  let topPos = r.top + window.scrollY - 50;
  if (topPos < window.scrollY + 10) topPos = r.bottom + window.scrollY + 10;
  currentTooltip.style.top = topPos + 'px';
  currentTooltip.style.left = Math.max(10, r.left + window.scrollX + r.width / 2 - 90) + 'px';
}

function render(data) {
  if (!currentTooltip) return;
  while (currentTooltip.firstChild) currentTooltip.removeChild(currentTooltip.firstChild);
  const listDiv = document.createElement('div');
  listDiv.className = 'cpt-list';
  data.forEach(x => {
    const fmt = formatNum(x.value, x.currency);
    let displayCurr = x.currency;
    if (prefs.lang === 'ar' && CURRENCY_NAMES_AR[x.currency]) displayCurr = CURRENCY_NAMES_AR[x.currency];
    const row = document.createElement('div');
    row.className = 'cpt-row';
    const info = document.createElement('div');
    info.className = 'cpt-info';
    const amtSpan = document.createElement('span');
    amtSpan.className = 'cpt-amount';
    amtSpan.textContent = fmt;
    const currSpan = document.createElement('span');
    currSpan.className = 'cpt-curr';
    currSpan.textContent = displayCurr;
    info.appendChild(amtSpan);
    info.appendChild(document.createTextNode(' '));
    info.appendChild(currSpan);
    const actions = document.createElement('div');
    actions.className = 'cpt-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cpt-copy';
    copyBtn.title = 'Copy';
    copyBtn.dataset.val = fmt + ' ' + displayCurr;
    copyBtn.appendChild(buildCopyIcon());
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(copyBtn.dataset.val);
      while (copyBtn.firstChild) copyBtn.removeChild(copyBtn.firstChild);
      copyBtn.appendChild(buildCheckIcon());
      setTimeout(() => { while (copyBtn.firstChild) copyBtn.removeChild(copyBtn.firstChild); copyBtn.appendChild(buildCopyIcon()); }, 1000);
    };
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cpt-save';
    saveBtn.title = 'Save to History';
    saveBtn.appendChild(buildSaveIcon());
    saveBtn.onclick = () => {
      const ctx = currentTooltip._convertlyContext;
      if (!ctx) return;
      chrome.runtime.sendMessage({ action: 'saveToHistory', amount: ctx.amount, fromCurrency: ctx.fromCurrency, targetCurrency: ctx.targetCurrency, title: ctx.title, domain: ctx.domain, url: ctx.url, billingCycle: ctx.billingCycle }, (res) => {
        if (chrome.runtime.lastError) { console.warn('Convertly save error:', chrome.runtime.lastError.message); return; }
        while (saveBtn.firstChild) saveBtn.removeChild(saveBtn.firstChild);
        saveBtn.appendChild(buildCheckIcon());
        saveBtn.classList.add('cpt-save-success');
        setTimeout(() => { while (saveBtn.firstChild) saveBtn.removeChild(saveBtn.firstChild); saveBtn.appendChild(buildSaveIcon()); saveBtn.classList.remove('cpt-save-success'); }, 1000);
      });
    };
    actions.appendChild(copyBtn);
    actions.appendChild(saveBtn);
    row.appendChild(info);
    row.appendChild(actions);
    listDiv.appendChild(row);
  });
  currentTooltip.appendChild(listDiv);
}

function removeTooltip() {
  if (currentTooltip) { currentTooltip.remove(); currentTooltip = null; }
}

function updateError() {
  if (!currentTooltip) return;
  while (currentTooltip.firstChild) currentTooltip.removeChild(currentTooltip.firstChild);
  const errSpan = document.createElement('span');
  errSpan.style.cssText = 'color:#ef4444;font-size:13px;padding:8px 12px;display:block;font-weight:500;';
  errSpan.textContent = 'Unavailable';
  currentTooltip.appendChild(errSpan);
}
