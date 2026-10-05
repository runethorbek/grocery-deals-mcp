# Grocery Deals MCP

A remote MCP server that exposes Danish grocery deals from the Tjek / eTilbudsavis API as MCP tools.

## Install as a Claude plugin

The `grocery-deals` plugin bundles the [`weekly-meal-plan`](skills/weekly-meal-plan/SKILL.md) skill and connects
to the hosted server at `https://grocery-deals-mcp.vercel.app/mcp`. There is nothing to clone and no local process;
the server is public and needs no sign-in.

**Claude Code** (terminal, desktop app Code tab, VS Code). Inside a session:

```text
/plugin marketplace add runethorbek/grocery-deals-mcp
/plugin install grocery-deals@grocery-deals-mcp
```

Or from your shell, then start a new session:

```sh
claude plugin marketplace add runethorbek/grocery-deals-mcp
claude plugin install grocery-deals@grocery-deals-mcp
```

`/mcp` then lists the plugin's `grocery-deals` server with the tools `search_deals`, `list_stores` and
`get_store_offers`, and the skill is available as `/grocery-deals:weekly-meal-plan`.

**claude.ai and Claude Desktop** (chat and Cowork):

1. Go to **Customize → Plugins → Add → Add marketplace** and enter `runethorbek/grocery-deals-mcp`.
2. Add the `grocery-deals` plugin.
3. On the plugin's **Connectors** tab, add the `grocery-deals` connector. No sign-in is needed.

A plugin added on claude.ai is saved to your account; Claude Code signed in to the same account downloads it as a
synced plugin at the next session start.
If no `grocery-deals` connector appears on the plugin's **Connectors** tab, add the custom connector manually as
described in [Adding the server to Claude](#adding-the-server-to-claude). If your organization does not let you add
marketplaces, or the plugin cannot be added, use the full manual setup there instead.

**Avoid duplicate tools.** If you added the server or the skill manually before, remove that copy:

- Claude Code: `claude mcp remove grocery-deals` (repeat with `-s user`, `-s project` or `-s local` if it exists in
  several scopes), and delete any copy of the skill in `~/.claude/skills/weekly-meal-plan/`.
- claude.ai / Claude Desktop: remove the manually added custom connector under **Settings → Connectors**, and turn
  off or delete a manually uploaded `weekly-meal-plan` skill under **Customize → Skills**.

**Example.** In a new conversation, ask:

```text
Create a 5-day dinner plan for 3 people using offers from Netto and Rema 1000.
```

Claude resolves the stores with `list_stores`, reads their offers with `get_store_offers` and `search_deals`, and
answers with a plan shaped like this (illustrative and abridged; the dishes, offer titles, prices and dates come from
the live offers when you ask):

```text
Assumptions: 5 dinners for 3 people, starting today (<date>).

Meal plan
1. <weekday> <date> – <dish>: <one-line description>
   Offers used: <offer title> – Netto – <price> DKK (before <previous price> DKK), valid until <date>
2. <weekday> <date> – <dish>: <one-line description>
   Offers used: <offer title> – REMA 1000 – <price> DKK, valid until <date> – buy by <date>
...

Shopping list
Netto:      <item> – <total amount> (on offer: <price> DKK, until <date>)
REMA 1000:  <item> – <total amount> (on offer: <price> DKK, until <date>)
Any store:  <item> – <total amount>

Notes: ingredients not on offer, pantry staples assumed, validity flags.
```

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

## Tool: `get_store_offers`

Lists all offers from one store that are valid at the time of the call, page by page, in catalog order.

| Input      | Type    | Notes                                                               |
|------------|---------|---------------------------------------------------------------------|
| `dealerId` | string  | Required, must not be empty. The store's dealer ID from `list_stores`. |
| `limit`    | integer | Optional, 1–100, default 50.                                        |
| `offset`   | integer | Optional, 0 or more, default 0. Use `nextOffset` from the previous call. |

Returns `structuredContent` as `{ offers, nextOffset }`. Each offer has the same fields as in `search_deals`.

Paging:

- Start with `offset: 0` (or omit it). To get the next page, call again with `offset` set to the returned
  `nextOffset`. Repeat until `nextOffset` is `null`, which means there are no more offers.
- Following `nextOffset` returns every current offer of the store exactly once, as long as the store's
  offers do not change between calls. There is no snapshot across calls.
- A call can return fewer than `limit` offers, or none at all, even when `nextOffset` is not `null`.
  The upstream list also contains offers that are not valid yet or have expired; these are skipped, and
  one call reads at most 300 upstream offers. Keep paging until `nextOffset` is `null`.

Behavior:

- Only offers from `dealerId` with `validFrom <= now <= validUntil` are returned, in upstream order.
  Requests are scoped to Denmark as for `search_deals`.
- Any dealer ID is accepted; an unknown ID returns `{ "offers": [], "nextOffset": null }`.
- Upstream HTTP errors, malformed responses and timeouts on any upstream page return an MCP tool result
  with `isError: true` and no partial results.
- Invalid input (empty `dealerId`, `limit` outside 1–100, a negative or non-integer `offset`) is rejected
  with an input validation error.

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

## Example: everything on offer at one store

1. Find the store's dealer ID:

   ```jsonc
   // list_stores
   { "query": "netto" }
   // → { "stores": [{ "name": "Netto", "dealerId": "9ba51" }] }
   ```

2. Get the first page of Netto's current offers:

   ```jsonc
   // get_store_offers
   { "dealerId": "9ba51", "limit": 100 }
   // → { "offers": [ ... ], "nextOffset": 100 }
   ```

3. Continue with the returned `nextOffset` until it is `null`:

   ```jsonc
   // get_store_offers
   { "dealerId": "9ba51", "limit": 100, "offset": 100 }
   // → { "offers": [ ... ], "nextOffset": null }
   ```

## Local development

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

The MCP endpoint is served over Streamable HTTP at `http://localhost:3000/mcp`
(set `PORT` to use another port). The server is stateless: every request is handled independently,
and only `POST` is supported.

## Testing locally with the MCP Inspector

Start the server with `npm run dev`, then use the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) in a second terminal.

