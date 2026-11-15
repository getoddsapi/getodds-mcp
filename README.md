# getodds-mcp

MCP server (stdio) for the [GetOdds sports odds API](https://getoddsapi.com). It gives Claude, Cursor, VS Code and
any MCP client tools for DraftKings, FanDuel and BetRivers sportsbook prices and PrizePicks, Underdog and DraftKings
Pick6 pick'em lines, with the capture time on every row.

Two tools work with no account at all. The rest need a free key (1,000 requests a UTC day, 60 a minute, no card)
from <https://getoddsapi.com/sign-up>.

## Install

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`) and most clients:

```json
{
  "mcpServers": {
    "getodds": {
      "command": "npx",
      "args": ["-y", "getodds-mcp"],
      "env": { "GETODDS_API_KEY": "your key, or leave this out for the keyless tools" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add getodds -e GETODDS_API_KEY=$GETODDS_API_KEY -- npx -y getodds-mcp
```

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "getodds": { "type": "stdio", "command": "npx", "args": ["-y", "getodds-mcp"],
  "env": { "GETODDS_API_KEY": "${input:getodds-key}" } } },
  "inputs": [{ "id": "getodds-key", "type": "promptString", "password": true, "description": "GetOdds API key" }] }
```

Prefer no local process? The same data is on the hosted server `https://getoddsapi.com/api/mcp` (streamable HTTP,
`Authorization: Bearer <key>`). Configs for eight clients: <https://getoddsapi.com/mcp>.

## Tools

| Tool | Key | What it returns |
| --- | --- | --- |
| `get_public_board` | none | DraftKings moneyline, spread, total for nfl, nba, nhl, college-football or soccer-odds-api (cached up to 5 min) |
| `get_odds_board` | none | Next DraftKings Sportsbook (NJ) prices across leagues |
| `get_sandbox_odds` | none | Keyless sandbox reads, rate-limited per IP (rolling out: until `/api/v1/sandbox` is live it says so) |
| `create_free_key` | none | Free key for the user's own email (rolling out: until `POST /api/v1/agent/signup` is live it links the sign-up page) |
| `get_odds` | free key | Stored DraftKings (via ESPN) odds by league, market, event; `fresh_only` on by default |
| `search_events` | free key | Team-name search returning event ids |
| `get_line_history` | free key | Retained price changes for an event or offer |
| `get_pickem_lines` | free key + source | PrizePicks, Underdog, Pick6 (`draftkings`) or FanDuel thresholds |
| `get_fanduel_markets` | free key + fanduel | FanDuel native game markets |

A successful keyed call uses one credit; failed calls use none. Errors come back as tool errors with the API's own
next step (for example the daily limit and its `Retry-After`).

## Example

Real output from `get_public_board` with `{"sport": "nfl"}` on 15 Nov 2026 (rows trimmed):

```
nfl board available DraftKings via ESPN 2026-11-15T05:50:02.275Z rows 24
  Miami Dolphins @ Indianapolis Colts moneyline away null 180 2026-11-15T05:37:38.309Z
  Miami Dolphins @ Indianapolis Colts moneyline home null -218 2026-11-15T05:37:38.309Z
  Miami Dolphins @ Indianapolis Colts spread away 4.5 -112 2026-11-15T05:37:38.309Z
```

Prompts that work: "What are tonight's NBA moneylines on DraftKings, and when were they captured?",
"Show Underdog's lines for the next NFL game", "Has the Lions spread moved today?" (needs a key).

## Develop

```sh
npm install
npm test          # offline: mocked fetch plus an in-memory MCP client
node server.mjs   # stdio
```

`server.json` is the MCP Registry entry (`com.getoddsapi/getodds`).

GetOdds is an independent developer product, not affiliated with any sportsbook. Operated by Stunning Couches LLC.
MIT licensed.
