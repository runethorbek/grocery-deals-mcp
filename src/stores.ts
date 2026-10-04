import { z } from "zod";
import { dealerIdsParam, fetchUpstreamJson, UpstreamError } from "./upstream.js";

/** Upstream: Tjek / eTilbudsavis dealers, fetched by ID. */
export const DEALERS_URL = "https://squid-api.tjek.com/v2/dealers";

/**
 * Curated grocery scope for `list_stores`. The upstream lists dealers of all
 * kinds and cannot tell which are grocery stores, so the scope is kept here.
 * Store names still come from the upstream.
 */
export const GROCERY_DEALER_IDS: readonly string[] = [
  "DWZE1w", // 365discount
  "70d42L", // ABC Lavpris
  "93f13", // Bilka
  "d311fg", // Brugsen
  "5iH8sO", // Coop.dk MAD
  "bdf5A", // føtex
  "c1edq", // Kvickly
  "71c90", // Lidl
  "65caN", // Løvbjerg
  "267e1m", // MENY
  "603dfL", // Min Købmand
  "7Rwpw5", // nemlig
  "9ba51", // Netto
  "11deC", // REMA 1000
  "88ddE", // SPAR
  "0b1e8", // SuperBrugsen
];

/** Normalized store returned by `list_stores`. */
export interface Store {
  name: string;
  dealerId: string;
}

const upstreamDealerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});

export function buildDealersUrl(dealerIds: readonly string[] = GROCERY_DEALER_IDS): string {
  return `${DEALERS_URL}?${dealerIdsParam(dealerIds)}`;
}

/**
 * Normalizes an upstream dealers response into allowlisted stores sorted by
 * name, keeps those whose name contains `query` (case-insensitive) and returns
 * at most `limit`. Individual malformed dealers are skipped; a body that is not
 * an array, or a non-empty array without a single recognizable dealer, is
 * treated as an unexpected upstream response.
 */
export function selectStores(body: unknown, limit: number, query?: string): Store[] {
  if (!Array.isArray(body)) {
    throw new UpstreamError("The stores service returned an unexpected response.");
  }
  const dealers = body.flatMap((raw) => {
    const parsed = upstreamDealerSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  if (body.length > 0 && dealers.length === 0) {
    throw new UpstreamError("The stores service returned stores in an unexpected format.");
  }

  const allowed = new Set(GROCERY_DEALER_IDS);
  const seen = new Set<string>();
  const stores: Store[] = [];
  for (const dealer of dealers) {
    if (!allowed.has(dealer.id) || seen.has(dealer.id)) continue;
    seen.add(dealer.id);
    stores.push({ name: dealer.name, dealerId: dealer.id });
  }

  const needle = query?.toLocaleLowerCase("da");
  return stores
    .filter((store) => needle === undefined || store.name.toLocaleLowerCase("da").includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, "da") || a.dealerId.localeCompare(b.dealerId))
    .slice(0, limit);
}

export interface ListStoresOptions {
  limit: number;
  query?: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Lists the allowlisted grocery stores with their upstream names.
 * Throws `UpstreamError` for HTTP errors, timeouts, network failures and
 * malformed responses.
 */
export async function listStores(options: ListStoresOptions): Promise<Store[]> {
  const { limit, query, fetch, timeoutMs } = options;
  const body = await fetchUpstreamJson(buildDealersUrl(), { service: "stores service", fetch, timeoutMs });
  return selectStores(body, limit, query);
}
