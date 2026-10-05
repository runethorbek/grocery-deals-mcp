---
name: weekly-meal-plan
description: Plan dinners for several days based on current grocery offers (tilbud) from Danish stores the user names, such as Netto, REMA 1000 or Lidl, using the Grocery Deals MCP tools. Use when the user asks for a meal plan, dinner plan, weekly menu or madplan built around grocery deals or offers. Produces a meal plan, the offers behind each meal, a consolidated shopping list per store, and notes on ingredients not on offer.
---

# Weekly meal plan from grocery offers

Build a practical dinner plan around current offers returned by the Grocery Deals MCP tools. The tools are a source of offer data only; you own the planning. Never invent offer data.

## Tools

Use the Grocery Deals MCP tools. Their names may carry a client or connector prefix (for example `mcp__grocery-deals__list_stores`); match them by the base names:

- `list_stores({ query?, limit? })` → `{ stores: [{ name, dealerId }] }`. `query` is a case-insensitive substring match, so one name can match several stores (e.g. "brugsen" matches Brugsen and SuperBrugsen).
- `get_store_offers({ dealerId, limit? (1–100), offset? })` → `{ offers, nextOffset }`. Pass `nextOffset` as the next `offset`; `null` means no more offers. A page can hold fewer than `limit` offers, even zero, while `nextOffset` is not `null`.
- `search_deals({ query, limit? (1–50), dealerIds? })` → `{ offers }`. Offer titles are Danish, so search in Danish (e.g. "kylling", "hakket oksekød", "laks", "broccoli").

Each offer has `id`, `title`, `description`, `price`, `previousPrice` (or `null`), `currency`, `quantity`, `storeName`, `dealerId`, `validFrom`, `validUntil` (ISO 8601, UTC). All tools return only offers valid at the time of the call. If `storeName` is null, use the store name that `list_stores` resolved for that offer's `dealerId`.

## 1. Inputs

- **Stores:** If the user names no stores, ask which stores to use and stop until they answer. Never pick a default set of stores.
- **Days and people:** If the number of days or people is missing, use 5 dinners for 2 people and state that assumption at the top of the answer. Ask a follow-up question only when the plan cannot be useful without it.
- **Constraints:** Respect every constraint in the prompt (e.g. vegetarian, max cooking time, allergies, dislikes, budget focus). Constraints apply to the whole plan, including ingredients not on offer.
- **Start day:** If the user names days (e.g. "Monday to Friday"), map them to dates starting from today or the next such day. Otherwise start today. Show the date for each day.

## 2. Retrieving offers

If any Grocery Deals tool is unavailable, or a call returns an error, tell the user that the grocery offer data could not be retrieved (include the error message) and stop. Do not produce a plan from general knowledge or invented offers. Retrying a failed call once is fine.

1. **Resolve stores.** Call `list_stores` with each store name the user gave (e.g. `query: "netto"`, `query: "rema"`). Use the `dealerId` from the result; never guess or reuse an ID from memory.
   - Exactly one match: use it.
   - Several matches: use the one whose name equals the user's store name (ignoring case); if none does, ask the user which store they mean.
   - No match: tell the user the store could not be found, show the store names `list_stores` does offer if helpful, and continue with the remaining stores only if at least one resolved. If none resolved, stop.
2. **Browse each store, bounded.** Call `get_store_offers` with `limit: 100` for each store. Fetch at most one more page (using `nextOffset`) per store, so at most two pages of 100 per store. Do not page through the full catalog.
3. **Targeted lookups.** Call `search_deals` with `dealerIds` set to the resolved stores for likely main ingredients that fit the constraints and that browsing did not cover well, e.g. proteins (kylling, hakket oksekød, svinekød, laks, torsk, æg, linser, tofu), vegetables and staples (kartofler, ris, pasta). Keep this to a handful of searches.

Only offers that appear in these tool results in the current conversation may be shown or used.

## 3. Planning

- Prefer meals where the offers make a meaningful difference, typically the main protein or several key ingredients. Ingredients not on offer are allowed.
- Make a coherent plan, not a list of discounted products: vary proteins and cuisines across days, and reuse ingredients sensibly (e.g. one bag of rice or one bunch of herbs over two meals) to limit waste.
- Scale quantities to the number of people. Respect cooking-time limits by choosing meals that fit.
- **Validity:** Use an offer only for a planned day on or before its `validUntil` date. When an offer expires before the day its meal is planned, either move the meal earlier or keep it and flag clearly that the item must be bought by the `validUntil` date. Never use an expired offer silently.
- Pick a matching offer only when the product really fits the dish. Do not treat a non-food or unrelated product as an ingredient.

## 4. Output

Answer in the user's language. Keep offer titles exactly as returned (usually Danish); do not translate or rewrite them. Show dates in a readable local format.

Start with any assumptions (default days/people, start date, unresolved stores). Then:

1. **Meal plan** – one entry per day: day and date, dish name, a one-line description, and an approximate cooking time when the user asked for a time limit.
2. **Offers used per meal** – under each meal, list every offer that influenced it: title, store, price with currency, and valid until date. Show a saving only when `previousPrice` is present (e.g. "before 49.95 DKK"); never derive or state a saving otherwise. Add a "buy by <date>" flag when the offer expires before the meal's day.
3. **Shopping list** – consolidated across all meals and grouped by store. List each item once per store with the total amount needed for the whole plan. Mark items that are on offer (with price and valid-until date). Put items not on offer in a separate group ("Any store" or similar), unless the user prefers otherwise. If an item on offer is needed in a larger amount than the offer covers, list it once, under the store with the offer, with the total amount needed.
4. **Notes** – ingredients not covered by any offer, pantry staples assumed (oil, salt, spices), and anything flagged for validity.

## Data integrity

- Never invent offers, products, prices, savings or validity dates. Every offer shown must match a tool result from this conversation in title, store, price and validity.
- Do not estimate prices for items not on offer, and do not state a total cost for the plan.
- If the offers are too thin for a useful plan (e.g. few food offers), say so and plan with what is there rather than filling gaps with invented deals.
- Do not save or persist user preferences or personal data; use them only within the current conversation.
