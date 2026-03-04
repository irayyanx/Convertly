let currentTooltip = null;
let prefs = { decimalDigits: 2, onPageMode: 'single', theme: 'dark', lang: 'en' }; 
let isEnabled = false;

const CURRENCY_NAMES_AR = {
  'USD': 'دولار أمريكي', 'EUR': 'يورو', 'GBP': 'جنيه إسترليني', 'EGP': 'جنيه مصري',
  'SAR': 'ريال سعودي', 'AED': 'درهم إماراتي', 'KWD': 'دينار كويتي', 'QAR': 'ريال قطري',
  'JOD': 'دينار أردني', 'PAL': 'دينار أردني',
  'LBP': 'ليرة لبنانية', 'MAD': 'درهم مغربي',
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

const SYMBOL_MAP = {
    '$': 'USD', 'USD': 'USD', 'US DOLLAR': 'USD',
    '€': 'EUR', 'EUR': 'EUR', 'EURO': 'EUR',
    '£': 'GBP', 'GBP': 'GBP',
    '¥': 'JPY', 'JPY': 'JPY', 'CN¥': 'CNY',
    'ج.م': 'EGP', 'EGP': 'EGP', 'LE': 'EGP',
    'SAR': 'SAR', 'ر.س': 'SAR', 'SR': 'SAR',
    'AED': 'AED', 'د.إ': 'AED', 'DHS': 'AED',
    'KWD': 'KWD', 'د.ك': 'KWD',
    'QAR': 'QAR', 'ر.ق': 'QAR',
    'JOD': 'JOD', 'د.أ': 'JOD', 'JD': 'JOD',
    '₹': 'INR', 'INR': 'INR', 'RS': 'INR',
    '₽': 'RUB', 'RUB': 'RUB',
    '₺': 'TRY', 'TRY': 'TRY', 'TL': 'TRY',
    '₩': 'KRW', 'KRW': 'KRW',
    'C$': 'CAD', 'CAD': 'CAD',
    'A$': 'AUD', 'AUD': 'AUD',
    'R$': 'BRL', 'BRL': 'BRL',
    'BTC': 'BTC', 'ETH': 'ETH',
    '₦': 'NGN', 'NGN': 'NGN'
};

chrome.storage.sync.get(['prefs', 'onPageEnabled', 'theme'], (res) => {
    if(res.prefs) prefs = { ...prefs, ...res.prefs };
    isEnabled = res.onPageEnabled || false;
});

chrome.storage.onChanged.addListener((ch) => {
    if(ch.prefs) prefs = { ...prefs, ...ch.prefs.newValue };
    if(ch.onPageEnabled) isEnabled = ch.onPageEnabled.newValue;
});

function formatNum(num) {
    const digits = parseInt(prefs.decimalDigits);
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(num);
}

function detectCurrency(text) {
    const upper = text.toUpperCase();

    // 1) Symbol currencies (safe)
    const symbolMatches = [
        ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'],
        ['₺', 'TRY'], ['₽', 'RUB'], ['₹', 'INR'], ['₩', 'KRW'], ['₦', 'NGN']
    ];
    for (const [sym, code] of symbolMatches) {
        if (upper.includes(sym)) return code;
    }

    // 2) Arabic abbreviations
    const arabicTokens = [
        ['ج.م', 'EGP'], ['ر.س', 'SAR'], ['د.إ', 'AED'], ['د.ك', 'KWD'],
        ['ر.ق', 'QAR'], ['د.أ', 'JOD']
    ];
    for (const [tok, code] of arabicTokens) {
        if (upper.includes(tok.toUpperCase())) return code;
    }

    // Helper: token as standalone word (not inside other words)
    const hasWordToken = (token) => {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'i');
        return re.test(upper);
    };

    // 3) ISO codes
    const isoCodes = [
        'USD','EUR','GBP','EGP','SAR','AED','KWD','QAR','JOD','ILS','JPY',
        'CAD','AUD','CHF','CNY','RUB','INR','KRW','SGD','MXN','BRL','ZAR',
        'IDR','MYR','PHP','THB','VND','PKR','BDT','NGN','HKD','NZD','SEK','NOK',
        'BTC','ETH','ADA','SOL','XRP','BHD','OMR','MAD','TND','DZD','IQD','LYD','YER','TRY'
    ];
    for (const code of isoCodes) {
        if (hasWordToken(code)) return code;
    }

    // 4) Short Latin abbreviations (standalone only)
    const shortTokens = [
        ['LE', 'EGP'], ['TL', 'TRY'], ['SR', 'SAR'], ['JD', 'JOD'], ['RS', 'INR'], ['DHS', 'AED']
    ];
    for (const [tok, code] of shortTokens) {
        if (hasWordToken(tok)) return code;
    }

    return null;
}

function parseAmount(text) {
    const detected = detectCurrency(text);
    if (!detected) return null;

    let clean = text.replace(/,/g, '').trim().toUpperCase();
    let multiplier = 1;

    if (clean.endsWith('K')) multiplier = 1000;
    else if (clean.endsWith('M')) multiplier = 1000000;
    else if (clean.endsWith('B')) multiplier = 1000000000;

    clean = clean.replace(/[KMB]/g, '');
    clean = clean.replace(/[^0-9.]/g, '');

    const val = parseFloat(clean);
    if (isNaN(val)) return null;
    return val * multiplier;
}

