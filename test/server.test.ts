import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "../src/http.js";
import { GROCERY_DEALER_IDS } from "../src/stores.js";
import { NOW, jsonResponse, rawDealer, rawGroceryDealers, rawOffer } from "./fixtures.js";

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

async function listStores(args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await connect();
  return (await client.callTool({ name: "list_stores", arguments: args })) as CallToolResult;
}

function storesOf(result: CallToolResult): Array<Record<string, unknown>> {
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { stores: Array<Record<string, unknown>> }).stores;
}

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
}

type InputSchema = { properties: Record<string, Record<string, unknown>>; required?: string[] };

async function inputSchemaOf(name: string): Promise<InputSchema> {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(["list_stores", "search_deals"]);
  return tools.find((tool) => tool.name === name)!.inputSchema as InputSchema;
}

describe("tool discovery", () => {
  it("exposes search_deals with the documented input schema", async () => {
    const schema = await inputSchemaOf("search_deals");
    expect(schema.required).toEqual(["query"]);
    expect(schema.properties.query).toMatchObject({ type: "string", minLength: 1 });
    expect(schema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 50, default: 10 });
    expect(schema.properties.dealerIds).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "string", minLength: 1 },
    });
    expect(Object.keys(schema.properties).sort()).toEqual(["dealerIds", "limit", "query"]);
  });

  it("exposes list_stores with the documented input schema", async () => {
    const schema = await inputSchemaOf("list_stores");
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties.query).toMatchObject({ type: "string", minLength: 1 });
    expect(schema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 50, default: 50 });
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

