import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "../src/http.js";
import { NOW, jsonResponse, rawOffer } from "./fixtures.js";

/** Stubbed upstream: tests never reach the real Tjek API. */
const upstreamFetch = vi.fn<typeof globalThis.fetch>();

let httpServer: Server;
let endpoint: URL;
const clients: Client[] = [];

beforeAll(async () => {
  httpServer = createHttpServer((req, res) => {
    void handleMcpRequest(req, res, undefined, { fetch: upstreamFetch, now: () => NOW, timeoutMs: 50 });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  endpoint = new URL(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`);
});

afterEach(async () => {
  upstreamFetch.mockReset();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
});

async function connect(): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  clients.push(client);
  return client;
}

async function searchDeals(args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await connect();
  return (await client.callTool({ name: "search_deals", arguments: args })) as CallToolResult;
}

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
}

describe("search_deals discovery", () => {
  it("exposes exactly one tool with the documented input schema", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["search_deals"]);
    const schema = tools[0]!.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    expect(schema.required).toEqual(["query"]);
    expect(schema.properties.query).toMatchObject({ type: "string", minLength: 1 });
    expect(schema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 50, default: 10 });
    expect(Object.keys(schema.properties).sort()).toEqual(["limit", "query"]);
  });
});

describe("search_deals results", () => {
  it("returns normalized current offers as structured content", async () => {
    upstreamFetch.mockResolvedValue(
      jsonResponse([rawOffer({ id: "current" }), rawOffer({ id: "expired", run_till: "2026-10-01T00:00:00+0000" })]),
    );

    const result = await searchDeals({ query: "hakket oksekød" });

    expect(result.isError).toBeFalsy();
    const { offers } = result.structuredContent as { offers: Array<Record<string, unknown>> };
    expect(offers.map((offer) => offer.id)).toEqual(["current"]);
    expect(offers[0]).toMatchObject({ title: "Hakket oksekød 8-12%", storeName: "Netto", dealerId: "9ba51" });
    expect(offers[0]).not.toHaveProperty("pricing");
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
  });

  it("defaults limit to 10", async () => {
    upstreamFetch.mockResolvedValue(jsonResponse(Array.from({ length: 15 }, (_, i) => rawOffer({ id: `o${i}` }))));
    const result = await searchDeals({ query: "mælk" });
    expect((result.structuredContent as { offers: unknown[] }).offers).toHaveLength(10);
  });

  it("honors an explicit limit", async () => {
    upstreamFetch.mockResolvedValue(jsonResponse(Array.from({ length: 15 }, (_, i) => rawOffer({ id: `o${i}` }))));
    const result = await searchDeals({ query: "mælk", limit: 3 });
    expect((result.structuredContent as { offers: unknown[] }).offers).toHaveLength(3);
  });
});

describe("search_deals input validation", () => {
  it.each([
    [{ query: "" }, /query must not be empty/],
    [{ query: "   " }, /query must not be empty/],
    [{}, /query/],
    [{ query: "mælk", limit: 0 }, /limit must be between 1 and 50/],
    [{ query: "mælk", limit: 51 }, /limit must be between 1 and 50/],
    [{ query: "mælk", limit: 2.5 }, /limit must be an integer/],
  ])("rejects %j", async (args, message) => {
    const result = await searchDeals(args);
    expect(errorText(result)).toMatch(/Input validation error/);
    expect(errorText(result)).toMatch(message);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("search_deals upstream failures", () => {
  it("returns a tool error on upstream HTTP errors and keeps serving", async () => {
    upstreamFetch.mockResolvedValueOnce(new Response("down", { status: 500 }));
    expect(errorText(await searchDeals({ query: "mælk" }))).toBe(
      "search_deals failed: The offers service responded with HTTP 500.",
    );

    upstreamFetch.mockResolvedValueOnce(jsonResponse([rawOffer()]));
    const next = await searchDeals({ query: "mælk" });
    expect(next.isError).toBeFalsy();
    expect((next.structuredContent as { offers: unknown[] }).offers).toHaveLength(1);
  });

  it("returns a tool error on malformed responses", async () => {
    upstreamFetch.mockResolvedValue(new Response("not json", { status: 200 }));
    expect(errorText(await searchDeals({ query: "mælk" }))).toMatch(/not valid JSON/);
  });

  it("returns a tool error on timeouts", async () => {
    upstreamFetch.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    expect(errorText(await searchDeals({ query: "mælk" }))).toMatch(/did not respond within 50 ms/);
  });

  it("returns a tool error without internal details when the request fails", async () => {
    upstreamFetch.mockImplementation(() => {
      throw new Error("secret internal detail");
    });
    const text = errorText(await searchDeals({ query: "mælk" }));
    expect(text).toBe("search_deals failed: Could not reach the offers service.");
  });
});

describe("HTTP endpoint", () => {
  it("rejects non-POST requests with 405", async () => {
    const response = await fetch(endpoint, { method: "GET" });
    expect(response.status).toBe(405);
  });
});
