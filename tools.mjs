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

const publicSport = z.enum(['nfl', 'nba', 'nhl', 'college-football', 'soccer-odds-api']);
const league = z.enum(['NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'MLB', 'EPL', 'MLS']);
const market = z.enum(['moneyline', 'spread', 'total']);
const limit = z.number().int().min(1).max(200).default(25);
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
    description: 'DraftKings moneyline, spread and total prices (read through ESPN odds data) for one sport, with the capture time of every row. No API key, no credits; cached up to five minutes, so check observed_at before treating a price as current.',
    input: {sport: publicSport},
    run: ({sport}, {fetcher}) => getJson(fetcher, `${ORIGIN}/api/public/boards/${sport}`),
  },
  {
    name: 'get_odds_board', keyless: true,
    title: 'Mixed upcoming-games odds board (no key)',
    description: 'The next DraftKings Sportsbook (New Jersey) prices across leagues, as shown on the getoddsapi.com homepage. No API key, no credits.',
    input: {},
    run: (_args, {fetcher}) => getJson(fetcher, `${ORIGIN}/api/public/odds-board`),
  },
  {
    name: 'get_sandbox_odds', keyless: true, pending: true,
    title: 'Keyless sandbox odds (no key)',
    description: 'Keyless sandbox read of stored odds for trying request shapes before signing up. Rate-limited per IP. Depends on the /api/v1/sandbox endpoints; if they are not live yet the tool says so and suggests get_public_board.',
    input: {sport: league.optional(), market: market.optional(), limit: z.number().int().min(1).max(50).default(10)},
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
    description: 'Create a free-tier key (1,000 requests a UTC day, 60 a minute, no card) for the user\'s own email address. Only call this when the user asked for a key and gave their email. The key is shown once: tell the user to store it as GETODDS_API_KEY. Depends on POST /api/v1/agent/signup.',
    input: {email: z.string().email().max(254), agent_name: z.string().max(80).optional(), use_case: z.string().max(500).optional()},
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
    description: 'DraftKings (via ESPN) stored game odds by league and market. Set fresh_only to drop rows not captured recently. One credit per successful call.',
    input: {sport: league.optional(), market: market.optional(), event_id: sourceId.optional(), fresh_only: z.boolean().default(true), limit, offset: z.number().int().min(0).max(10000).default(0)},
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/odds?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)}),
  },
  {
    name: 'search_events',
    title: 'Search events by team name',
    description: 'Literal, case-insensitive team-name search over retained events. Returns source-specific event ids for get_odds and get_line_history.',
    input: {q: z.string().trim().min(2).max(100), sport: league.optional(), limit},
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/events/search?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)}),
  },
  {
    name: 'get_line_history',
    title: 'Retained price changes for an event or offer',
    description: 'Retained price changes for one event_id or offer_id (DraftKings via ESPN). Not a complete tick history: it holds the changes GetOdds captured.',
    input: {event_id: sourceId.optional(), offer_id: sourceId.optional(), market: market.optional(), limit},
    run: (args, {fetcher, env}) => {
      if (!args.event_id && !args.offer_id) throw new ToolError('HISTORY_ID_REQUIRED', 'Pass event_id or offer_id (get one from search_events or get_odds).');
      return getJson(fetcher, `${ORIGIN}/api/v1/history?${qs({source: 'draftkings', ...args})}`, {key: needKey(env)});
    },
  },
  {
    name: 'get_pickem_lines',
    title: "Pick'em player lines",
    description: "Player prop thresholds from PrizePicks, Underdog or DraftKings Pick6 (source=draftkings), or FanDuel. Lines only; pick'em boards have no per-line odds. The key must have the source granted.",
    input: {source: z.enum(['prizepicks', 'underdog', 'draftkings', 'fanduel']).default('prizepicks'), limit},
    run: (args, {fetcher, env}) => getJson(fetcher, `${ORIGIN}/api/v1/markets?${qs(args)}`, {key: needKey(env)}),
  },
  {
    name: 'get_fanduel_markets',
    title: 'FanDuel native game markets',
    description: 'FanDuel native markets and selections by league. Filters keep FanDuel exact case. The key needs the fanduel source and FanDuel selected as a bookmaker in the dashboard.',
    input: {league: league.optional(), limit: z.number().int().min(1).max(100).default(25)},
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
