import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ServerDependencies } from "./server.js";

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  if (status === 405) res.setHeader("allow", "POST");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/**
 * Handles one MCP Streamable HTTP request in stateless mode: a fresh server
 * and transport per request, so it runs unchanged on serverless functions.
 * `body` is the already-parsed JSON body when the host provides one.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body?: unknown,
  deps?: ServerDependencies,
): Promise<void> {
  if (req.method !== "POST") {
    sendJsonRpcError(res, 405, -32000, "Method not allowed. Use POST for MCP requests.");
    return;
  }

  const server = createServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("MCP request failed", error);
    sendJsonRpcError(res, 500, -32603, "Internal server error");
  }
}
