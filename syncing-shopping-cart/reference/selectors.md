# Woolworths selectors reference

For repairing `scripts/cart-helper.js` when site UI changes.

## Contents
- DOM landmarks
- Shadow DOM structure
- Common selectors
- Diagnostic snippets

## DOM landmarks

Woolworths uses Web Components extensively. Most interactive elements live inside shadow DOM under custom tags.

| Custom element | Purpose |
| -------------- | ------- |
| `wc-product-tile` | Each search result card. Has shadow root containing title, image, add-to-cart host. |
| `wc-add-to-cart` | Nested inside product tile. Has its own shadow root with the actual button + qty stepper. |
| `wow-side-cart-container` | Side panel that slides in when "View cart" clicked. |
| `shared-header-adaptive` | Top nav with search + cart badge. |

## Shadow DOM structure

```
wc-product-tile (shadow)
├── [class*="title"] → product name
└── wc-add-to-cart (shadow)
    ├── .add-to-cart-btn → click to add (visible before added)
    ├── .quantity-btn.decrement-btn → minus
    ├── input[aria-label="Quantity"] → value
    └── .quantity-btn.increment-btn → plus (disabled at product cap)
```

## Common selectors

### Product tile (search results page)

| Need | Selector |
| ---- | -------- |
| Tile container | `wc-product-tile` (has shadow) |
| Product name (in tile shadow) | `[class*="title"]` |
| Add-to-cart wrapper (in tile shadow) | `wc-add-to-cart` (has shadow) |
| Add button (in atc shadow) | `.add-to-cart-btn` |
| Qty input (in atc shadow) | `input[aria-label="Quantity"]` |
| + button (in atc shadow) | `.increment-btn` |
| - button (in atc shadow) | `.decrement-btn` |
| OOS marker (in tile shadow text) | matches `/EST\.\s*RESTOCK\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i` or `/unavailable\|out of stock\|sold out/i` |

### Side cart panel

| Need | Selector |
| ---- | -------- |
| Side cart container (regular DOM) | `wow-side-cart-container` |
| Open-state indicator | `.mask.is-masked` inside container |
| Cart row (regular DOM) | `wow-cart-item` |
| Row remove button (text-only, no aria) | `.cart-item-remove-button` — text format: `Remove <product name> from trolley.` |
| Row qty input (regular DOM, NOT shadow) | `input.cartControls-quantityInput` |
| Row + button | `.cartControls-incrementButton` |
| Row - button | `.cartControls-decrementButton` |

### Header

| Need | Selector |
| ---- | -------- |
| View Cart button | `#header-view-cart-button` (preferred) or `button` with text "View cart" |
| Cart badge text format | matches `/(\d+)\s*items?\s*worth\s*\$?([\d.]+)/i` |

## Diagnostic snippets

If selectors break, run these via `browser_evaluate` to discover new ones.

### List custom elements on page
```js
[...new Set(Array.from(document.querySelectorAll('*'))
  .filter(el => el.tagName.includes('-'))
  .map(el => el.tagName.toLowerCase()))]
```

### Inspect first product tile shadow
```js
const t = document.querySelector('wc-product-tile');
const r = t.shadowRoot;
({
  title: r.querySelector('[class*="title"]')?.innerText?.slice(0, 80),
  buttons: Array.from(r.querySelectorAll('button')).map(b => b.className),
  customTags: [...new Set(Array.from(r.querySelectorAll('*')).filter(el => el.tagName.includes('-')).map(el => el.tagName.toLowerCase()))],
})
```

### Inspect add-to-cart shadow
```js
const atc = document.querySelector('wc-product-tile').shadowRoot.querySelector('wc-add-to-cart');
const ar = atc.shadowRoot;
({
  buttons: Array.from(ar.querySelectorAll('button')).map(b => ({class: b.className, text: b.innerText, aria: b.getAttribute('aria-label')})),
  inputs: Array.from(ar.querySelectorAll('input')).map(i => ({label: i.getAttribute('aria-label'), max: i.max, value: i.value})),
})
```

### Recursively walk all shadow roots, find any Quantity input
```js
const out = [];
(function rec(root, d=0) {
  if (!root || d > 8) return;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const inp = el.shadowRoot.querySelector('input[aria-label="Quantity"]');
      if (inp) out.push({host: el.tagName.toLowerCase(), val: inp.value, max: inp.max});
      rec(el.shadowRoot, d+1);
    }
  }
})(document);
out;
```

## Repair workflow

1. Open woolworths.com.au, navigate to a search results page.
2. Run the diagnostic snippets above via `browser_evaluate`.
3. Compare returned class names / aria-labels against the `SEL` object in `cart-helper.js`.
4. Edit `SEL` constants. Call sites in `__c.add`, `__c.setQty`, etc. stay unchanged.

## Stock detection

Out-of-stock tiles display one of:
- `EST. RESTOCK DD/MM/YY` (with future date)
- `Unavailable`
- `Out of stock` / `Sold out`

The qty stepper may still appear on OOS tiles, BUT clicks don't commit to the server cart. Detect via tile innerText scan; do NOT rely on stepper presence/absence.

Diagnostic for OOS:
```js
const t = document.querySelector('wc-product-tile');
const allText = Array.from(t.shadowRoot.querySelectorAll('*')).map(el => el.innerText).filter(Boolean).join(' ');
({oos: /EST\.\s*RESTOCK|unavailable|out of stock|sold out/i.test(allText), restock: allText.match(/EST\.\s*RESTOCK\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]})
```

## Side cart caveats

- **Async population:** clicking View Cart triggers Angular to fetch + render rows. Takes 1-3s typically. Poll `wow-cart-item` existence, not just panel open state.
- **Virtualization:** with many items (~10+), panel may only render visible rows. Scrolling triggers more. Workaround: trust `__c.cart()` badge for total count; `__c.list()` is best-effort visible names.
- **JS click works:** `document.getElementById('header-view-cart-button').click()` opens the panel reliably. No need for synthetic PointerEvents.
- **Toggle behavior:** clicking View Cart again closes the panel. Always check `isSideCartOpen()` before clicking.

## Browser lock recovery

If MCP errors with `Browser is already in use for /home/martin/.cache/ms-playwright/mcp-chrome-for-testing-XXX`:

```bash
pkill -f playwright-mcp 2>/dev/null
rm -f /home/martin/.cache/ms-playwright/mcp-chrome-for-testing-*/Singleton{Lock,Cookie,Socket}
```

Then retry the navigate. The MCP server respawns on next tool call.
