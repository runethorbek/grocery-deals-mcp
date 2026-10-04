import { z } from "zod";
import { dealerIdsParam, fetchUpstreamJson, UpstreamError } from "./upstream.js";

export { UpstreamError };

/**
 * Upstream: Tjek / eTilbudsavis offers search.
 * The endpoint is undocumented for public use, so its response is validated
 * defensively and never exposed as-is.
 */
export const OFFERS_SEARCH_URL = "https://squid-api.tjek.com/v2/offers/search";

/** Upstream: Tjek / eTilbudsavis offers list, used to page through one dealer's offers. */
export const OFFERS_LIST_URL = "https://squid-api.tjek.com/v2/offers";

/**
 * Every upstream request is scoped to Denmark: a central Danish coordinate
 * with a radius large enough to cover the whole country, including Bornholm.
 */
export const DENMARK_LOCATION = {
  latitude: 56.0,
  longitude: 10.5,
  radiusMeters: 350_000,
} as const;

/**
 * Number of offers requested upstream regardless of the tool `limit`.
 * The upstream search can include offers that have not started yet or have
 * expired, so we over-fetch and filter locally before applying `limit`.
 */
export const UPSTREAM_LIMIT = 100;

/** Normalized, Tjek-independent offer returned by `search_deals`. */
export interface Offer {
  id: string;
  title: string;
  description: string | null;
  price: number;
  previousPrice: number | null;
  currency: string;
  quantity: OfferQuantity | null;
  storeName: string | null;
  dealerId: string;
  validFrom: string;
  validUntil: string;
}

export interface OfferQuantity {
  unit: string | null;
  sizeFrom: number | null;
  sizeTo: number | null;
  piecesFrom: number | null;
  piecesTo: number | null;
}

const range = z
  .object({ from: z.number().nullish(), to: z.number().nullish() })
  .nullish();

const upstreamOfferSchema = z.object({
  id: z.string().min(1),
  heading: z.string(),
  description: z.string().nullish(),
  pricing: z.object({
    price: z.number(),
    pre_price: z.number().nullish(),
    currency: z.string().min(1),
  }),
  quantity: z
    .object({
      unit: z.object({ symbol: z.string().nullish() }).nullish(),
      size: range,
      pieces: range,
    })
    .nullish(),
  run_from: z.string(),
  run_till: z.string(),
  dealer_id: z.string().min(1),
  dealer: z.object({ name: z.string().nullish() }).nullish(),
});

type UpstreamOffer = z.infer<typeof upstreamOfferSchema>;

function toIsoTimestamp(value: string): string | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function normalizeQuantity(quantity: UpstreamOffer["quantity"]): OfferQuantity | null {
  const normalized: OfferQuantity = {
    unit: quantity?.unit?.symbol ?? null,
    sizeFrom: quantity?.size?.from ?? null,
    sizeTo: quantity?.size?.to ?? null,
    piecesFrom: quantity?.pieces?.from ?? null,
    piecesTo: quantity?.pieces?.to ?? null,
  };
  return Object.values(normalized).every((value) => value === null) ? null : normalized;
}

/**
 * Converts one raw upstream offer into a normalized `Offer`.
 * Returns null when the raw value does not have the expected shape.
 */
export function normalizeOffer(raw: unknown): Offer | null {
  const parsed = upstreamOfferSchema.safeParse(raw);
  if (!parsed.success) return null;
  const offer = parsed.data;

  const validFrom = toIsoTimestamp(offer.run_from);
  const validUntil = toIsoTimestamp(offer.run_till);
  if (validFrom === null || validUntil === null) return null;

  return {
    id: offer.id,
    title: offer.heading,
    description: offer.description ?? null,
    price: offer.pricing.price,
    previousPrice: offer.pricing.pre_price ?? null,
    currency: offer.pricing.currency,
    quantity: normalizeQuantity(offer.quantity),
    storeName: offer.dealer?.name ?? null,
    dealerId: offer.dealer_id,
    validFrom,
    validUntil,
  };
}

/** True when the offer is valid at `now` (validFrom <= now <= validUntil). */
export function isValidAt(offer: Offer, now: Date): boolean {
  const time = now.getTime();
  return Date.parse(offer.validFrom) <= time && time <= Date.parse(offer.validUntil);
}

/**
 * Normalizes every entry of an upstream offers response body, keeping each
 * entry's position (malformed entries become null). A body that is not an
 * array, or a non-empty array without a single recognizable offer, is treated
 * as an unexpected upstream response.
 */
function normalizeOfferList(body: unknown): Array<Offer | null> {
  if (!Array.isArray(body)) {
    throw new UpstreamError("The offers service returned an unexpected response.");
  }
  const offers = body.map(normalizeOffer);
  if (body.length > 0 && offers.every((offer) => offer === null)) {
    throw new UpstreamError("The offers service returned offers in an unexpected format.");
  }
  return offers;
}

