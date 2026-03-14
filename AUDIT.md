# Convertly - Codebase Audit & Analysis Report

## 1. Architecture & Manifest V3 Compliance

*   **File/Location:** `background.js` (Lines 13-14, 118-139)
*   **The Issue/Flaw:** In-memory Cache Volatility in Service Worker.
*   **The 'Why' (Why is it bad?):** Manifest V3 service workers are ephemeral and will aggressively terminate to save memory after roughly 30 seconds of inactivity. The `ratesCache` object is defined purely in memory (`const ratesCache = {};`). Once the service worker goes to sleep, the cache is completely wiped, defeating the 30-minute caching rule and triggering redundant, slow API calls the next time the user converts.
*   **The Proposed Solution:** Implement a dual-layer caching strategy. Store the rates cache locally using `chrome.storage.local` alongside the in-memory fallback. On boot, repopulate the service worker memory from the persistent local storage.

## 2. Algorithmic Efficiency & Logic

*   **File/Location:** `content.js` (Lines 88-98: `parseAmount`)
*   **The Issue/Flaw:** Disregard for International Number Formats.
*   **The 'Why' (Why is it bad?):** The parser assumes US formatting by ruthlessly stripping all commas (`text.replace(/,/g, '')`). In many European and Arab regions (which the extension actively supports), the comma functions as the decimal separator (e.g., `1.250,50 €`). This strips it to `125050` or handles it randomly depending on trailing decimals, destroying calculation accuracy. 
*   **The Proposed Solution:** Design a locale-aware decimal detector that evaluates the position of periods and commas before sanitizing to an integer/float dynamically.

*   **File/Location:** `content.js` (Lines 100-155: `guessItemName` DOM Traversal)
*   **The Issue/Flaw:** Unbounded Text Traversal Blocking Main Thread.
*   **The 'Why' (Why is it bad?):** The function climbs up 5 hierarchy levels and pulls `.textContent`. If `current` nodes trace up to heavy containers (like the `body` or expansive grids), pulling and running string replacements (`/\s+/g`) on potentially megabytes of string data severely freezes the main browser thread.
*   **The Proposed Solution:** Restrict extraction strictly to semantic child nodes or cap string reading length prematurely. Better yet, target `innerText` conservatively to prevent capturing hidden DOM junk.

*   **File/Location:** `content.js` (Lines 210-240) & `background.js` (Lines 67-106)
*   **The Issue/Flaw:** State & Storage Over-Logging (History Spam).
*   **The 'Why' (Why is it bad?):** Highlighting any random text matching a currency on a web page inherently triggers `convertFromPage`, which sequentially executes `archiveAndSetState`. This forces the system to log every casual mouse selection into the user's History arrays. It fills the history with random integers and pollutes intended manual conversions.
*   **The Proposed Solution:** Sever the `archiveAndSetState` tie from raw highlight operations. Let highlight conversions populate tooltip UI independently.

## 3. API & Data Fetching

*   **File/Location:** `background.js` (Line 126)
*   **The Issue/Flaw:** Vulnerability to Unofficial Single Endpoint.
*   **The 'Why' (Why is it bad?):** The backbone resides on `query1.finance.yahoo.com`. This is an unauthenticated, non-public SDK endpoint. If Yahoo restricts CORS requests, changes the object layout, or throttles the extension due to high request velocity, the entire application breaks without alternative recourse.
*   **The Proposed Solution:** Abstract the fetching logic and establish an API Fallback pattern. Use Yahoo as the primary route, but smoothly catch any `HTTP 400/500` codes and failover to a stable community alternate (e.g., Frankfurter API or ExchangeRate-API free endpoints).

## 4. UI State & Storage Synchronization

*   **File/Location:** `background.js` (varies) and `popup.js` 
*   **The Issue/Flaw:** `chrome.storage.sync` Quota Exhaustion for Massive Payloads.
*   **The 'Why' (Why is it bad?):** `chrome.storage.sync` operates with brutally strict constraints per item (`QUOTA_BYTES_PER_ITEM` = 8KB) and maximum write constraints per minute (`MAX_WRITE_OPERATIONS_PER_MINUTE`). Stuffing the continuous `history` list—including URLs, page titles, mathematical calculations, and dates—directly into sync storage will instantly hit the 8KB limit, causing arrays to fail to save.
*   **The Proposed Solution:** Bifurcate storage mechanisms. Retain purely configuration metadata (`prefs`, `selectedCurrencies`) in `chrome.storage.sync` for cross-device convenience, while confining weighty arrays like `history` strictly to `chrome.storage.local` (5MB limits).
