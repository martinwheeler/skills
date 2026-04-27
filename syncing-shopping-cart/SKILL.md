---
name: syncing-shopping-cart
description: Syncs a markdown shopping list to a Woolworths online cart using Playwright MCP. Use when the user asks to add a shopping list to their Woolworths cart, sync groceries, do an online grocery shop, or mentions woolworths.com.au with a list note. Token-tight: injects a helper once per page, then per-item calls are one-liners.
---

# Syncing shopping cart (Woolworths)

Sync a markdown shopping list note to woolworths.com.au cart so cart line items match the list 1:1.

## Prerequisites

- Playwright MCP server installed at user scope with chromium browser
- A markdown list note formatted as `| Item | Quantity |` (defaults to `~/Documents/shared-brain/Shopping List Staples.md`)

## Workflow

Copy this checklist and check items off as completed:

```
- [ ] Step 1: Read shopping list note
- [ ] Step 2: Open woolworths.com.au, inject cart-helper.js, snapshot existing cart
- [ ] Step 3: For each list row: navigate to search URL, RE-INJECT helper, call __c.add(...)
- [ ] Step 4: Handle out-of-stock items — ask user for substitute / skip / wait
- [ ] Step 5: Remove or reduce extras not on list
- [ ] Step 6: Verify cart matches list, report total
```

### Step 1: Read shopping list

Read `~/Documents/shared-brain/Shopping List Staples.md` (or user-specified note). Parse the markdown table — each row = `Item | Quantity`. Quantity = total individual items (NOT packs). Helper auto-divides by pack size when detected.

### Step 2: Inject helper + snapshot cart

Navigate to `https://www.woolworths.com.au`. Read `scripts/cart-helper.js` from this skill and pass its contents to `mcp__playwright__browser_evaluate`. The helper attaches to `window.__c`.

Then call `await __c.openCart()` followed by `__c.list()` to snapshot existing cart. **Caveat:** side cart panel may virtualize — first `list()` can return only the first ~10 of N items. Trust `__c.cart()` for the authoritative item count, use `list()` for visible names.

### Step 3: Add each item

CRITICAL: `window.__c` is wiped on every page navigation. Re-inject the helper after EVERY `browser_navigate` call. Do this in the same `browser_evaluate` call as the action — see the "Per-item call template" below.

Per-item flow:
1. `browser_navigate` to `https://www.woolworths.com.au/shop/search/products?searchTerm=<urlencoded item>`
2. `browser_wait_for` 2 seconds
3. `browser_evaluate` with helper inject + `await __c.add({term, qty, sizeHint?})` in one call

### Step 4: Handle out of stock (auto-substitute)

`__c.add` defaults to `autoSubstitute: true`. On OOS, it auto-picks the cheapest in-stock alternative from current search results matching `sizeHint`, adds THAT, and returns:

```js
{added, qty, substituted: true, original, originalRestock, sub, subPrice, cartBefore, cartAfter, committed}
```

**Default behavior — automatic substitution:**

1. Per-item loop: call `__c.add({term, qty, sizeHint})`.
2. If `result.substituted === true`, log `original → sub @ $X.XX` to a local `substitutionsLog`. Continue.
3. If `result.error === 'out of stock'` (no in-stock candidates on current search page), broaden search: navigate to a more generic term (e.g. "boring barista oat" → "oat milk 1l"), re-inject helper, call `__c.cheapest({sizeHint, limit: 3})` to see top in-stock options, then `__c.add({term: <cheapest name>, qty, sizeHint})`.
4. If still no match after broadening, push to `unresolvedOOS`.

**Track all substitutions in `substitutionsLog`** — Step 6 verify will display them prominently in the final report so user knows what they're actually buying. Required fields per entry: `original`, `originalRestock`, `sub`, `subPrice`. Do NOT silent-skip; always surface.

**At end of sync, report:**
- Substitutions made: `original → sub @ $X.XX (restock DD/MM/YY)` — ALWAYS shown to user
- Unresolved OOS: `original (restock DD/MM/YY) — no in-stock alternative found`

**Brand-loyalty heuristic:** if a list row has a brand-specific proper noun ("Bonsoy", "Boring Barista", "Sacla"), CONSIDER asking before auto-subbing. Generic items ("oat milk", "beef mince") = safe to auto-sub silently.