/**
 * Normalizes an upstream response body and keeps only offers valid at `now`
 * (and, when `dealerIds` is given, only offers from those dealers), up to
 * `limit`. Individual malformed offers are skipped; a body that is not an
 * array, or a non-empty array without a single recognizable offer, is
 * treated as an unexpected upstream response.
 */
export function selectCurrentOffers(
  body: unknown,
  now: Date,
  limit: number,
  dealerIds?: readonly string[],
): Offer[] {
  const offers = normalizeOfferList(body).filter((offer): offer is Offer => offer !== null);
  const dealers = dealerIds === undefined ? null : new Set(dealerIds);
  return offers
    .filter((offer) => isValidAt(offer, now) && (dealers === null || dealers.has(offer.dealerId)))
    .slice(0, limit);
}

export function buildSearchUrl(query: string, dealerIds?: readonly string[]): string {
  const url = new URL(OFFERS_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(UPSTREAM_LIMIT));
  url.searchParams.set("r_lat", String(DENMARK_LOCATION.latitude));
  url.searchParams.set("r_lng", String(DENMARK_LOCATION.longitude));
  url.searchParams.set("r_radius", String(DENMARK_LOCATION.radiusMeters));
  const base = url.toString();
  return dealerIds === undefined ? base : `${base}&${dealerIdsParam(dealerIds)}`;
}

export interface SearchOffersOptions {
  query: string;
  limit: number;
  /** When given, only offers from these dealers are requested and returned. */
  dealerIds?: readonly string[];
  now: Date;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Searches Danish offers valid at `now`.
 * Throws `UpstreamError` for HTTP errors, timeouts, network failures and
 * malformed responses.
 */
export async function searchOffers(options: SearchOffersOptions): Promise<Offer[]> {
  const { query, limit, dealerIds, now, fetch, timeoutMs } = options;
  const body = await fetchUpstreamJson(buildSearchUrl(query, dealerIds), {
    service: "offers service",
    fetch,
    timeoutMs,
  });
  return selectCurrentOffers(body, now, limit, dealerIds);
}

/** Maximum number of upstream pages requested by one `getStoreOffers` call. */
export const MAX_STORE_OFFER_REQUESTS = 3;

/**
 * Upstream list of one dealer's offers in catalog page order, one page of
 * `UPSTREAM_LIMIT` offers starting at position `offset`.
 */
export function buildStoreOffersUrl(dealerId: string, offset: number): string {
  const params = new URLSearchParams({
    order_by: "page",
    limit: String(UPSTREAM_LIMIT),
    offset: String(offset),
    r_lat: String(DENMARK_LOCATION.latitude),
    r_lng: String(DENMARK_LOCATION.longitude),
    r_radius: String(DENMARK_LOCATION.radiusMeters),
  });
  return `${OFFERS_LIST_URL}?${dealerIdsParam([dealerId])}&${params}`;
}

export interface StoreOffersPage {
  offers: Offer[];
  /** Position to continue from in a follow-up call; null when the upstream list is exhausted. */
  nextOffset: number | null;
}

export interface GetStoreOffersOptions {
  dealerId: string;
  limit: number;
  /** Position in the dealer's upstream offer list, which also contains non-current offers. */
  offset: number;
  now: Date;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Returns up to `limit` offers from one dealer that are valid at `now`, in
 * upstream order, starting at upstream position `offset`. Consecutive upstream
 * pages are fetched until `limit` is reached, the list ends (a short page) or
 * `MAX_STORE_OFFER_REQUESTS` pages were requested. `nextOffset` is the
 * position right after the last offer examined.
 * Throws `UpstreamError` for HTTP errors, timeouts, network failures and
 * malformed responses on any page; no partial result is returned.
 */
export async function getStoreOffers(options: GetStoreOffersOptions): Promise<StoreOffersPage> {
  const { dealerId, limit, offset, now, fetch, timeoutMs } = options;
  const offers: Offer[] = [];
  let position = offset;

  for (let request = 0; request < MAX_STORE_OFFER_REQUESTS; request++) {
    const body = await fetchUpstreamJson(buildStoreOffersUrl(dealerId, position), {
      service: "offers service",
      fetch,
      timeoutMs,
    });
    const page = normalizeOfferList(body);
    const exhausted = page.length < UPSTREAM_LIMIT;

    for (const [index, offer] of page.entries()) {
      if (offer === null || offer.dealerId !== dealerId || !isValidAt(offer, now)) continue;
      offers.push(offer);
      if (offers.length === limit) {
        const examinedWholePage = index === page.length - 1;
        return { offers, nextOffset: exhausted && examinedWholePage ? null : position + index + 1 };
      }
    }

    if (exhausted) return { offers, nextOffset: null };
    position += page.length;
  }

  return { offers, nextOffset: position };
}
