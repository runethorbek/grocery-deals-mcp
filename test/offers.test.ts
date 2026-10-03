import { describe, expect, it, vi } from "vitest";
import {
  DENMARK_LOCATION,
  UPSTREAM_LIMIT,
  normalizeOffer,
  searchOffers,
  selectCurrentOffers,
  UpstreamError,
} from "../src/offers.js";
import { NOW, jsonResponse, rawOffer } from "./fixtures.js";

describe("normalizeOffer", () => {
  it("maps an upstream offer to Tjek-independent fields", () => {
    expect(normalizeOffer(rawOffer())).toEqual({
      id: "abc123",
      title: "Hakket oksekød 8-12%",
      description: "400 g / pk. Pr. kg 74,88",
      price: 29.95,
      previousPrice: 39.95,
      currency: "DKK",
      quantity: { unit: "g", sizeFrom: 400, sizeTo: 400, piecesFrom: 1, piecesTo: 1 },
      storeName: "Netto",
      dealerId: "9ba51",
      validFrom: "2026-09-28T22:00:00.000Z",
      validUntil: "2026-10-04T21:59:59.000Z",
    });
  });

  it("does not leak raw upstream structures", () => {
    const offer = normalizeOffer(rawOffer())!;
    const serialized = JSON.stringify(offer);
    for (const key of ["pricing", "dealer", "ern", "images", "run_from", "dealer_id", "catalog_page"]) {
      expect(offer).not.toHaveProperty(key);
    }
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("ern:");
  });

  it("uses null for missing previous price, description, store name and quantity", () => {
    const offer = normalizeOffer(
      rawOffer({
        description: null,
        pricing: { price: 10, pre_price: null, currency: "DKK" },
        quantity: { unit: null, size: null, pieces: null },
        dealer: undefined,
      }),
    );
    expect(offer).toMatchObject({
      description: null,
      previousPrice: null,
      quantity: null,
      storeName: null,
    });
  });

  it("rejects offers missing required fields or with unparseable dates", () => {
    expect(normalizeOffer(rawOffer({ pricing: undefined }))).toBeNull();
    expect(normalizeOffer(rawOffer({ id: 42 }))).toBeNull();
    expect(normalizeOffer(rawOffer({ run_till: "not a date" }))).toBeNull();
    expect(normalizeOffer("not an object")).toBeNull();
  });
});

describe("selectCurrentOffers", () => {
  it("keeps only offers valid at the given time", () => {
    const body = [
      rawOffer({ id: "current" }),
      rawOffer({ id: "future", run_from: "2026-10-04T22:00:00+0000", run_till: "2026-10-10T21:59:59+0000" }),
      rawOffer({ id: "expired", run_from: "2026-09-20T22:00:00+0000", run_till: "2026-10-02T21:59:59+0000" }),
    ];
    expect(selectCurrentOffers(body, NOW, 10).map((o) => o.id)).toEqual(["current"]);
  });

  it("treats validity boundaries as inclusive", () => {
    const body = [
      rawOffer({ id: "starts-now", run_from: "2026-10-03T12:00:00+0000" }),
      rawOffer({ id: "ends-now", run_till: "2026-10-03T12:00:00+0000" }),
      rawOffer({ id: "ended-just-before", run_till: "2026-10-03T11:59:59+0000" }),
    ];
    expect(selectCurrentOffers(body, NOW, 10).map((o) => o.id)).toEqual(["starts-now", "ends-now"]);
  });

  it("applies the limit after filtering", () => {
    const body = [
      rawOffer({ id: "expired", run_till: "2026-10-01T00:00:00+0000" }),
      ...Array.from({ length: 5 }, (_, i) => rawOffer({ id: `o${i}` })),
    ];
    expect(selectCurrentOffers(body, NOW, 3).map((o) => o.id)).toEqual(["o0", "o1", "o2"]);
  });

  it("skips individual malformed offers", () => {
    const body = [rawOffer({ id: "good" }), { id: "bad" }];
    expect(selectCurrentOffers(body, NOW, 10).map((o) => o.id)).toEqual(["good"]);
  });

  it("returns an empty list for an empty upstream result", () => {
    expect(selectCurrentOffers([], NOW, 10)).toEqual([]);
  });

  it("rejects a body that is not an array", () => {
    expect(() => selectCurrentOffers({ error: "nope" }, NOW, 10)).toThrow(UpstreamError);
  });

  it("rejects a non-empty array without any recognizable offer", () => {
    expect(() => selectCurrentOffers([{ foo: 1 }, { bar: 2 }], NOW, 10)).toThrow(UpstreamError);
  });
});

describe("searchOffers", () => {
  it("requests the Tjek search endpoint scoped to Denmark", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse([rawOffer()]));

    const offers = await searchOffers({ query: "hakket oksekød", limit: 10, now: NOW, fetch });

    expect(offers).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://squid-api.tjek.com/v2/offers/search");
    expect(url.searchParams.get("query")).toBe("hakket oksekød");
    expect(url.searchParams.get("limit")).toBe(String(UPSTREAM_LIMIT));
    expect(url.searchParams.get("r_lat")).toBe(String(DENMARK_LOCATION.latitude));
    expect(url.searchParams.get("r_lng")).toBe(String(DENMARK_LOCATION.longitude));
    expect(url.searchParams.get("r_radius")).toBe(String(DENMARK_LOCATION.radiusMeters));
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with the HTTP status on upstream HTTP errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("boom", { status: 503 }));
    await expect(searchOffers({ query: "mælk", limit: 10, now: NOW, fetch })).rejects.toThrow(
      new UpstreamError("The offers service responded with HTTP 503."),
    );
  });

  it("fails on non-JSON responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(searchOffers({ query: "mælk", limit: 10, now: NOW, fetch })).rejects.toThrow(/not valid JSON/);
  });

  it("fails on unexpected JSON shapes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ offers: [] }));
    await expect(searchOffers({ query: "mælk", limit: 10, now: NOW, fetch })).rejects.toThrow(/unexpected response/);
  });

  it("fails with a timeout error when upstream does not respond in time", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(searchOffers({ query: "mælk", limit: 10, now: NOW, fetch, timeoutMs: 20 })).rejects.toThrow(
      new UpstreamError("The offers service did not respond within 20 ms."),
    );
  });

  it("fails when the network request itself fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(searchOffers({ query: "mælk", limit: 10, now: NOW, fetch })).rejects.toThrow(
      new UpstreamError("Could not reach the offers service."),
    );
  });
});