**Interactive (browser UI):**

```sh
npx @modelcontextprotocol/inspector
```

1. Open the URL the Inspector prints (it includes an auth token).
2. Transport type: **Streamable HTTP**. URL: `http://localhost:3000/mcp`. Click **Connect**.
3. Go to **Tools** → **List Tools**. Run `search_deals` with `{ "query": "hakket oksekød" }`,
   `list_stores` with `{ "query": "netto" }`, or `get_store_offers` with `{ "dealerId": "9ba51" }`.

**Non-interactive (CLI mode, useful for agents and scripts):**

```sh
# List tools
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list

# Call search_deals
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name search_deals --tool-arg query=kaffe --tool-arg limit=3

# Call list_stores
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name list_stores --tool-arg query=netto
```

**Raw HTTP (no Inspector):**

```sh
curl -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The same commands work against the hosted server by replacing the URL with `https://grocery-deals-mcp.vercel.app/mcp`
(or `https://<your-project>.vercel.app/mcp` for your own deployment).

## Tests and type-check

```sh
npm test          # Vitest; the upstream API is stubbed, no real network calls
npm run typecheck # tsc --noEmit
```

## Deploying to Vercel

How it fits together:

- `api/mcp.ts` is a Vercel Node.js function (no framework, no build step; Vercel compiles the TypeScript).
- `vercel.json` rewrites `/mcp` to `/api/mcp`, so the public endpoint is `https://<your-project>.vercel.app/mcp`.
- No environment variables or secrets are required. The Tjek API is called without credentials.

Steps (Vercel CLI):

```sh
npx vercel login          # once per machine
npx vercel link           # create or link the Vercel project; framework preset "Other", no build/output settings
npx vercel                # preview deployment
npx vercel --prod         # production deployment
```

Alternatively, import the GitHub repository in the Vercel dashboard (framework preset "Other");
pushes to `main` then deploy to production automatically.

Verify the deployment with the Inspector CLI or curl from the section above, using the production URL.
If a request returns `401` with a Vercel login page, Deployment Protection is enabled for that URL
(the default for preview deployments). Use the production domain or disable protection under
Project → Settings → Deployment Protection, since MCP clients cannot pass the Vercel login.

## Adding the server to Claude

The [Claude plugin](#install-as-a-claude-plugin) sets up both the server and the skill. Use the manual steps below
when you cannot install the plugin, or when you want the server without the skill.

The endpoint is public and requires no authentication. Use the production URL
`https://grocery-deals-mcp.vercel.app/mcp` (or `http://localhost:3000/mcp` for a local server in Claude Code).

**Claude Code:**

```sh
claude mcp add --transport http grocery-deals https://grocery-deals-mcp.vercel.app/mcp
# add --scope user to make it available in all projects, --scope project to share it via .mcp.json
claude mcp list           # check the connection
```

Inside a session, `/mcp` shows the server and its tools. To add the skill as well, copy
`skills/weekly-meal-plan/` to `~/.claude/skills/weekly-meal-plan/`.

**Claude.ai and Claude Desktop (custom connector):**

1. Settings → **Connectors** → **Add custom connector**.
2. Name: `Grocery deals`. URL: `https://grocery-deals-mcp.vercel.app/mcp`. Leave OAuth settings empty.
3. Enable the connector in a chat (the tools menu) and ask e.g. "Hvilke tilbud er der på kaffe?".
4. Optional, for meal plans: zip the `skills/weekly-meal-plan/` folder (the folder itself, so the archive contains
   `weekly-meal-plan/SKILL.md`), upload it under **Customize → Skills**, and turn it on.

Connectors added on claude.ai are also available in Claude Desktop and the Claude mobile apps.
A local server (`localhost`) cannot be used as a custom connector, because Claude connects from the cloud.

**Other MCP clients:** any client that supports remote MCP servers over Streamable HTTP can use the same URL.

## Project layout

- `src/offers.ts` – offers search and store offer paging requests, response validation, normalization,
  current-date and dealer filtering
- `src/stores.ts` – grocery store allowlist, dealers request, normalization and name filtering
- `src/upstream.ts` – shared upstream fetch with timeout and error handling
- `src/mcp-server.ts` – MCP server and the `search_deals`, `list_stores` and `get_store_offers` tools
- `src/http.ts` – stateless Streamable HTTP handler
- `api/mcp.ts` – Vercel function entry point
- `scripts/dev-server.ts` – local HTTP server
- `skills/weekly-meal-plan/` – the meal-planning skill
- `.claude-plugin/` – Claude plugin manifest (`plugin.json`) and marketplace listing (`marketplace.json`)
- `test/` – tests
