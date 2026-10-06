---
name: wine-deals
description: Find current wine offers (vin på tilbud) in Danish grocery stores such as Netto, føtex, Bilka or MENY using the Grocery Deals MCP tools, and explain which bottles are worth considering and why. Use when the user asks for wine deals, wine offers, good or interesting wine on sale, vin på tilbud, vintilbud or rødvin/hvidvin/bobler på tilbud, optionally with a budget, colour, country, region, grape or occasion. Produces a short list of offers with labelled offer data, background and sources, plus picks for best value, most interesting and best for learning.
---

# Wine deals from grocery offers

Find current wine offers with the Grocery Deals MCP tools and help the user choose well: good value, an interesting style, region or grape, or something useful for learning. This is not a ranking by discount or by external scores. The tools are a source of offer data only; you own the interpretation. Never invent offer data.

## Tools

Use the Grocery Deals MCP tools. Their names may carry a client or connector prefix (for example `mcp__grocery-deals__list_stores`); match them by the base names:

- `list_stores({ query?, limit? })` → `{ stores: [{ name, dealerId }] }`. `query` is a case-insensitive substring match, so one name can match several stores (e.g. "brugsen" matches Brugsen and SuperBrugsen).
- `get_store_offers({ dealerId, limit? (1–100), offset? })` → `{ offers, nextOffset }`. Pass `nextOffset` as the next `offset`; `null` means no more offers. A page can hold fewer than `limit` offers, even zero, while `nextOffset` is not `null`.
- `search_deals({ query, limit? (1–50), dealerIds? })` → `{ offers }`. Offer titles are Danish, so search in Danish. One call reads at most 100 offers upstream; with several `dealerIds`, one store can fill that window.

Each offer has `id`, `title`, `description`, `price`, `previousPrice` (or `null`), `currency`, `quantity`, `storeName`, `dealerId`, `validFrom`, `validUntil` (ISO 8601, UTC). All tools return only offers valid at the time of the call. If `storeName` is null, use the store name that `list_stores` resolved for that offer's `dealerId`.

## 1. Inputs

- **Stores:** Use the stores the user names. If the user names no stores, use this fixed set of chains with stores in Copenhagen: 365discount, Bilka, Brugsen, føtex, Kvickly, Lidl, MENY, Netto, REMA 1000, SPAR, SuperBrugsen. Do not ask; state this assumption at the top of the answer.
- **Constraints:** Respect every constraint in the prompt, e.g. colour, budget, country, region, grape, occasion or food pairing, and number of wines.
- **Budget:** A budget applies to the price of one bottle (75 cl). For multi-bottle packs or other sizes (18.7 cl, 37.5 cl, magnum, bag-in-box), compute the per-bottle or 75 cl equivalent from the offer's `price`, `quantity` and description, and show it as calculated (e.g. "239.95 DKK for 6 × 75 cl ≈ 40 DKK per bottle, calculated"). If the size cannot be determined from the offer, say so and do not assume one.

## 2. Retrieving offers

If a call returns an error, you may retry it once. If any Grocery Deals tool is unavailable, or a call still fails after that one retry, tell the user that the grocery offer data could not be retrieved (include the error message) and stop. Do not recommend wines from general knowledge or invented offers.

1. **Resolve stores.** Call `list_stores` (once without `query` for the default set, or with each store name the user gave, e.g. `query: "føtex"`). Use the `dealerId` from the result; never guess or reuse an ID from memory.
   - Exactly one match: use it.
   - Several matches: use the one whose name equals the store name (ignoring case); for a user-named store where none does, ask the user which store they mean.
   - No match: for a user-named store, tell the user it could not be found and continue with the others; for the default set, skip it and mention it in the assumptions. If no store resolved, stop.
