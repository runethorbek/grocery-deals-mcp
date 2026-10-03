import { createServer } from "node:http";
import { handleMcpRequest } from "../src/http.js";

const port = Number(process.env.PORT ?? 3000);

/** Local development server exposing the same MCP endpoint as Vercel at /mcp. */
const httpServer = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/mcp") {
    res.statusCode = 404;
    res.end("Not found. The MCP endpoint is /mcp.");
    return;
  }
  void handleMcpRequest(req, res);
});

httpServer.listen(port, () => {
  console.log(`grocery-deals-mcp listening on http://localhost:${port}/mcp`);
});
