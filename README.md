# Grocery Deals MCP

A remote MCP server that exposes Danish grocery deals from the Tjek / eTilbudsavis API as MCP tools.

## Tool: `search_deals`

Searches grocery offers in Denmark that are valid at the time of the call.

| Input       | Type     | Notes                                                        |
|-------------|----------|--------------------------------------------------------------|
| `query`     | string   | Required, must not be empty.                                 |
| `limit`     | integer  | Optional, 1–50, default 10.                                  |
| `dealerIds` | string[] | Optional, 1–20 non-empty dealer IDs (e.g. from `list_stores`). |

Each result in `structuredContent.offers` contains:
`id`, `title`, `description`, `price`, `previousPrice` (or `null`), `currency`,
`quantity` (`{ unit, sizeFrom, sizeTo, piecesFrom, piecesTo }` or `null`), `storeName`,
`dealerId`, `validFrom`, `validUntil` (ISO 8601, UTC).

Behavior:

- Every upstream request is scoped to Denmark with a fixed location (central Denmark, 350 km radius).
  There is no location input.
- The server requests up to 100 offers upstream, keeps only offers where `validFrom <= now <= validUntil`,
  and then returns at most `limit`. Fewer results than `limit` are possible.
- With `dealerIds`, the upstream request is restricted to those dealers and the results are also filtered
  locally, so only offers from those stores are returned (before `limit` is applied). Any dealer ID is
  accepted; unknown IDs give an empty `offers` list. With several dealers, one store may fill most of the
  100-offer upstream window. Without `dealerIds`, nothing changes.
- Upstream HTTP errors, malformed responses and timeouts (8 s) return an MCP tool result with `isError: true`.
- Invalid input (empty `query`, `limit` outside 1–50, an empty or too long `dealerIds` array, or an empty
  dealer ID) is rejected with an input validation error.

## Tool: `list_stores`

Lists Danish grocery stores and their dealer IDs, sorted by name.

| Input   | Type    | Notes                                                              |
|---------|---------|--------------------------------------------------------------------|
| `query` | string  | Optional; if given, must not be empty. Case-insensitive substring match on the store name. |
| `limit` | integer | Optional, 1–50, default 50.                                        |

Returns `structuredContent.stores`, each `{ name, dealerId }`.

Behavior:

- The set of grocery stores is a curated allowlist of dealer IDs in `src/stores.ts`
  (365discount, ABC Lavpris, Bilka, Brugsen, Coop.dk MAD, føtex, Kvickly, Lidl, Løvbjerg, MENY,
  Min Købmand, nemlig, Netto, REMA 1000, SPAR, SuperBrugsen). Store names come from the upstream;
  allowlisted stores the upstream does not return are omitted.
- `query` is matched locally, e.g. `"brugsen"` matches Brugsen and SuperBrugsen.
- Upstream failures and invalid input are handled as for `search_deals`.

## Example: deals from selected stores

1. Discover the stores and their dealer IDs:

   ```jsonc
   // list_stores
   { "query": "netto" }
   // → { "stores": [{ "name": "Netto", "dealerId": "9ba51" }] }
   ```

2. Search only in Netto, REMA 1000 and Lidl:

   ```jsonc
   // search_deals
   { "query": "kylling", "dealerIds": ["9ba51", "11deC", "71c90"] }
   ```

   Every returned offer has a `dealerId` from the list.

## Local development

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

The MCP endpoint is served over Streamable HTTP at `http://localhost:3000/mcp`
(set `PORT` to use another port). The server is stateless: every request is handled independently.

Try it with the MCP Inspector:

```sh
npx @modelcontextprotocol/inspector
```

Choose transport "Streamable HTTP", enter `http://localhost:3000/mcp`, connect, and call `search_deals`
with `{ "query": "hakket oksekød" }`, or call `list_stores` with `{ "query": "netto" }`.

## Tests and type-check

```sh
npm test          # Vitest; the upstream API is stubbed, no real network calls
npm run typecheck # tsc --noEmit
```

## Deploying to Vercel

No environment variables or secrets are required.

1. Import the repository in Vercel (or run `npx vercel link` locally). Use the "Other" framework preset;
   no build command or output directory is needed.
2. Deploy (`npx vercel --prod`, or push to the production branch once the Git integration is set up).

`api/mcp.ts` is a Vercel Node.js function, and `vercel.json` rewrites `/mcp` to it, so the deployed
endpoint is `https://<your-project>.vercel.app/mcp`.

## Connecting an MCP client

Point any MCP client that supports remote servers over Streamable HTTP at the deployed endpoint:

```
https://<your-project>.vercel.app/mcp
```

The endpoint is public and requires no authentication. Examples:

- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL as above.
- **Claude Code:** `claude mcp add --transport http grocery-deals https://<your-project>.vercel.app/mcp`
- **Claude / ChatGPT (web):** add a custom connector with the URL above.

## Project layout

- `src/offers.ts` – offers search request, response validation, normalization, current-date and dealer filtering
- `src/stores.ts` – grocery store allowlist, dealers request, normalization and name filtering
- `src/upstream.ts` – shared upstream fetch with timeout and error handling
- `src/mcp-server.ts` – MCP server and the `search_deals` and `list_stores` tools
- `src/http.ts` – stateless Streamable HTTP handler
- `api/mcp.ts` – Vercel function entry point
- `scripts/dev-server.ts` – local HTTP server
- `test/` – tests
