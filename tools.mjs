/**
 * GetOdds MCP tools. Pure request logic with an injectable fetch, so tests run offline.
 * Keyless tools never send a key. Keyed tools read GETODDS_API_KEY from the environment only.
 */
import {z} from 'zod';

export const ORIGIN = 'https://getoddsapi.com';
const MAX_BYTES = 2 * 1024 * 1024;
const SIGNUP_URL = 'https://getoddsapi.com/sign-up';

export class ToolError extends Error {
  constructor(code, message, status = 0, retryAfter = null) {
    super(message); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

async function getJson(fetcher, url, {key, method = 'GET', body} = {}) {
  const headers = {Accept: 'application/json', 'User-Agent': 'getodds-mcp/0.1.0'};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetcher(url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(20000)});
  } catch { throw new ToolError('NETWORK_ERROR', 'Could not reach getoddsapi.com.'); }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new ToolError('RESPONSE_TOO_LARGE', 'Response was larger than 2 MiB; narrow the request.');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const retryAfter = retry && /^\d{1,6}$/.test(retry) ? Number(retry) : null;
    // The API's own error bodies carry user_message / agent_next_step guidance; pass those through, nothing else.
    const err = json && typeof json === 'object' ? json.error : null;
    const hint = err && typeof err === 'object'
      ? [err.user_message ?? err.message, err.agent_next_step].filter(x => typeof x === 'string').join(' ')
      : '';
    throw new ToolError(err?.code ?? 'HTTP_ERROR', hint || `GetOdds returned HTTP ${response.status}.`, response.status, retryAfter);
  }
  if (json === null || typeof json !== 'object') throw new ToolError('INVALID_RESPONSE', 'GetOdds returned an unexpected body.');
  return json;
}

const publicSport = z.enum(['nfl', 'nba', 'nhl', 'college-football', 'soccer-odds-api'])
  .describe('Board slug: nfl, nba, nhl, college-football or soccer-odds-api.');
