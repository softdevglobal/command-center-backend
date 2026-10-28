import '../src/dotenv-quiet-preflight.ts';
import '../src/env-bootstrap.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [did, target = 'http://127.0.0.1:5050/api/ai/mcp/trade'] = process.argv.slice(2);
const usage = 'Usage: npm run check:trade -- <DID digits> [backend MCP URL]';
const reads = ['get_business_profile', 'list_services', 'get_available_slots'];

async function main() {
  if (did === '--help') { console.log(usage); return; }
  if (!/^\d{6,15}$/.test(did ?? '')) throw new Error(usage);
  const url = new URL(target);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash || !/^\/api\/ai\/mcp\/trade\/?$/.test(url.pathname))
    throw new Error('Use the Trade MCP HTTPS URL, or local HTTP on localhost.');
  const bridgeSecret = process.env.AI_VOICE_BRIDGE_SECRET?.trim();
  const configured = JSON.parse(process.env.AI_MCP_TRADE_TENANT_CONFIG_JSON || '[]');
  const token = bridgeSecret?.length >= 32 ? bridgeSecret :
    (Array.isArray(configured) ? configured.find(entry => entry.did?.replace(/^\+/, '') === did)?.token : null);
  if (typeof token !== 'string' || token.length < 32) throw new Error('Configure the backend bridge secret or a dedicated Trade token for this DID.');

  let httpStatus, phase = 'initialization';
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {headers: {Authorization: `Bearer ${token}`, 'X-BMSPro-DID': did}, redirect: 'error'},
    fetch: (input, init) => fetch(input, {...init, redirect: 'error', signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000)}).then(response => {
      // A stateless server can reject the SDK's optional GET/SSE probe.
      if (!response.ok && init?.method?.toUpperCase() !== 'GET') httpStatus = response.status;
      return response;
    }),
    reconnectionOptions: {maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1},
  });
  const client = new Client({name: 'trade-read-only-check', version: '1.0.0'}, {capabilities: {}});
  client.onerror = () => {};
  const read = async (name, args = {}) => {
    if (!reads.includes(name)) throw new Error('Only read tools are permitted.');
    phase = name;
    const result = await client.callTool({name, arguments: args}, undefined, {timeout: 35000});
    if (result.isError) throw new Error('Tool failed.');
    return JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
  };
  try {
    await client.connect(transport, {timeout: 15000});
    phase = 'tool inventory';
    const inventory = (await client.listTools({}, {timeout: 15000})).tools;
    if (reads.some(name => !inventory.some(tool => tool.name === name))) throw new Error('Missing read tools.');
    console.log(`Trade MCP connected for DID ${did}. Tools: ${inventory.map(tool => tool.name).join(', ')}`);
    const profile = await read('get_business_profile');
    if (profile.brand !== 'trade' || typeof profile.businessName !== 'string' || !profile.businessName.trim()) throw new Error('Invalid Trade business profile.');
    console.log(`Business verified: ${JSON.stringify(profile.businessName)}; timezone: ${JSON.stringify(profile.timezone)}`);
    const services = await read('list_services');
    if (!Array.isArray(services)) throw new Error('Invalid service result.');
    console.log(`Active services returned: ${services.length}`);
    const parts = new Intl.DateTimeFormat('en-AU', {timeZone: profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
    const part = type => parts.find(value => value.type === type)?.value;
    const from = `${part('year')}-${part('month')}-${part('day')}`;
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    const availability = await read('get_available_slots', {from, to});
    if (availability.brand !== 'trade' || !Array.isArray(availability.unavailable)) throw new Error('Invalid availability result.');
    console.log(`Availability verified ${from} to ${to}: ${availability.unavailable.length} unavailable sessions. Other sessions are preferences; only an explicit confirmed submission result confirms a visit.`);
    console.log('Read-only check passed. No OpenAI call, inspection request, notification or booking was created.');
  } catch {
    const hint = httpStatus === 404 ? 'Trade is disabled or the route is missing; restart the backend after setting its Trade flags.' :
      httpStatus === 401 ? 'Check the credential and the DID mapping.' :
      httpStatus === 403 ? 'Check the mapped Blue business and its active status.' :
      'Check Firebase Blue credentials, create an active scoped Trade AI receptionist account, and verify the DID mapping and Trade API URL.';
    throw new Error(`Trade readiness failed during ${phase}${httpStatus ? ` (HTTP ${httpStatus})` : ''}. ${hint}`);
  } finally { await client.close().catch(() => {}); }
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Trade readiness check failed.'); process.exitCode = 1; }
