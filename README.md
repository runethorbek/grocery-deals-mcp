# Grocery Deals MCP

A remote MCP server that exposes Danish grocery deals from the Tjek / eTilbudsavis API as MCP tools.

## Tool: `search_deals`

Searches grocery offers in Denmark that are valid at the time of the call.

| Input   | Type    | Notes                                   |
|---------|---------|-----------------------------------------|
| `query` | string  | Required, must not be empty.            |
| `limit` | integer | Optional, 1–50, default 10.             |

Each result in `structuredContent.offers` contains:
`id`, `title`, `description`, `price`, `previousPrice` (or `null`), `currency`,
`quantity` (`{ unit, sizeFrom, sizeTo, piecesFrom, piecesTo }` or `null`), `storeName`,
`dealerId`, `validFrom`, `validUntil` (ISO 8601, UTC).

Behavior:

- Every upstream request is scoped to Denmark with a fixed location (central Denmark, 350 km radius).
  There is no location input.
- The server requests up to 100 offers upstream, keeps only offers where `validFrom <= now <= validUntil`,
  and then returns at most `limit`. Fewer results than `limit` are possible.
- Upstream HTTP errors, malformed responses and timeouts (8 s) return an MCP tool result with `isError: true`.
- Invalid input (empty `query`, `limit` outside 1–50) is rejected with an input validation error.

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
with `{ "query": "hakket oksekød" }`.

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

- `src/offers.ts` – upstream request, response validation, normalization and current-date filtering
- `src/mcp-server.ts` – MCP server and the `search_deals` tool
- `src/http.ts` – stateless Streamable HTTP handler
- `api/mcp.ts` – Vercel function entry point
- `scripts/dev-server.ts` – local HTTP server
- `test/` – tests
