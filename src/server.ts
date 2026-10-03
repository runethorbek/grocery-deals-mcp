import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { searchOffers, UpstreamError, type Offer } from "./offers.js";

export interface ServerDependencies {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  timeoutMs?: number;
}

const defaultDependencies: ServerDependencies = {
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
};

const rangeSchema = z.number().nullable();

const offerSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  previousPrice: z.number().nullable(),
  currency: z.string(),
  quantity: z
    .object({
      unit: z.string().nullable(),
      sizeFrom: rangeSchema,
      sizeTo: rangeSchema,
      piecesFrom: rangeSchema,
      piecesTo: rangeSchema,
    })
    .nullable(),
  storeName: z.string().nullable(),
  dealerId: z.string(),
  validFrom: z.string(),
  validUntil: z.string(),
});

export function createServer(deps: ServerDependencies = defaultDependencies): McpServer {
  const server = new McpServer({ name: "grocery-deals-mcp", version: "0.1.0" });

  server.registerTool(
    "search_deals",
    {
      title: "Search grocery deals",
      description:
        "Search grocery offers in Denmark that are valid right now. " +
        "Returns normalized offers with price, previous price, quantity, store and validity period.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1, "query must not be empty")
          .describe('Product search term, e.g. "hakket oksekød".'),
        limit: z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be between 1 and 50")
          .max(50, "limit must be between 1 and 50")
          .default(10)
          .describe("Maximum number of offers to return (1-50, default 10)."),
      },
      outputSchema: { offers: z.array(offerSchema) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }): Promise<CallToolResult> => {
      let offers: Offer[];
      try {
        offers = await searchOffers({
          query,
          limit,
          now: deps.now(),
          fetch: deps.fetch,
          timeoutMs: deps.timeoutMs,
        });
      } catch (error) {
        const message =
          error instanceof UpstreamError
            ? error.message
            : "Unexpected error while searching the offers service.";
        return { isError: true, content: [{ type: "text", text: `search_deals failed: ${message}` }] };
      }
      const structuredContent = { offers };
      return {
        structuredContent,
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      };
    },
  );

  return server;
}
