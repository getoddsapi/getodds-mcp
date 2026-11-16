# Changelog

All notable changes to this package. Dates are UTC.

## Unreleased

- Fix: `get_sandbox_odds` sent upper-case `sport`, `market` and `limit`, which the live sandbox rejects with HTTP 400. It now
  takes one required lower-case `sport` (nfl, nba, nhl, ncaaf, soccer, epl, mls) and returns rows.
- Every tool description says when to use it instead of its siblings and what the rows contain; every argument has a
  description. `get_fanduel_markets` gains `event_id`, `status` and `after` (the API already accepted them).
- Tool annotations add `destructiveHint: false` and `idempotentHint: true`.
- Dockerfile for container builds (Glama and other registries).

## 0.1.1 - 2026-11-15

- Published to npm as `getodds-mcp` and listed in the official MCP Registry as `com.getoddsapi/getodds`.
- Package metadata cleaned up for npm (bin, files, repository links).

## 0.1.0 - 2026-11-15

- First release: stdio MCP server with nine tools. Keyless: `get_public_board`, `get_odds_board`,
  `get_sandbox_odds`, `create_free_key`. With a free key: `get_odds`, `search_events`, `get_line_history`,
  `get_pickem_lines`, `get_fanduel_markets`.
