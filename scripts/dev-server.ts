import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { handleMcpRequest } from "../src/http.js";

const port = Number(process.env.PORT ?? 3000);
const landingPage = new URL("../public/index.html", import.meta.url);

/** Local development server exposing the same MCP endpoint as Vercel at /mcp and the landing page at /. */
const httpServer = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      res.end("Method not allowed.");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.method === "HEAD" ? undefined : readFileSync(landingPage));
    return;
  }
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
