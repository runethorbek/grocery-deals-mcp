import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpRequest } from "../src/http.js";

/**
 * Vercel Node.js function serving the MCP endpoint.
 * `vercel.json` rewrites `/mcp` to this function.
 */
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    // Vercel parses JSON request bodies lazily and throws on invalid JSON.
    body = req.body;
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
    return;
  }
  await handleMcpRequest(req, res, body);
}
