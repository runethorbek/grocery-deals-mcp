import { describe, expect, it, vi } from "vitest";
import { GROCERY_DEALER_IDS, listStores, selectStores } from "../src/stores.js";
import { UpstreamError } from "../src/upstream.js";
import { jsonResponse, rawDealer, rawGroceryDealers } from "./fixtures.js";

describe("selectStores", () => {
  it("returns name and dealerId only, sorted by name", () => {
    const stores = selectStores([rawDealer("9ba51", "Netto"), rawDealer("bdf5A", "føtex")], 50);
    expect(stores).toEqual([
      { name: "føtex", dealerId: "bdf5A" },
      { name: "Netto", dealerId: "9ba51" },
    ]);
  });

  it("keeps only allowlisted dealers, once each", () => {
    const body = [rawDealer("hw123", "Hardware"), rawDealer("9ba51", "Netto"), rawDealer("9ba51", "Netto")];
    expect(selectStores(body, 50)).toEqual([{ name: "Netto", dealerId: "9ba51" }]);
  });

  it("filters by case-insensitive substring before applying the limit", () => {
    expect(selectStores(rawGroceryDealers(), 50, "BRUGSEN").map((s) => s.name)).toEqual(["Brugsen", "SuperBrugsen"]);
    expect(selectStores(rawGroceryDealers(), 1, "brugsen").map((s) => s.name)).toEqual(["Brugsen"]);
    expect(selectStores(rawGroceryDealers(), 50, "ØTEX").map((s) => s.name)).toEqual(["føtex"]);
  });

  it("skips individual malformed dealers", () => {
    expect(selectStores([rawDealer("9ba51", "Netto"), { id: "71c90" }], 50)).toEqual([
      { name: "Netto", dealerId: "9ba51" },
    ]);
  });

  it("returns an empty list for an empty upstream result", () => {
    expect(selectStores([], 50)).toEqual([]);
  });

  it("rejects a body that is not an array, or has no recognizable dealer", () => {
    expect(() => selectStores({ dealers: [] }, 50)).toThrow(UpstreamError);
    expect(() => selectStores([{ foo: 1 }], 50)).toThrow(UpstreamError);
  });
});

describe("listStores", () => {
  it("requests the allowlisted dealers by ID", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(rawGroceryDealers()));

    const stores = await listStores({ limit: 50, fetch });

    expect(stores).toHaveLength(GROCERY_DEALER_IDS.length);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toBe(`https://squid-api.tjek.com/v2/dealers?dealer_ids=${GROCERY_DEALER_IDS.join(",")}`);
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with the HTTP status on upstream HTTP errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(listStores({ limit: 50, fetch })).rejects.toThrow(
      new UpstreamError("The stores service responded with HTTP 503."),
    );
  });

  it("fails with a timeout error when upstream does not respond in time", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(listStores({ limit: 50, fetch, timeoutMs: 20 })).rejects.toThrow(
      new UpstreamError("The stores service did not respond within 20 ms."),
    );
  });

  it("fails when the network request itself fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(listStores({ limit: 50, fetch })).rejects.toThrow(
      new UpstreamError("Could not reach the stores service."),
    );
  });
});