**Override flags (user opts):**
- "ask me before substituting" → call `__c.add({autoSubstitute: false, ...})`. Present `candidates` (with prices), ask user to pick.
- "skip OOS, no substitutions" → call `__c.add({autoSubstitute: false, ...})`. On OOS, log + skip.
- "force-add OOS anyway" → `allowOOS: true` (creates pending cart item, likely won't commit; warn user).

### Step 5: Remove extras

Items in cart but NOT on list, or with cart qty > list qty. Two paths:

- **Side cart open:** `await __c.setQty({term, qty: <newQty>})` works directly on the side cart row. Pass `qty: 0` to trigger removal via decrement (helper clamps; if it doesn't reach 0, fall back to `__c.remove({term})`).
- **Side cart closed:** navigate to product search, re-inject, call `__c.setQty(...)` on the tile.

### Step 6: Verify and report

`await __c.openCart()` then `__c.list()` for line items, plus `__c.cart()` for total. Compare against the list.

**Final report MUST include (in this order, prominently):**

1. **Substitutions** — always show, even if user didn't ask. Format:

   ```
   Substituted 2 items (cheapest in-stock alternative picked):
   - Boring Barista Oat Long Life Milk UHT 1L → Inside Out Oat Milk 1L @ $4.50 (original OOS, restock 27/04/26)
   - Bonsoy Soy Long Life Milk UHT 1L → Vitasoy Soy Milk 1L @ $3.20 (original OOS, restock 30/04/26)
   ```

   If zero substitutions: "No substitutions needed — all items in stock."

2. **Unresolved OOS** (couldn't sub): list with restock dates, mark as skipped.
3. **Cart total**: `$X.XX, N items`.
4. **Mismatches** (cart items not on list, qty differences): bullet list.
5. **Skipped items** (no match, user-skipped): bullet list.

**Why always-show substitutions:** user must know what they're actually buying. Silent substitution is a footgun even when "cheapest" heuristic is correct (different brand, different ingredients, allergy risk).

## Per-item call template

Use this exact pattern for each list row. Re-injects helper, performs add, returns compact JSON.

```js
async () => {
  if (!window.__c?.injected) {
    // Paste the full contents of scripts/cart-helper.js here as IIFE
    // (helper sets window.__c = {...injected: true})
  }
  return await __c.add({term: '<regex>', qty: <n>, sizeHint: '<optional>'});
}
```

In practice: read `scripts/cart-helper.js` once at session start; in each `browser_evaluate`, prepend the helper IIFE then call `__c.<method>`.

## __c API summary

| Call | Returns |
| ---- | ------- |
| `__c.add({term, qty, packAware?, sizeHint?, allowOOS?, autoSubstitute?})` | success: `{added, qty, pack, cartBefore, cartAfter, committed, substituted?, original?, sub?, subPrice?, warn?}`. failure: `{error: 'no match'\|'out of stock', candidates: [{name, price}]}` |
| `__c.cheapest({sizeHint?, limit?})` | `[{name, price}]` — in-stock tiles on current page sorted by price ascending |
| `__c.setQty({term, qty})` | `{name, qty, source: 'sideCart'\|'tile'}` or `{error}` |
| `__c.remove({term})` | `{removed: name}` or `{error}` |
| `__c.openCart()` | `{opened: true, waitedMs?}` — polls up to 10s for items to render |
| `__c.closeCart()` | `{closed: true}` |
| `__c.list()` | `[{name, qty}]` from side cart rows (visible only — may be truncated if virtualized) |
| `__c.cart()` | `{items, total}` from header badge — authoritative for total count |
| `__c.injected` | `true` if helper present (use to detect re-injection need) |

## Constraints (token discipline)

- Do NOT call `mcp__playwright__browser_snapshot` — page snapshots are huge. Use targeted `browser_evaluate` queries.
- Do NOT redefine shadow-DOM walkers or selectors inline — always use `__c.*` from the helper.
- Do NOT create one TaskCreate per row unless list has more than 8 rows.
- Helper IIFE is ~3kB injected once per page — per-item calls after that are <300B.

## Pack-size rule

List qty = total individual items. Helper detects multi-packs via regex `(\d+)\s*(?:pack|pk)\b` in product name and divides automatically. Example: list says "Pizza Bases: 4" + product is "2 pack" → cart qty = 2 packs (= 4 individual). Returns `warn: "uneven: list=N pack=P"` if list qty doesn't divide cleanly.

## Known quirks (lessons from prior runs)

1. **Helper wipes on navigation.** `window.__c` is destroyed every `browser_navigate`. Always re-inject in same evaluate as action.
2. **Side cart populates async.** After clicking "View cart", takes 1-3s for `wow-cart-item` rows to render. `__c.openCart()` polls automatically.
3. **Side cart may virtualize.** With 19+ items, `list()` may return only first ~10. Use `__c.cart()` badge for authoritative count, `list()` for sample names.
4. **`alreadyInCart` heuristic is unreliable.** A tile showing the qty stepper does NOT guarantee the item is in the server cart — could be local pending state from a previous session, saved-for-later, or restock-pending OOS item. The patched `add()` reads cart badge before/after to detect commit failures (`committed: false`).
5. **OOS items show qty stepper but don't commit.** Boring Barista oat milk had stepper at qty 2 but wasn't actually in cart (badge unchanged after inc/dec). Tile showed "EST. RESTOCK DD/MM/YY". Helper detects this.
6. **Browser process can stay locked.** If MCP errors with "Browser is already in use", run: `rm -f ~/.cache/ms-playwright/mcp-chrome-for-testing-*/Singleton{Lock,Cookie,Socket}` and `pkill -f playwright-mcp` if needed.
7. **Side cart items live in regular DOM, not shadow.** `wow-cart-item` rows have `input.cartControls-quantityInput` (regular DOM), NOT inside a shadow root. Remove button is `.cart-item-remove-button` with text only (no aria-label). See `reference/selectors.md`.
8. **JS `btn.click()` works for View Cart.** No need for synthetic PointerEvents. But the cart panel may have already been open (clicking again toggles it closed). Check `isSideCartOpen()` first — helper does.

## When site UI changes

Selectors live in `scripts/cart-helper.js` `SEL` object. Edit there only. Diagnostic snippets to discover new selectors: see [reference/selectors.md](reference/selectors.md).
