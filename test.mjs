import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {tools, runTool} from './tools.mjs';
import {createServer} from './server.mjs';

const board = {state: 'available', checked_at: '2026-11-15T05:49:50.185Z', source: 'DraftKings via ESPN',
  rows: [{sport: 'NBA', home: 'Philadelphia 76ers', away: 'Indiana Pacers', market: 'moneyline', side: 'away', american: 235, line: null}]};
const recorder = (respond) => { const calls = []; const fetcher = async (url, init) => { calls.push({url, init}); return respond(url, init); }; return {calls, fetcher}; };

test('keyless board tools send no key and hit fixed public URLs', async () => {
  const {calls, fetcher} = recorder(() => Response.json(board));
  assert.equal((await runTool('get_public_board', {sport: 'nba'}, {fetcher, env: {GETODDS_API_KEY: 'go_live_secret'}})).rows[0].american, 235);
  await runTool('get_odds_board', {}, {fetcher, env: {}});
  assert.deepEqual(calls.map(c => c.url), ['https://getoddsapi.com/api/public/boards/nba', 'https://getoddsapi.com/api/public/odds-board']);
  for (const c of calls) { assert.equal(c.init.headers.Authorization, undefined); assert.equal(c.init.redirect, 'error'); }
});

test('keyed tools refuse without a key, before any request, and point to signup', async () => {
  const {calls, fetcher} = recorder(() => { throw Error('must not fetch'); });
  await assert.rejects(runTool('get_odds', {sport: 'NBA'}, {fetcher, env: {}}), e => e.code === 'API_KEY_REQUIRED' && /sign-up/.test(e.message));
  assert.equal(calls.length, 0);
});

test('keyed tools send the bearer key in a header and the right source, never in the URL', async () => {
  const {calls, fetcher} = recorder(() => Response.json({request_id: 'r', data: [], meta: {}}));
  const env = {GETODDS_API_KEY: 'go_live_fixture'};
  await runTool('get_odds', {sport: 'NFL', market: 'spread'}, {fetcher, env});
  await runTool('get_pickem_lines', {source: 'underdog', limit: 5}, {fetcher, env});
  await runTool('get_fanduel_markets', {league: 'NBA'}, {fetcher, env});
  const urls = calls.map(c => new URL(c.url));
  assert.deepEqual(urls.map(u => u.pathname), ['/api/v1/odds', '/api/v1/markets', '/api/v1/sportsbook/markets']);
  assert.deepEqual(urls.map(u => u.searchParams.get('source')), ['draftkings', 'underdog', 'fanduel']);
  assert.equal(urls[0].searchParams.get('fresh_only'), 'true');
  for (const c of calls) { assert.equal(c.init.headers.Authorization, 'Bearer go_live_fixture'); assert.ok(!c.url.includes('go_live')); }
});

test('input is validated: unknown sport, unknown field and missing history id fail without a request', async () => {
  const {calls, fetcher} = recorder(() => Response.json({}));
  const env = {GETODDS_API_KEY: 'k'};
  await assert.rejects(runTool('get_public_board', {sport: 'curling'}, {fetcher, env}));
  await assert.rejects(runTool('get_odds', {sport: 'NBA', bogus: 1}, {fetcher, env}));
  await assert.rejects(runTool('get_line_history', {}, {fetcher, env}), {code: 'HISTORY_ID_REQUIRED'});
  assert.equal(calls.length, 0);
});

test('API guidance and Retry-After pass through on errors', async () => {
  const {fetcher} = recorder(() => new Response(JSON.stringify({error: {code: 'DAILY_LIMIT', user_message: 'Daily allowance used.', agent_next_step: 'Wait for midnight UTC.'}}), {status: 429, headers: {'retry-after': '60'}}));
  await assert.rejects(runTool('get_odds', {}, {fetcher, env: {GETODDS_API_KEY: 'k'}}), e => e.code === 'DAILY_LIMIT' && e.status === 429 && e.retryAfter === 60 && /midnight/.test(e.message));
});

test('pending sandbox and signup tools explain a 404 instead of failing opaquely', async () => {
  const {calls, fetcher} = recorder(() => new Response('not found', {status: 404}));
  await assert.rejects(runTool('get_sandbox_odds', {sport: 'nba'}, {fetcher, env: {}}), {code: 'SANDBOX_NOT_AVAILABLE'});
  await assert.rejects(runTool('create_free_key', {email: 'dev@company.com'}, {fetcher, env: {}}), {code: 'SIGNUP_NOT_AVAILABLE'});
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {email: 'dev@company.com'});
});

test('MCP protocol: server lists every tool and returns errors as isError content', async () => {
  const {fetcher} = recorder(() => Response.json(board));
  const server = createServer({fetcher, env: {}});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'test', version: '0'});
  await Promise.all([server.connect(a), client.connect(b)]);
  const listed = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(listed, tools.map(t => t.name).sort());
  const ok = await client.callTool({name: 'get_public_board', arguments: {sport: 'nhl'}});
  assert.equal(JSON.parse(ok.content[0].text).state, 'available');
  const refused = await client.callTool({name: 'get_odds', arguments: {}});
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /API_KEY_REQUIRED/);
  await client.close();
});
