export const DEFAULT_TIMEOUT_MS = 8_000;

/** Raised for any upstream failure; the message is safe to show to MCP clients. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Comma-separated list for an upstream `dealer_ids` parameter. Commas are kept
 * literal (as in the verified upstream requests); each ID is encoded.
 */
export function dealerIdsParam(dealerIds: readonly string[]): string {
  return `dealer_ids=${dealerIds.map(encodeURIComponent).join(",")}`;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export interface FetchUpstreamJsonOptions {
  /** Human-readable service name used in error messages, e.g. "offers service". */
  service: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * GETs `url` and returns the parsed JSON body.
 * Throws `UpstreamError` for HTTP errors, timeouts, network failures and
 * non-JSON responses. The body's shape is left to the caller to validate.
 */
export async function fetchUpstreamJson(url: string, options: FetchUpstreamJsonOptions): Promise<unknown> {
  const { service, fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new UpstreamError(`The ${service} did not respond within ${timeoutMs} ms.`);
    }
    throw new UpstreamError(`Could not reach the ${service}.`);
  }

  if (!response.ok) {
    throw new UpstreamError(`The ${service} responded with HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch (error) {
    if (isTimeout(error)) {
      throw new UpstreamError(`The ${service} did not respond within ${timeoutMs} ms.`);
    }
    throw new UpstreamError(`The ${service} returned a response that is not valid JSON.`);
  }
}
