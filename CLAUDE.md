# Grocery Deals MCP

## Purpose
Expose Nordic grocery deal data as remote MCP tools.

The server is a thin capability layer around external grocery deal APIs.
It should not own recipes, meal planning, pantry data, or personal user data.

## Architecture

MCP client
  -> Remote MCP endpoint on Vercel
  -> Grocery deal tools
  -> Tjek / eTilbudsavis API

## Principles

- Prefer small vertical slices over framework building.
- Keep the MCP API independent of any specific AI client.
- Keep domain data such as recipes outside this service.
- Normalize upstream API responses before exposing them as MCP results.
- Do not expose unnecessary Tjek-specific implementation details.
- Add abstractions only when there are at least two concrete uses for them.
- Keep tools deterministic where possible.
- Treat external API failures explicitly.

## Development

- TypeScript
- Official MCP SDK
- Vercel deployment
- Tests for tool/domain behavior
- Follow the acceptance criteria in the GitHub issue being implemented.