2. **Search for wine, bounded.** Call `search_deals` with `limit: 50` and `dealerIds` set to one store, or a small group of at most three stores, at a time, so one store cannot fill the 100-offer window. Start with `"vin"`, then add a few terms that fit the request, e.g. `"rødvin"`, `"hvidvin"`, `"rosé"`, `"mousserende"`, `"champagne"`, `"cava"`, `"prosecco"`, or a country, region or grape the user mentioned (`"italien"`, `"rioja"`, `"barolo"`). If a group search returns 50 offers or is dominated by one store, repeat it per store. Keep the total to about 15 `search_deals` calls.
3. **Optional browse.** For a store whose search results look thin, you may call `get_store_offers` with `limit: 100`, at most one page per store, and pick out the wine offers.

Keep only wine. Ignore glassware, food or other products whose text merely mentions wine, and ignore alcohol-free wine unless the user asks for it. Only offers that appear in these tool results in the current conversation may be shown or recommended.

## 3. Recommending

- Shortlist 3–5 offers by default, or the number the user asks for. Choose and explain them for value, an interesting style, region or grape, or learning value; not by discount alone. Prefer a varied shortlist over several similar bottles.
- **Multi-wine offers** (e.g. "Righetti Amarone, Faustino 1 Gran Reserva eller Brunello di Montalcino Cordella"): name the specific wine you mean, note that the price covers a choice of wines, and never attach one wine's details to another.
- **Category offers** (e.g. "Italienske vinflasker" with "Spar 40% på mere end 50 italienske vinflasker"): mention them only as a pointer to the store. Their `price` is not a bottle price, and the specific bottles included are not known from the data.
- **Thin data:** Many offers give only a brand and a colour. When the data is too thin for a confident recommendation, say so instead of filling the gaps. If there are few or no wine offers matching the request, say that rather than stretching the shortlist.

## 4. Facts, background and sources

Keep three kinds of information apart and label them in the output:

- **Offer data:** only what the tool results say: title, description, price, size, store, validity and `previousPrice`. Claims in the offer text, such as "93P GUIA PENIN", tasting notes, "Normalpris 109,-" or a plus-app/member price, are quoted as the store's claims, not verified facts.
- **General background:** what a grape, region, appellation or style named in the offer typically is and tastes like, why it is worth knowing, and how it fits the user's interest. Phrase it as typical for the category ("Ripasso is typically..."), never as a fact about this bottle.
- **Web research:** when a web search or fetch tool is available, you may look up shortlisted wines or producers. Every claim from it carries a source link. Say when you cannot be sure the source describes the same bottle (e.g. the vintage or exact cuvée is unknown). Do not present external scores or ratings as applying to the offered bottle. Without a web tool, work from offer data and general background only, and do not imply that you checked sources.

Never invent vintages, producers, appellations, ratings, normal prices, savings or other wine data. Show a saving only when `previousPrice` is present; a "Normalpris" in the description is quoted as the store's claim, not turned into a saving. Where the offer data contradicts itself or general knowledge (e.g. a Mencía labelled "Hvidvin"), point it out rather than silently correcting it.

## 5. Output

Answer in the user's language. Keep offer titles exactly as returned (usually Danish); do not translate or rewrite them. Show dates in a readable local format.

1. **Assumptions** – stores used (and that the Copenhagen chain set was assumed when no stores were named), stores skipped, and how the budget and sizes were interpreted.
2. **Shortlist** – for each wine:
   - offer title as returned, store, price with currency and size (plus the per-bottle or 75 cl equivalent if calculated, marked as calculated), and valid until date;
   - saving, only from `previousPrice` (e.g. "before 129.95 DKK");
   - **Offer data:** the facts and store claims from the offer;
   - **Why it may be interesting:** labelled general background and interpretation, with source links for any web-sourced claims;
   - **Confidence/limitations:** e.g. multi-wine offer, unknown vintage, contradictory label, thin data.
3. **Picks** – best value, most interesting, best for learning, and optionally a wildcard, each pointing to a shortlisted offer with one line of reasoning. Skip a pick when nothing fits.

## Data integrity

- Every recommended offer must match a tool result from this conversation in title, store, price and validity.
- Do not estimate prices for wines not on offer, and do not compare with normal prices you have not been given.
- Do not save or persist preferences, tasting notes or history; use them only within the current conversation.
