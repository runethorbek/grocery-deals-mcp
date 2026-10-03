# Terminology

## Offer
A specific grocery promotion returned by the upstream API.

Example:
"500 g hakket oksekød - 35 DKK at Netto"

## Deal
User-facing synonym for an offer.

Within code, prefer `Offer` when representing upstream offer data.

## Store
The grocery chain as understood by users, e.g. Netto, REMA 1000, Lidl.

## Dealer
The upstream Tjek/eTilbudsavis concept used to identify a store/retailer.

Use `dealerId` when referring to the upstream identifier.

## Search query
A grocery product search term sent to the upstream API.

Example:
`hakket oksekød`

## MCP tool
A capability exposed to an MCP client, such as `search_deals`.

## Upstream API
The external Tjek/eTilbudsavis API from which grocery offer data is retrieved.

## MCP client
The AI application connecting to this server, e.g. ChatGPT, Claude, or another MCP-compatible client.
