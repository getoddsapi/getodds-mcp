#!/usr/bin/env node
/** GetOdds MCP server over stdio. Configure GETODDS_API_KEY for keyed tools; keyless tools work without it. */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {tools, runTool, ToolError} from './tools.mjs';

export function createServer({fetcher = globalThis.fetch, env = process.env} = {}) {
  const server = new McpServer({name: 'getodds', version: '0.1.0'}, {
    instructions: 'GetOdds sports odds API. get_public_board, get_odds_board and get_sandbox_odds need no key. Other tools need GETODDS_API_KEY ' +
      '(free at https://getoddsapi.com/sign-up). Every row has a capture time; check it before calling a price current. ' +
      'Coverage: DraftKings, FanDuel, BetRivers sportsbook prices; PrizePicks, Underdog, DraftKings Pick6 lines.',
  });
  for (const tool of tools) {
    server.registerTool(tool.name, {title: tool.title, description: tool.description, inputSchema: tool.input,
      annotations: {readOnlyHint: tool.name !== 'create_free_key', destructiveHint: false,
        idempotentHint: true, openWorldHint: true}}, async args => {
      try {
        const result = await runTool(tool.name, args, {fetcher, env});
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (e) {
        const message = e instanceof ToolError ? `${e.code}: ${e.message}${e.retryAfter ? ` Retry after ${e.retryAfter}s.` : ''}` : `INVALID_INPUT: ${e.message}`;
        return {isError: true, content: [{type: 'text', text: message}]};
      }
    });
  }
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('getodds-mcp')) {
  await createServer().connect(new StdioServerTransport());
}
