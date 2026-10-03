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

export const NOW = new Date("2026-10-03T12:00:00Z");

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