document.addEventListener('mouseup', (e) => {
    if(!isEnabled) return;
    if(currentTooltip && currentTooltip.contains(e.target)) return;
    const txt = window.getSelection().toString().trim();
    if(currentTooltip) removeTooltip(); 
    
    if(txt.length > 0 && txt.length < 30) {
        const val = parseAmount(txt);
        const detectedFrom = detectCurrency(txt);

        if(val !== null && val > 0 && detectedFrom !== null) {
            
            chrome.storage.sync.get(['targetCurrency', 'selectedCurrencies'], (s) => {
                // تحديد قائمة العملات المستهدفة بناءً على الوضع
                let targets = [];
                if (prefs.onPageMode === 'multi') {
                    targets = s.selectedCurrencies || ['EGP'];
                } else {
                    targets = [s.targetCurrency || 'EGP'];
                }

                // --- التعديل الجوهري هنا ---
                // فلترة القائمة: نحذف العملة اللي هي نفسها عملة المصدر
                // مثلا: لو انا بحدد EGP والقائمة فيها [USD, EGP] -> هتبقى [USD]
                // لو انا بحدد EGP والقائمة فيها [EGP] بس -> هتبقى [] (فارغة)
                const validTargets = targets.filter(t => t !== detectedFrom);

                // لو مفيش ولا عملة متبقية مختلفة عن المصدر، نوقف الكود فوراً ومظهرش حاجة
                if (validTargets.length === 0) return;

                // لو عدينا، نظهر الـ Tooltip ونكمل
                createTooltip(window.getSelection());
                
                if (prefs.onPageMode === 'multi') {
                    // هنبعت request للكل عادي، وهنفلتر النتيجة في العرض تحت
                    chrome.runtime.sendMessage({ action: 'convertMulti', amount: val, fromCurrency: detectedFrom }, (res) => handleResponse(res, detectedFrom));
                } else {
                    chrome.runtime.sendMessage({ 
                        action: 'convert', 
                        amount: val, 
                        fromCurrency: detectedFrom, 
                        targetCurrency: validTargets[0], // نستخدم العملة الصالحة
                        saveState: true 
                    }, (res) => {
                        if(res && res.success) render([{ currency: res.symbol, value: res.result }]);
                        else updateError();
                    });
                }
            });
        }
    }
});

// استقبلنا detectedFrom هنا عشان نفلتر تاني للتأكيد
function handleResponse(res, detectedFrom) {
    if(res && res.success) {
       let data = Array.isArray(res.data) ? res.data : [{ currency: res.symbol || 'Target', value: res.result }];
       
       // فلترة النتائج: شيل أي نتيجة عملتها هي نفس عملة المصدر
       // عشان لو القائمة كانت [USD, EGP] والمصدر EGP، النتيجة متظهرش سطر فيه EGP -> EGP
       data = data.filter(item => item.currency !== detectedFrom);

       if (data.length === 0) {
           removeTooltip(); // لو بعد الفلترة مفيش حاجة، شيل التولتيب
           return;
       }

       chrome.storage.sync.get(['targetCurrency'], (s) => {
           const mainTarget = s.targetCurrency || 'EGP';
           data.sort((a, b) => {
               if(a.currency === mainTarget) return -1;
               if(b.currency === mainTarget) return 1;
               return 0;
           });
           render(data);
       });
    } else updateError();
}

document.addEventListener('mousedown', (e) => { 
    if(currentTooltip && !currentTooltip.contains(e.target)) {
        removeTooltip();
        window.getSelection().removeAllRanges();
    }
});

function createTooltip(sel) {
    if(currentTooltip) removeTooltip();
    if(sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    
    currentTooltip = document.createElement('div');
    currentTooltip.className = 'currency-pro-tooltip';
    currentTooltip.setAttribute('data-theme', prefs.theme);
    currentTooltip.innerHTML = '<div class="cpt-loader"></div>';
    
    currentTooltip.addEventListener('mousedown', (e) => e.stopPropagation());
    currentTooltip.addEventListener('mouseup', (e) => e.stopPropagation());
    
    document.body.appendChild(currentTooltip);
    currentTooltip.style.top = (r.top + window.scrollY - 50) + 'px';
    currentTooltip.style.left = (r.left + window.scrollX + r.width/2 - 90) + 'px';
}

function render(data) {
    if(!currentTooltip) return;
    let h = '<div class="cpt-list">';
    data.forEach(x => {
        const fmt = formatNum(x.value);
        let displayCurr = x.currency;
        if(prefs.lang === 'ar' && CURRENCY_NAMES_AR[x.currency]) {
            displayCurr = CURRENCY_NAMES_AR[x.currency];
        }
        
        h += `<div class="cpt-row"><div class="cpt-info"><span class="cpt-amount">${fmt}</span> <span class="cpt-curr">${displayCurr}</span></div> <button class="cpt-copy" data-val="${fmt} ${displayCurr}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>`;
    });
    h += '</div>';
    currentTooltip.innerHTML = h;
    currentTooltip.querySelectorAll('button').forEach(b => b.onclick = (e) => {
        navigator.clipboard.writeText(b.dataset.val);
        b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'; 
        setTimeout(()=>b.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', 1000);
    });
}
function removeTooltip() { 
    if(currentTooltip) {
        currentTooltip.remove(); 
        currentTooltip=null;
    } 
}

function updateError() { if(currentTooltip) currentTooltip.innerHTML='<span style="color:red;font-size:12px;padding:5px">Error</span>'; }
