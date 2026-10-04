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
3. Go to **Tools** → **List Tools** → `search_deals`, enter `{ "query": "hakket oksekød" }` and run it.

**Non-interactive (CLI mode, useful for agents and scripts):**

```sh
# List tools
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list

# Call search_deals
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http   --method tools/call --tool-name search_deals --tool-arg query=kaffe --tool-arg limit=3
```

**Raw HTTP (no Inspector):**

```sh
curl -X POST http://localhost:3000/mcp   -H "content-type: application/json"   -H "accept: application/json, text/event-stream"   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The same commands work against a deployment by replacing the URL with `https://<your-project>.vercel.app/mcp`.

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

The endpoint is public and requires no authentication. Use the production URL
`https://<your-project>.vercel.app/mcp` (or `http://localhost:3000/mcp` for a local server in Claude Code).

**Claude Code:**

```sh
claude mcp add --transport http grocery-deals https://<your-project>.vercel.app/mcp
# add --scope user to make it available in all projects, --scope project to share it via .mcp.json
claude mcp list           # check the connection
```

Inside a session, `/mcp` shows the server and its tools.

**Claude.ai and Claude Desktop (custom connector):**

1. Settings → **Connectors** → **Add custom connector**.
2. Name: `Grocery deals`. URL: `https://<your-project>.vercel.app/mcp`. Leave OAuth settings empty.
3. Enable the connector in a chat (the tools menu) and ask e.g. "Hvilke tilbud er der på kaffe?".

Connectors added on claude.ai are also available in Claude Desktop and the Claude mobile apps.
A local server (`localhost`) cannot be used as a custom connector, because Claude connects from the cloud.

**Other MCP clients:** any client that supports remote MCP servers over Streamable HTTP can use the same URL.

## Project layout

- `src/offers.ts` – upstream request, response validation, normalization and current-date filtering
- `src/mcp-server.ts` – MCP server and the `search_deals` tool
- `src/http.ts` – stateless Streamable HTTP handler
- `api/mcp.ts` – Vercel function entry point
- `scripts/dev-server.ts` – local HTTP server
- `test/` – tests
