// Woolworths cart helper. Injects window.__c with deterministic add/setQty/list/cart APIs.
// Read this file's contents and pass as the `function` argument to mcp__playwright__browser_evaluate.
// All selectors and regex patterns are isolated in SEL/RX; if the site UI changes, edit those only.

(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // --- Selectors (edit here if Woolworths UI changes) ---
  const SEL = {
    tile: 'wc-product-tile',
    title: '[class*="title"]',
    addToCartHost: 'wc-add-to-cart',
    addBtn: '.add-to-cart-btn',
    qtyInput: 'input[aria-label="Quantity"]',
    incBtn: '.increment-btn',
    decBtn: '.decrement-btn',
    // Price element (preferred over text-scan to avoid grabbing "save $X" amounts)
    priceEl: '.label-price-promotion, [class*="price-display"], [class*="price-value"], shared-price',
    sideCartContainer: 'wow-side-cart-container, [class*="side-cart"]',
    sideCartItem: 'wow-cart-item, [class*="cart-item-row"], [class*="trolley-row"]',
    sideCartMaskOpen: '.mask.is-masked, .mask.open, [class*="open"]',
    // Remove button: class first, then any button with "remove" text or trash icon
    sideCartRemove: '.cart-item-remove-button, button[class*="remove"], button[class*="delete"]',
    sideCartQtyInput: 'input.cartControls-quantityInput, input[aria-label="Quantity"]',
    sideCartIncBtn: '.cartControls-incrementButton, button[class*="increment"], button[aria-label*="increase" i]',
    sideCartDecBtn: '.cartControls-decrementButton, button[class*="decrement"], button[aria-label*="decrease" i]',
    viewCartBtnId: 'header-view-cart-button',
  };

  // --- Regex patterns (edit here for copy/locale changes) ---
  const RX = {
    // Cart badge: "19 items worth $60.76" — tolerant of plurals, optional currency, decimal/comma separators
    cartBadge: [
      /(\d+)\s*items?\s*worth\s*\$?\s*([\d.,]+)/i,
      /cart\s*(?:has)?\s*(\d+)\s*items?[^$]*\$?\s*([\d.,]+)/i,
    ],
    // Out-of-stock signals
    restock: /(?:EST\.?\s*RESTOCK|back\s+(?:in\s+stock|on)|restocking)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    oosText: /unavailable|out\s*of\s*stock|sold\s*out|currently\s*unavailable/i,
    // Price (skip "save $X", "saving $X", "off $X" preceding context)
    price: /(?<!save\s)(?<!saving\s)(?<!off\s)\$\s*(\d+(?:[.,]\d{2})?)/i,
    // Pack size — extended vocabulary: "2 pack", "5pk", "twin pack", "x4", "× 6", "bundle of 3"
    pack: /(\d+)\s*(?:pack|pk|x|×)\b|\bx\s*(\d+)\b|\bbundle\s*(?:of)?\s*(\d+)\b|\b(twin)\s*pack\b/i,
    // Side cart row name extraction (handles "Remove X from trolley." OR "Remove X from cart")
    sideCartName: /^Remove\s+(.+?)\s+from\s+(?:trolley|cart)\.?$/i,
    // Size hint
    sizeRange: /(\d+)\s*-\s*(\d+)\s*g/i,
    sizeSingle: /(\d+)\s*g/i,
    grams: /(\d{2,4})\s*g/i,
  };

  // --- Helpers ---
  const PACK_WORDS = { twin: 2, double: 2, triple: 3, quad: 4 };

  function packSize(name) {
    const m = name.match(RX.pack);
    if (!m) return 1;
    return +(m[1] || m[2] || m[3]) || PACK_WORDS[m[4]?.toLowerCase()] || 1;
  }

  // Recursive shadow DOM walker — finds element across arbitrary shadow boundary depth
  function findInShadow(root, selector, maxDepth = 8) {
    if (!root || maxDepth <= 0) return null;
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) {
        const found = findInShadow(host.shadowRoot, selector, maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  // Walk all shadow roots, collect matching elements (for qty inputs that may exist in multiple tiles)
  function findAllInShadow(root, selector, maxDepth = 8) {
    if (!root || maxDepth <= 0) return [];
    const results = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) {
        results.push(...findAllInShadow(host.shadowRoot, selector, maxDepth - 1));
      }
    }
    return results;
  }

  function matchSize(name, hint) {
    if (!hint) return true;
    const range = hint.match(RX.sizeRange);
    const single = hint.match(RX.sizeSingle);
    const got = name.match(RX.grams);
    if (!got) return false;
    const g = +got[1];
    if (range) return g >= +range[1] && g <= +range[2];
    if (single) return Math.abs(g - +single[1]) <= 50;
    return true;
  }

  // Extract price: prefer dedicated price element, fall back to text scan with anti-"save" lookbehind
  function extractPrice(rootEl) {
    const priceEl = rootEl.querySelector(SEL.priceEl);
    if (priceEl) {
      const m = priceEl.innerText?.match(/\$?\s*(\d+(?:[.,]\d{2})?)/);
      if (m) return +m[1].replace(',', '.');
    }
    const allText = Array.from(rootEl.querySelectorAll('*')).map(el => el.innerText).filter(Boolean).join(' ');
    const m = allText.match(RX.price);
    return m ? +m[1].replace(',', '.') : null;
  }

  // OOS multi-signal: text + structural (no add btn, no price) + commit-failure flag
  function detectOOS(rootEl, addBtn, qty, price) {
    const allText = Array.from(rootEl.querySelectorAll('*')).map(el => el.innerText).filter(Boolean).join(' ');
    const restockMatch = allText.match(RX.restock);
    const textOOS = !!restockMatch || RX.oosText.test(allText);
    const structuralOOS = !addBtn && !qty;  // no way to add or stepper
    const noPriceOOS = price === null && !addBtn;  // priced items always show price
    return {
      outOfStock: textOOS || structuralOOS || noPriceOOS,
      restockDate: restockMatch?.[1] || null,
      signal: textOOS ? 'text' : structuralOOS ? 'no-buttons' : noPriceOOS ? 'no-price' : null,
    };
  }

  // Cart badge: try multiple regex variants, fall back to summing side cart rows
  function readCartBadge() {
    const txt = document.body.innerText;
    for (const rx of RX.cartBadge) {
      const m = txt.match(rx);
      if (m) return { items: +m[1], total: +m[2].replace(',', '.'), source: 'badge' };
    }
    // Fallback: sum side cart row qtys
    const rows = sideItems();
    if (rows.length) {
      const items = rows.reduce((sum, r) => sum + (r.qty || 0), 0);
      return { items, total: null, source: 'sideCartSum', note: 'cart badge regex failed' };
    }
    return null;
  }

  // --- Tile reader ---
  function tiles() {
    return Array.from(document.querySelectorAll(SEL.tile)).map(t => {
      const r = t.shadowRoot;
      if (!r) return null;
      const name = r.querySelector(SEL.title)?.innerText?.split('\n')[0] || '';
      // Use recursive walker for add-to-cart host — handles arbitrary nesting depth
      const atc = findInShadow(r, SEL.addToCartHost);
      const ar = atc?.shadowRoot;
      const addBtn = ar ? findInShadow(ar, SEL.addBtn) : null;
      const qty = ar ? findInShadow(ar, SEL.qtyInput) : null;
      const price = extractPrice(r);
      const oosInfo = detectOOS(r, addBtn, qty, price);
      return {
        name,
        addBtn,
        qty,
        inc: ar ? findInShadow(ar, SEL.incBtn) : null,
        dec: ar ? findInShadow(ar, SEL.decBtn) : null,
        outOfStock: oosInfo.outOfStock,
        restockDate: oosInfo.restockDate,
        oosSignal: oosInfo.signal,
        price,
      };
    }).filter(Boolean);
  }

  // --- Side cart reader ---
  function sideCartName(rm) {
    if (!rm) return '?';
    const txt = rm.innerText?.trim() || rm.getAttribute('aria-label')?.trim() || '';
    const m = txt.match(RX.sideCartName);
    return m?.[1] || txt.replace(/^Remove\s+/i, '').trim() || '?';
  }

  function sideItems() {
    const sc = document.querySelector(SEL.sideCartContainer);
    if (!sc) return [];
    const rows = Array.from(sc.querySelectorAll(SEL.sideCartItem));
    return rows.map(row => {
      const rm = row.querySelector(SEL.sideCartRemove);
      const inp = row.querySelector(SEL.sideCartQtyInput);
      return { name: sideCartName(rm), qty: inp ? +inp.value : null };
    });
  }

  function findSideCartRow(termRegex) {
    const sc = document.querySelector(SEL.sideCartContainer);
    if (!sc) return null;
    const rows = Array.from(sc.querySelectorAll(SEL.sideCartItem));
    return rows.find(row => {
      const rm = row.querySelector(SEL.sideCartRemove);
      return termRegex.test(sideCartName(rm));
    }) || null;
  }

  async function setSideCartQty(row, target) {
    for (let i = 0; i < 50; i++) {
      const inp = row.querySelector(SEL.sideCartQtyInput);
      if (!inp) return null;
      const v = +inp.value;
      if (v === target) return v;
      const btn = v < target
        ? row.querySelector(SEL.sideCartIncBtn)
        : row.querySelector(SEL.sideCartDecBtn);
      if (!btn || btn.disabled) return v;
      btn.click();
      await sleep(600);
    }
    return +row.querySelector(SEL.sideCartQtyInput).value;
  }

  function isSideCartOpen() {
    const sc = document.querySelector(SEL.sideCartContainer);
    return !!sc?.querySelector(SEL.sideCartMaskOpen);
  }

  async function setStepperQty(t, target) {
    for (let i = 0; i < 50; i++) {
      const v = +t.qty.value;
      if (v === target) return v;
      const btn = v < target ? t.inc : t.dec;
      if (!btn || btn.disabled) return v;
      btn.click();
      await sleep(600);
    }
    return +t.qty.value;
  }

  // --- Public API ---
  window.__c = {
    add: async ({ term, qty = 1, packAware = true, sizeHint, allowOOS = false, autoSubstitute = true }) => {
      const re = new RegExp(term, 'i');
      const all = tiles().filter(t => re.test(t.name) && matchSize(t.name, sizeHint));
      if (!all.length) {
        return { error: 'no match', candidates: tiles().map(t => ({ name: t.name, price: t.price })).slice(0, 8) };
      }
      const inStock = all.filter(t => !t.outOfStock);
      if (!inStock.length && !allowOOS) {
        if (autoSubstitute) {
          const subPool = tiles()
            .filter(t => !t.outOfStock && (t.addBtn || t.qty) && matchSize(t.name, sizeHint) && t.price !== null)
            .sort((a, b) => a.price - b.price);
          if (subPool.length) {
            const sub = subPool[0];
            const result = await window.__c.add({
              term: sub.name.replace(/[^a-z0-9 ]/gi, '').slice(0, 40),
              qty, packAware, sizeHint, allowOOS: false, autoSubstitute: false,
            });
            return { ...result, substituted: true, original: all[0].name, originalRestock: all[0].restockDate, sub: sub.name, subPrice: sub.price };
          }
        }
        return {
          error: 'out of stock',
          name: all[0].name,
          restockDate: all[0].restockDate,
          oosSignal: all[0].oosSignal,
          candidates: tiles().filter(t => !t.outOfStock && (t.addBtn || t.qty)).map(t => ({ name: t.name, price: t.price })).slice(0, 8),
        };
      }
      const t = (allowOOS ? all : inStock).find(t => t.addBtn || t.qty);
      if (!t) return { error: 'no actionable tile (no add btn or stepper)', candidates: all.map(x => x.name) };
      const pack = packAware ? packSize(t.name) : 1;
      let cartQty = qty, warn;
      if (pack > 1) {
        if (qty % pack !== 0) warn = `uneven: list=${qty} pack=${pack}`;
        cartQty = Math.max(1, Math.round(qty / pack));
      }
      const before = readCartBadge();
      if (t.qty) {
        await setStepperQty(t, cartQty);
      } else {
        t.addBtn.click();
        await sleep(900);
        if (cartQty > 1) {
          const t2 = tiles().find(x => re.test(x.name) && x.qty);
          if (t2) await setStepperQty(t2, cartQty);
        }
      }
      await sleep(800);
      const after = readCartBadge();
      const cartChanged = before && after && before.items !== after.items;
      const final = tiles().find(x => re.test(x.name) && x.qty);
      return {
        added: t.name,
        qty: final ? +final.qty.value : cartQty,
        pack,
        cartBefore: before?.items ?? null,
        cartAfter: after?.items ?? null,
        committed: cartChanged || (t.qty && !t.addBtn && before?.items === after?.items),
        outOfStock: t.outOfStock,
        ...(warn && { warn }),
      };
    },

    setQty: async ({ term, qty }) => {
      const re = new RegExp(term, 'i');
      const row = findSideCartRow(re);
      if (row) {
        const final = await setSideCartQty(row, qty);
        return { name: sideCartName(row.querySelector(SEL.sideCartRemove)), qty: final, source: 'sideCart' };
      }
      const t = tiles().find(x => re.test(x.name) && x.qty);
      if (!t) return { error: 'no row in side cart and no tile on current page' };
      return { name: t.name, qty: await setStepperQty(t, qty), source: 'tile' };
    },

    remove: async ({ term }) => {
      const re = new RegExp(term, 'i');
      const row = findSideCartRow(re);
      if (!row) return { error: 'not in side cart' };
      const rm = row.querySelector(SEL.sideCartRemove);
      if (!rm) return { error: 'no remove btn' };
      const name = sideCartName(rm);
      rm.click();
      await sleep(800);
      return { removed: name };
    },

    openCart: async () => {
      if (isSideCartOpen()) return { opened: true, alreadyOpen: true };
      const b = document.getElementById(SEL.viewCartBtnId)
        || Array.from(document.querySelectorAll('button')).find(x => /view\s*cart|view\s*trolley/i.test(x.innerText || ''));
      if (!b) return { error: 'view cart button not found' };
      b.click();
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        if (isSideCartOpen() && document.querySelector(SEL.sideCartItem)) {
          return { opened: true, waitedMs: (i + 1) * 250 };
        }
      }
      return { opened: isSideCartOpen(), populated: false, note: 'panel did not populate within 10s' };
    },

    closeCart: async () => {
      if (!isSideCartOpen()) return { closed: true };
      const b = document.getElementById(SEL.viewCartBtnId);
      if (b) b.click();
      await sleep(500);
      return { closed: !isSideCartOpen() };
    },

    list: () => sideItems(),
    cart: () => readCartBadge(),

    cheapest: ({ sizeHint, limit = 5 } = {}) => {
      return tiles()
        .filter(t => !t.outOfStock && (t.addBtn || t.qty) && matchSize(t.name, sizeHint) && t.price !== null)
        .sort((a, b) => a.price - b.price)
        .slice(0, limit)
        .map(t => ({ name: t.name, price: t.price }));
    },

    // Diagnostic: dump current tiles with all extracted fields. Use for debugging selector breakage.
    debug: () => tiles().map(t => ({ name: t.name, price: t.price, oos: t.outOfStock, signal: t.oosSignal, hasAdd: !!t.addBtn, hasQty: !!t.qty, qty: t.qty?.value })),

    injected: true,
  };

  return 'cart helper ready';
})();
