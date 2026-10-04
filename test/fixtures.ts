/** Builds a raw upstream offer shaped like the Tjek offers search response. */
export function rawOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "abc123",
    ern: "ern:offer:abc123",
    heading: "Hakket oksekød 8-12%",
    description: "400 g / pk. Pr. kg 74,88",
    catalog_page: 3,
    pricing: { price: 29.95, pre_price: 39.95, currency: "DKK" },
    quantity: {
      unit: { symbol: "g", si: { symbol: "kg", factor: 0.001 } },
      size: { from: 400, to: 400 },
      pieces: { from: 1, to: 1 },
    },
    images: { view: "https://example.test/view.jpg", zoom: "https://example.test/zoom.jpg" },
    run_from: "2026-09-28T22:00:00+0000",
    run_till: "2026-10-04T21:59:59+0000",
    dealer_id: "9ba51",
    dealer: { id: "9ba51", ern: "ern:dealer:9ba51", name: "Netto", logo: "https://example.test/logo.png" },
    store_id: null,
    ...overrides,
  };
}

/** Builds a raw upstream dealer shaped like the Tjek dealers response. */
export function rawDealer(id: string, name: string): Record<string, unknown> {
  return {
    id,
    ern: `ern:dealer:${id}`,
    name,
    website: "https://example.test",
    logo: "https://example.test/logo.png",
    color: "FFFFFF",
    markets: [{ country_code: "DK" }],
    category_ids: [],
  };
}

/** Upstream dealers for the whole grocery allowlist, in unsorted order. */
export function rawGroceryDealers(): Record<string, unknown>[] {
  return [
    rawDealer("9ba51", "Netto"),
    rawDealer("0b1e8", "SuperBrugsen"),
    rawDealer("DWZE1w", "365discount"),
    rawDealer("bdf5A", "føtex"),
    rawDealer("11deC", "REMA 1000"),
    rawDealer("70d42L", "ABC Lavpris"),
    rawDealer("93f13", "Bilka"),
    rawDealer("d311fg", "Brugsen"),
    rawDealer("5iH8sO", "Coop.dk MAD"),
    rawDealer("c1edq", "Kvickly"),
    rawDealer("71c90", "Lidl"),
    rawDealer("65caN", "Løvbjerg"),
    rawDealer("267e1m", "MENY"),
    rawDealer("603dfL", "Min Købmand"),
    rawDealer("7Rwpw5", "nemlig"),
    rawDealer("88ddE", "SPAR"),
  ];
}

export const NOW = new Date("2026-10-03T12:00:00Z");

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stubbed, stable upstream offers list: answers each request with the slice of
 * `rawOffers` given by its `offset` and `limit` parameters.
 */
export function pagedOffersUpstream(rawOffers: readonly unknown[]): typeof globalThis.fetch {
  return async (input) => {
    const params = new URL(String(input)).searchParams;
    const offset = Number(params.get("offset"));
    return jsonResponse(rawOffers.slice(offset, offset + Number(params.get("limit"))));
  };
}

/** An offer of the given dealer that has not started yet at `NOW`. */
export function futureRawOffer(id: string, dealerId = "9ba51"): Record<string, unknown> {
  return rawOffer({ id, dealer_id: dealerId, run_from: "2026-10-04T22:00:00+0000", run_till: "2026-10-10T21:59:59+0000" });
}
