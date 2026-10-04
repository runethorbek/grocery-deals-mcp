import { describe, expect, it, vi } from "vitest";
import {
  DENMARK_LOCATION,
  MAX_STORE_OFFER_REQUESTS,
  UPSTREAM_LIMIT,
  buildSearchUrl,
  buildStoreOffersUrl,
  getStoreOffers,
  normalizeOffer,
  searchOffers,
  selectCurrentOffers,
  UpstreamError,
  type StoreOffersPage,
} from "../src/offers.js";
import { NOW, futureRawOffer, jsonResponse, pagedOffersUpstream, rawOffer } from "./fixtures.js";

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

  it("keeps only offers from the given dealers and applies the limit after that filter", () => {
    const body = [
      rawOffer({ id: "bilka1", dealer_id: "93f13" }),
      rawOffer({ id: "netto1", dealer_id: "9ba51" }),
      rawOffer({ id: "bilka2", dealer_id: "93f13" }),
      rawOffer({ id: "lidl1", dealer_id: "71c90" }),
      rawOffer({ id: "netto2", dealer_id: "9ba51" }),
    ];
    expect(selectCurrentOffers(body, NOW, 2, ["9ba51", "71c90"]).map((o) => o.id)).toEqual(["netto1", "lidl1"]);
    expect(selectCurrentOffers(body, NOW, 10, ["unknown"])).toEqual([]);
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

  it("does not add a dealer filter when dealerIds is omitted", () => {
    expect(new URL(buildSearchUrl("mælk")).searchParams.has("dealer_ids")).toBe(false);
  });

  it("restricts the upstream request to the given dealers and filters locally", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse([rawOffer({ id: "netto", dealer_id: "9ba51" }), rawOffer({ id: "bilka", dealer_id: "93f13" })]),
      );

    const offers = await searchOffers({ query: "kylling", limit: 10, dealerIds: ["9ba51", "11deC"], now: NOW, fetch });

    expect(offers.map((o) => o.id)).toEqual(["netto"]);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toBe(`${buildSearchUrl("kylling")}&dealer_ids=9ba51,11deC`);
    expect(new URL(url).searchParams.get("dealer_ids")).toBe("9ba51,11deC");
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

describe("getStoreOffers", () => {
  const NETTO = "9ba51";

  function upstream(rawOffers: readonly Record<string, unknown>[]) {
    return vi.fn<typeof globalThis.fetch>(pagedOffersUpstream(rawOffers));
  }

  function requestedOffsets(fetch: ReturnType<typeof upstream>): number[] {
    return fetch.mock.calls.map(([input]) => Number(new URL(String(input)).searchParams.get("offset")));
  }

  function currentOffers(count: number, prefix = "o"): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, i) => rawOffer({ id: `${prefix}${i}` }));
  }

  it("requests one dealer's offers in catalog page order, in pages of 100, scoped to Denmark", () => {
    expect(buildStoreOffersUrl(NETTO, 200)).toBe(
      "https://squid-api.tjek.com/v2/offers?dealer_ids=9ba51&order_by=page&limit=100&offset=200&r_lat=56&r_lng=10.5&r_radius=350000",
    );
    const url = new URL(buildStoreOffersUrl("a b&c", 0));
    expect(url.searchParams.get("dealer_ids")).toBe("a b&c");
    expect(url.searchParams.get("limit")).toBe(String(UPSTREAM_LIMIT));
    expect(url.searchParams.get("r_lat")).toBe(String(DENMARK_LOCATION.latitude));
  });

  it("returns only current offers from the dealer, in upstream order", async () => {
    const fetch = upstream([
      rawOffer({ id: "current1" }),
      futureRawOffer("future"),
      rawOffer({ id: "expired", run_till: "2026-10-01T00:00:00+0000" }),
      rawOffer({ id: "bilka", dealer_id: "93f13" }),
      { id: "malformed" },
      rawOffer({ id: "current2" }),
    ]);

    const page = await getStoreOffers({ dealerId: NETTO, limit: 50, offset: 0, now: NOW, fetch });

    expect(page.offers.map((o) => o.id)).toEqual(["current1", "current2"]);
    expect(page.nextOffset).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toBe(buildStoreOffersUrl(NETTO, 0));
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("stops at limit and continues right after the last offer examined", async () => {
    const fetch = upstream([futureRawOffer("f0"), ...currentOffers(150)]);

    const page = await getStoreOffers({ dealerId: NETTO, limit: 10, offset: 0, now: NOW, fetch });

    expect(page.offers.map((o) => o.id)).toEqual(Array.from({ length: 10 }, (_, i) => `o${i}`));
    expect(page.nextOffset).toBe(11);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts at the given offset", async () => {
    const fetch = upstream(currentOffers(30));
    const page = await getStoreOffers({ dealerId: NETTO, limit: 5, offset: 20, now: NOW, fetch });
    expect(page.offers.map((o) => o.id)).toEqual(["o20", "o21", "o22", "o23", "o24"]);
    expect(page.nextOffset).toBe(25);
    expect(requestedOffsets(fetch)).toEqual([20]);
  });

  it("fetches further pages to fill limit", async () => {
    const fetch = upstream([
      ...Array.from({ length: 95 }, (_, i) => futureRawOffer(`f${i}`)),
      ...currentOffers(5, "a"),
      ...currentOffers(100, "b"),
    ]);

    const page = await getStoreOffers({ dealerId: NETTO, limit: 50, offset: 0, now: NOW, fetch });

    expect(page.offers).toHaveLength(50);
    expect(page.offers[0]!.id).toBe("a0");
    expect(page.offers[49]!.id).toBe("b44");
    expect(page.nextOffset).toBe(145);
    expect(requestedOffsets(fetch)).toEqual([0, 100]);
  });

  it(`makes at most ${MAX_STORE_OFFER_REQUESTS} upstream requests per call`, async () => {
    const fetch = upstream([...Array.from({ length: 350 }, (_, i) => futureRawOffer(`f${i}`)), ...currentOffers(10)]);

    const page = await getStoreOffers({ dealerId: NETTO, limit: 50, offset: 0, now: NOW, fetch });

    expect(page).toEqual({ offers: [], nextOffset: 300 });
    expect(requestedOffsets(fetch)).toEqual([0, 100, 200]);
  });

  it("returns null nextOffset only when the upstream list is exhausted", async () => {
    const exactlyFull = upstream(currentOffers(100));
    const first = await getStoreOffers({ dealerId: NETTO, limit: 100, offset: 0, now: NOW, fetch: exactlyFull });
    expect(first.nextOffset).toBe(100);
    // A non-null nextOffset may lead to an empty, final page.
    expect(await getStoreOffers({ dealerId: NETTO, limit: 100, offset: 100, now: NOW, fetch: exactlyFull })).toEqual({
      offers: [],
      nextOffset: null,
    });

    const shortPage = upstream(currentOffers(30));
    const filledExactly = await getStoreOffers({ dealerId: NETTO, limit: 30, offset: 0, now: NOW, fetch: shortPage });
    expect(filledExactly.nextOffset).toBeNull();
    const filledMidPage = await getStoreOffers({ dealerId: NETTO, limit: 29, offset: 0, now: NOW, fetch: shortPage });
    expect(filledMidPage.nextOffset).toBe(29);
  });

  it.each([1, 7, 50, 100])("returns every current offer exactly once when following nextOffset (limit %i)", async (limit) => {
    const raw = Array.from({ length: 257 }, (_, i) => {
      if (i % 9 === 0) return futureRawOffer(`f${i}`);
      if (i % 13 === 0) return rawOffer({ id: `bilka${i}`, dealer_id: "93f13" });
      if (i % 17 === 0) return rawOffer({ id: `expired${i}`, run_till: "2026-10-01T00:00:00+0000" });
      return rawOffer({ id: `o${i}` });
    });
    const expected = raw.map((offer) => String(offer.id)).filter((id) => id.startsWith("o"));
    const fetch = upstream(raw);

    const seen: string[] = [];
    let offset: number | null = 0;
    for (let call = 0; offset !== null; call++) {
      expect(call).toBeLessThan(300);
      fetch.mockClear();
      const page: StoreOffersPage = await getStoreOffers({ dealerId: NETTO, limit, offset, now: NOW, fetch });
      expect(page.offers.length).toBeLessThanOrEqual(limit);
      const offsets = requestedOffsets(fetch);
      expect(offsets.length).toBeLessThanOrEqual(MAX_STORE_OFFER_REQUESTS);
      expect(new Set(offsets).size).toBe(offsets.length);
      seen.push(...page.offers.map((o) => o.id));
      offset = page.nextOffset;
    }

    expect(seen).toEqual(expected);
  });

  it("returns an empty, final page for an unknown dealer", async () => {
    const fetch = upstream([]);
    expect(await getStoreOffers({ dealerId: "unknown", limit: 50, offset: 0, now: NOW, fetch })).toEqual({
      offers: [],
      nextOffset: null,
    });
  });

  it.each([
    ["an HTTP error", () => new Response("down", { status: 502 }), /responded with HTTP 502/],
    ["a non-JSON response", () => new Response("<html>", { status: 200 }), /not valid JSON/],
    ["an unexpected JSON shape", () => jsonResponse({ offers: [] }), /unexpected response/],
    ["unrecognizable offers", () => jsonResponse([{ foo: 1 }]), /unexpected format/],
  ])("fails without partial results on %s for a later page", async (_name, failure, message) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([...currentOffers(5), ...Array.from({ length: 95 }, (_, i) => futureRawOffer(`f${i}`))]))
      .mockResolvedValueOnce(failure());
    await expect(getStoreOffers({ dealerId: NETTO, limit: 50, offset: 0, now: NOW, fetch })).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails with a timeout error when a page does not arrive in time", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(getStoreOffers({ dealerId: NETTO, limit: 50, offset: 0, now: NOW, fetch, timeoutMs: 20 })).rejects.toThrow(
      new UpstreamError("The offers service did not respond within 20 ms."),
    );
  });
});