describe("search_deals with dealerIds", () => {
  it("restricts the upstream request and filters out offers from other dealers", async () => {
    upstreamFetch.mockResolvedValue(
      jsonResponse([
        rawOffer({ id: "netto", dealer_id: "9ba51" }),
        rawOffer({ id: "bilka", dealer_id: "93f13", dealer: { name: "Bilka" } }),
        rawOffer({ id: "lidl", dealer_id: "71c90", dealer: { name: "Lidl" } }),
      ]),
    );

    const result = await searchDeals({ query: "kylling", dealerIds: ["9ba51", "11deC", "71c90"] });

    expect(result.isError).toBeFalsy();
    const { offers } = result.structuredContent as { offers: Array<{ id: string; dealerId: string }> };
    expect(offers.map((offer) => offer.id)).toEqual(["netto", "lidl"]);
    expect(offers.every((offer) => ["9ba51", "11deC", "71c90"].includes(offer.dealerId))).toBe(true);
    expect(String(upstreamFetch.mock.calls[0]![0])).toMatch(/&dealer_ids=9ba51,11deC,71c90$/);
  });

  it("returns an empty list for unknown dealer IDs and keeps serving", async () => {
    upstreamFetch.mockResolvedValueOnce(jsonResponse([]));
    const result = await searchDeals({ query: "kylling", dealerIds: ["unknown-dealer"] });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ offers: [] });

    upstreamFetch.mockResolvedValueOnce(jsonResponse([rawOffer()]));
    const next = await searchDeals({ query: "kylling" });
    expect((next.structuredContent as { offers: unknown[] }).offers).toHaveLength(1);
  });

  it("leaves the upstream URL unchanged when dealerIds is omitted", async () => {
    upstreamFetch.mockResolvedValue(jsonResponse([]));
    await searchDeals({ query: "kylling" });
    expect(String(upstreamFetch.mock.calls[0]![0])).toBe(
      "https://squid-api.tjek.com/v2/offers/search?query=kylling&limit=100&r_lat=56&r_lng=10.5&r_radius=350000",
    );
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
    [{ query: "mælk", dealerIds: [] }, /dealerIds must contain between 1 and 20 dealer IDs/],
    [{ query: "mælk", dealerIds: Array.from({ length: 21 }, (_, i) => `d${i}`) }, /between 1 and 20/],
    [{ query: "mælk", dealerIds: ["9ba51", " "] }, /dealerIds must not contain empty strings/],
    [{ query: "mælk", dealerIds: "9ba51" }, /dealerIds/],
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

describe("list_stores", () => {
  it("returns the allowlisted stores as name and dealerId only, sorted by name", async () => {
    upstreamFetch.mockResolvedValue(jsonResponse(rawGroceryDealers()));

    const stores = storesOf(await listStores({}));

    expect(stores.map((store) => store.name)).toEqual([
      "365discount",
      "ABC Lavpris",
      "Bilka",
      "Brugsen",
      "Coop.dk MAD",
      "føtex",
      "Kvickly",
      "Lidl",
      "Løvbjerg",
      "MENY",
      "Min Købmand",
      "nemlig",
      "Netto",
      "REMA 1000",
      "SPAR",
      "SuperBrugsen",
    ]);
    expect(stores.find((store) => store.name === "Netto")).toEqual({ name: "Netto", dealerId: "9ba51" });
    for (const store of stores) expect(Object.keys(store).sort()).toEqual(["dealerId", "name"]);
    expect(JSON.stringify(stores)).not.toMatch(/ern:|https:/);

    const url = new URL(String(upstreamFetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://squid-api.tjek.com/v2/dealers");
    expect(url.searchParams.get("dealer_ids")).toBe(GROCERY_DEALER_IDS.join(","));
  });

  it("omits non-allowlisted dealers and allowlisted IDs that upstream does not return", async () => {
    upstreamFetch.mockResolvedValue(
      jsonResponse([rawDealer("9ba51", "Netto"), rawDealer("hw123", "Some Hardware Store")]),
    );
    expect(storesOf(await listStores({}))).toEqual([{ name: "Netto", dealerId: "9ba51" }]);
  });

  it("filters by a case-insensitive substring of the store name", async () => {
    upstreamFetch.mockImplementation(async () => jsonResponse(rawGroceryDealers()));
    expect(storesOf(await listStores({ query: "brugsen" }))).toEqual([
      { name: "Brugsen", dealerId: "d311fg" },
      { name: "SuperBrugsen", dealerId: "0b1e8" },
    ]);
    expect(storesOf(await listStores({ query: "  NETTO " }))).toEqual([{ name: "Netto", dealerId: "9ba51" }]);
    expect(storesOf(await listStores({ query: "no such store" }))).toEqual([]);
  });

  it("honors limit", async () => {
    upstreamFetch.mockResolvedValue(jsonResponse(rawGroceryDealers()));
    expect(storesOf(await listStores({ limit: 3 })).map((store) => store.name)).toEqual([
      "365discount",
      "ABC Lavpris",
      "Bilka",
    ]);
  });

  it.each([
    [{ query: "" }, /query must not be empty/],
    [{ query: "   " }, /query must not be empty/],
    [{ limit: 0 }, /limit must be between 1 and 50/],
    [{ limit: 51 }, /limit must be between 1 and 50/],
    [{ limit: 2.5 }, /limit must be an integer/],
  ])("rejects %j", async (args, message) => {
    const result = await listStores(args);
    expect(errorText(result)).toMatch(/Input validation error/);
    expect(errorText(result)).toMatch(message);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("returns a tool error on upstream HTTP errors and keeps serving", async () => {
    upstreamFetch.mockResolvedValueOnce(new Response("down", { status: 502 }));
    expect(errorText(await listStores({}))).toBe("list_stores failed: The stores service responded with HTTP 502.");

    upstreamFetch.mockResolvedValueOnce(jsonResponse(rawGroceryDealers()));
    expect(storesOf(await listStores({}))).toHaveLength(16);
  });

  it("returns a tool error on non-JSON responses", async () => {
    upstreamFetch.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(errorText(await listStores({}))).toMatch(/list_stores failed: .*not valid JSON/);
  });

  it.each([[{ dealers: [] }], [[{ foo: 1 }]]])("returns a tool error on unexpected response %j", async (body) => {
    upstreamFetch.mockResolvedValue(jsonResponse(body));
    expect(errorText(await listStores({}))).toMatch(/list_stores failed: The stores service returned .*unexpected/);
  });

  it("returns a tool error on timeouts", async () => {
    upstreamFetch.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    expect(errorText(await listStores({}))).toMatch(/did not respond within 50 ms/);
  });
});

describe("HTTP endpoint", () => {
  it("rejects non-POST requests with 405", async () => {
    const response = await fetch(endpoint, { method: "GET" });
    expect(response.status).toBe(405);
  });
});