const league = z.enum(['NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'MLB', 'EPL', 'MLS']);
const sportFilter = league.optional().describe('League code in upper case, for example NBA. Omit for every league.');
const market = z.enum(['moneyline', 'spread', 'total']).optional().describe('Market: moneyline, spread or total. Omit for all three.');
const limit = z.number().int().min(1).max(200).default(25).describe('Rows to return, 1 to 200 (default 25).');
const offset = z.number().int().min(0).max(10000).default(0).describe('Rows to skip for the next page (default 0). Offset pages are not a frozen snapshot.');
const sourceId = z.string().regex(/^[-A-Za-z0-9_:]{1,180}$/);

function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
  return q.toString();
}

function needKey(env) {
  const key = env.GETODDS_API_KEY;
  if (!key || /\s/.test(key)) throw new ToolError('API_KEY_REQUIRED',
    `This tool needs a GetOdds key in GETODDS_API_KEY. Create a free one (1,000 requests a day, no card) at ${SIGNUP_URL} ` +
    'or with the create_free_key tool, then restart the MCP server. The keyless tools get_public_board and get_odds_board work without one.');
  return key;
}

/**
 * Tool table. `keyless` tools need no account. `pending` marks tools that call endpoints still rolling out
 * (POST /api/v1/agent/signup and /api/v1/sandbox/*); on 404 they explain and point to the keyless boards.
 */
export const tools = [
  {
    name: 'get_public_board', keyless: true,
    title: 'Public odds board for one sport (no key)',
    description: 'DraftKings moneyline, spread and total prices (read through ESPN odds data) for one sport, each row with observed_at. ' +
      'Use it for a keyless price check on one sport; get_odds_board mixes the next games across leagues, and get_odds (keyed) adds filters and paging. ' +
      'No API key, no credits; cached up to five minutes, so check observed_at before calling a price current.',
    input: {sport: publicSport},
    run: ({sport}, {fetcher}) => getJson(fetcher, `${ORIGIN}/api/public/boards/${sport}`),
  },
  {
    name: 'get_odds_board', keyless: true,
    title: 'Mixed upcoming-games odds board (no key)',
    description: 'The next DraftKings Sportsbook (New Jersey) prices across all leagues, soonest first: event, league, start time, market, selection, line, American odds and received_at. ' +
      'Use it for "what games are coming up and at what price" with no key; for one sport use get_public_board. No API key, no credits; takes no arguments.',
    input: {},
    run: (_args, {fetcher}) => getJson(fetcher, `${ORIGIN}/api/public/odds-board`),
  },
  {
    name: 'get_sandbox_odds', keyless: true, pending: true,
    title: 'Keyless sandbox odds (no key)',
    description: 'Real stored DraftKings (via ESPN) moneyline, spread and total rows for one sport, from a cache up to five minutes old, at most 50 rows, ' +
      'in the same row shape as the keyed get_odds. Use it to try the API response before the user has a key. No key; 10 requests a minute and 100 a day per network address.',
    input: {sport: z.enum(['nfl', 'nba', 'nhl', 'ncaaf', 'soccer', 'epl', 'mls']).describe('Sport in lower case: nfl, nba, nhl, ncaaf, soccer, epl or mls.')},
    run: async (args, {fetcher}) => {
      try { return await getJson(fetcher, `${ORIGIN}/api/v1/sandbox/odds?${qs(args)}`); }
      catch (e) {
        if (e.status === 404) throw new ToolError('SANDBOX_NOT_AVAILABLE', 'The keyless sandbox is not live on getoddsapi.com yet. Use get_public_board for keyless prices.', 404);
        throw e;
      }
    },
  },
  {
    name: 'create_free_key', keyless: true, pending: true,
    title: 'Create a free GetOdds key by email',
    description: 'Create a free-tier GetOdds key (1,000 requests a UTC day, 60 a minute, no card) for the user\'s own email address. ' +
      'Only call it when the user asked for a key and gave their email; one key per email, and disposable domains are refused. ' +
      'The key is returned once and no email is sent: tell the user to store it as GETODDS_API_KEY and restart the server. Calling again with the same email does not create a second key.',
    input: {
      email: z.string().email().max(254).describe('The user\'s own email address, as they gave it.'),
      agent_name: z.string().max(80).optional().describe('Name of the agent or app making the request, for example "Claude Desktop".'),
      use_case: z.string().max(500).optional().describe('One sentence on what the user wants the odds for. No personal data.'),
    },
    run: async (args, {fetcher}) => {
      try { return await getJson(fetcher, `${ORIGIN}/api/v1/agent/signup`, {method: 'POST', body: args}); }
      catch (e) {
        if (e.status === 404) throw new ToolError('SIGNUP_NOT_AVAILABLE', `Agent signup is not live yet. The user can create a free key at ${SIGNUP_URL}.`, 404);
        throw e;
      }
    },
  },
  {
    name: 'get_odds',
    title: 'Stored sportsbook odds',
    description: 'Stored DraftKings (via ESPN) game odds by league, market or event: one row per side with line, American and decimal price and capture time. ' +
      'Use it for current game prices with filters and paging; use get_line_history for how a price moved and search_events to find an event_id. ' +
      'Needs GETODDS_API_KEY; one request per successful call.',
    input: {
      sport: sportFilter,
      market,
      event_id: sourceId.optional().describe('One event_id from search_events or a previous row.'),
      fresh_only: z.boolean().default(true).describe('true (default) drops rows not captured recently; false includes older retained rows.'),
      limit,
      offset,
    },
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/odds?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)}),
  },
  {
    name: 'search_events',
    title: 'Search events by team name',
    description: 'Find games by team name: literal, case-insensitive substring match over home and away names in retained events, which can include past games. ' +
      'Returns event ids, teams and start times to pass to get_odds or get_line_history; it returns no prices. Needs GETODDS_API_KEY.',
    input: {
      q: z.string().trim().min(2).max(100).describe('Part of a team name, at least 2 characters, for example "Lakers".'),
      sport: sportFilter,
      limit,
    },
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/events/search?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)}),
  },
  {
    name: 'get_line_history',
    title: 'Retained price changes for an event or offer',
    description: 'Every retained DraftKings (via ESPN) price change for one event or one offer, newest first, each with its capture time. ' +
      'Use it for "how has this line moved"; pass event_id or offer_id (one is required) from search_events or get_odds. ' +
      'Captured changes only, not a complete tick tape: gaps are not reconstructed. Needs GETODDS_API_KEY.',
    input: {
      event_id: sourceId.optional().describe('One event_id from search_events or get_odds. Pass this or offer_id.'),
      offer_id: sourceId.optional().describe('One offer_id from a get_odds row, to follow a single market side.'),
      market,
      limit,
    },
    run: (args, {fetcher, env}) => {
      if (!args.event_id && !args.offer_id) throw new ToolError('HISTORY_ID_REQUIRED', 'Pass event_id or offer_id (get one from search_events or get_odds).');
      return getJson(fetcher, `${ORIGIN}/api/v1/history?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)});
    },
  },
  {
    name: 'get_pickem_lines',
    title: "Pick'em player lines",
    description: "Player prop thresholds (player, stat, line) from one pick'em source: PrizePicks, Underdog, DraftKings Pick6 (source=draftkings) or FanDuel. " +
      "Lines only: pick'em boards carry no per-line odds, so use get_odds for sportsbook prices. A sample, not a complete board. " +
      'Needs GETODDS_API_KEY with that source granted (free keys have every source).',
    input: {
      source: z.enum(['prizepicks', 'underdog', 'draftkings', 'fanduel']).default('prizepicks').describe("Pick'em source: prizepicks (default), underdog, draftkings (Pick6) or fanduel."),
      limit,
    },
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/markets?${qs(args)}`, {key: needKey(env)}),
  },
  {
    name: 'get_fanduel_markets',
    title: 'FanDuel native game markets',
    description: 'Stored FanDuel Sportsbook markets with their selections and prices, in FanDuel\'s own ids and names, with the time each was seen. ' +
      'Use it for FanDuel prices specifically; get_odds covers DraftKings. Statuses and null prices are kept as FanDuel showed them, and rows are not matched to other books. ' +
      'Pages are ordered by market id: pass the last market_id as after for the next page. Needs GETODDS_API_KEY with FanDuel selected as a bookmaker in the dashboard; one request per page.',
    input: {
      league: league.optional().describe('League code in upper case, for example NFL. Omit for every league.'),
      event_id: z.string().max(180).optional().describe('One FanDuel event id from a previous row.'),
      status: z.enum(['open', 'suspended', 'closed', 'removed']).optional().describe('Market status. Omit for all.'),
      after: z.string().max(180).optional().describe('The last market_id of the previous page, for the next page.'),
      limit: z.number().int().min(1).max(100).default(25).describe('Rows to return, 1 to 100 (default 25).'),
    },
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/sportsbook/markets?${qs({source: 'fanduel', ...args})}`, {key: needKey(env)}),
  },
];

/** Run one tool by name with validated input. Returns parsed JSON. */
export async function runTool(name, rawArgs = {}, {fetcher = globalThis.fetch, env = process.env} = {}) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new ToolError('UNKNOWN_TOOL', `No tool named ${name}.`);
  const args = z.object(tool.input).strict().parse(rawArgs ?? {});
  return tool.run(args, {fetcher, env});
}
