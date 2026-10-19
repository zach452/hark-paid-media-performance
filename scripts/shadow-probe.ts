/**
 * Phase 0 auth spike: can a server (the Vercel cron) talk to Shadow's MCP endpoint with no
 * person at a browser?
 *
 *   npm run shadow:probe                         # discover: what auth does the server advertise?
 *   npm run shadow:probe -- --mode=api-key       # option 1: SHADOW_API_KEY as a bearer token
 *   npm run shadow:probe -- --mode=client-credentials   # option 1b: OAuth client_credentials
 *   npm run shadow:probe -- --mode=login         # option 2, step 1: one-time browser login
 *   npm run shadow:probe -- --mode=refresh       # option 2, step 2: headless refresh, no browser
 *
 * Every mode that gets a session lists the tools and runs one query_data call against the
 * Hark workspace. Reads .env.local. Tokens are kept in .shadow-tokens.json (gitignored) and
 * are never printed; raw responses go to .probe/ (gitignored).
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  discoverOAuthServerInfo,
  refreshAuthorization,
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const ROOT = join(__dirname, '..');
const TOKEN_FILE = join(ROOT, '.shadow-tokens.json');
const PROBE_DIR = join(ROOT, '.probe');
const CALLBACK_PORT = 8976;
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

loadEnvFile(join(ROOT, '.env.local'));
const SERVER_URL = new URL(process.env.SHADOW_MCP_URL || 'https://mcp.shadow.co');
const WORKSPACE = process.env.SHADOW_WORKSPACE || 'Hark';

type Mode = 'discover' | 'api-key' | 'client-credentials' | 'login' | 'refresh';
const mode = (process.argv.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'discover') as Mode;

// ---------------------------------------------------------------------------------------------

async function main() {
  console.log(`Shadow MCP: ${SERVER_URL.href}  ·  workspace: ${WORKSPACE}  ·  mode: ${mode}\n`);
  switch (mode) {
    case 'discover':
      return discover();
    case 'api-key': {
      const key = requireEnv('SHADOW_API_KEY');
      return probeSession({ requestInit: { headers: { Authorization: `Bearer ${key}` } } });
    }
    case 'client-credentials': {
      const info = await discoverOAuthServerInfo(SERVER_URL);
      const provider = new ClientCredentialsProvider({
        clientId: requireEnv('SHADOW_OAUTH_CLIENT_ID'),
        clientSecret: requireEnv('SHADOW_OAUTH_CLIENT_SECRET'),
        expectedIssuer: info.authorizationServerMetadata?.issuer ?? info.authorizationServerUrl,
      });
      return probeSession({ authProvider: provider });
    }
    case 'login':
      return login();
    case 'refresh':
      return headlessRefresh();
    default:
      throw new Error(`Unknown --mode=${mode as string}`);
  }
}

/** Unauthenticated: what does the server say when we knock, and what does its OAuth metadata allow? */
async function discover() {
  const res = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'hark-probe', version: '0' },
      },
    }),
  });
  console.log(`Unauthenticated initialize → HTTP ${res.status}`);
  const www = res.headers.get('www-authenticate');
  if (www) console.log(`  WWW-Authenticate: ${www}`);
  if (res.ok) console.log('  ⚠ The server accepted an unauthenticated initialize. Check what it exposes.');

  const info = await discoverOAuthServerInfo(SERVER_URL);
  const rm = info.resourceMetadata;
  const as = info.authorizationServerMetadata;
  console.log(`\nProtected resource metadata (RFC 9728): ${rm ? 'found' : 'not found'}`);
  if (rm) {
    console.log(`  resource: ${rm.resource}`);
    console.log(`  authorization_servers: ${(rm.authorization_servers ?? []).join(', ') || '—'}`);
    console.log(`  bearer_methods_supported: ${(rm.bearer_methods_supported ?? []).join(', ') || '—'}`);
    console.log(`  scopes_supported: ${(rm.scopes_supported ?? []).join(' ') || '—'}`);
  }
  console.log(`\nAuthorization server: ${info.authorizationServerUrl}`);
  if (!as) {
    console.log('  No RFC 8414 / OIDC metadata. OAuth is unlikely; ask Shadow about API keys.');
    return;
  }
  const grants = as.grant_types_supported ?? ['authorization_code', 'implicit'];
  console.log(`  issuer: ${as.issuer}`);
  console.log(`  token_endpoint: ${as.token_endpoint}`);
  console.log(`  registration_endpoint (dynamic client registration): ${as.registration_endpoint ?? '—'}`);
  console.log(`  grant_types_supported: ${grants.join(', ')}`);
  console.log(
    `  token_endpoint_auth_methods_supported: ${(as.token_endpoint_auth_methods_supported ?? []).join(', ') || '—'}`,
  );
  console.log(`  scopes_supported: ${(as.scopes_supported ?? []).join(' ') || '—'}`);

  console.log('\nVerdict:');
  if (grants.includes('client_credentials'))
    console.log(
      '  ✓ client_credentials advertised → ask Shadow for a service client; try --mode=client-credentials',
    );
  if (grants.includes('refresh_token'))
    console.log(
      '  ✓ refresh_token advertised → option 2 is viable; run --mode=login once, then --mode=refresh',
    );
  else
    console.log(
      '  ✗ refresh_token NOT advertised → a cron cannot renew tokens on its own (option 3: ask Shadow)',
    );
  console.log('  ? API keys are not discoverable from metadata; if Shadow issues one, try --mode=api-key');
}

/** Option 2, step 1: a person signs in once; we keep the refresh token for the cron. */
async function login() {
  const store = readStore();
  const provider = new FileOAuthProvider(store);
  const codePromise = waitForCallback();

  const first = new StreamableHTTPClientTransport(SERVER_URL, { authProvider: provider });
  const client = new Client({ name: 'hark-probe', version: '0' });
  try {
    await client.connect(first);
    console.log('Already authorized with stored tokens.');
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    const code = await codePromise;
    await first.finishAuth(code);
    console.log('Authorization code exchanged.');
  }
  await client.close().catch(() => {});

  const t = provider.tokensSync();
  console.log(`\nTokens saved to .shadow-tokens.json`);
  console.log(`  access token expires_in: ${t?.expires_in ?? 'not stated'}s`);
  console.log(`  refresh token issued: ${t?.refresh_token ? 'yes' : 'NO'}`);
  if (!t?.refresh_token) console.log('  ✗ No refresh token: the cron cannot run headless on this grant.');
  await probeSession({ authProvider: provider });
}

/** Option 2, step 2: what the cron would do. No browser; refresh, persist rotation, query. */
async function headlessRefresh() {
  const store = readStore();
  const refreshToken = process.env.SHADOW_REFRESH_TOKEN || store.tokens?.refresh_token;
  const clientInformation: OAuthClientInformationMixed | undefined = process.env.SHADOW_OAUTH_CLIENT_ID
    ? {
        client_id: process.env.SHADOW_OAUTH_CLIENT_ID,
        client_secret: process.env.SHADOW_OAUTH_CLIENT_SECRET || undefined,
      }
    : store.client;
  if (!refreshToken || !clientInformation)
    throw new Error('No refresh token / client. Run --mode=login first.');

  const info = await discoverOAuthServerInfo(SERVER_URL);
  const before = refreshToken;
  const tokens = await refreshAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata,
    clientInformation,
    refreshToken,
    resource: info.resourceMetadata?.resource ? new URL(info.resourceMetadata.resource) : undefined,
  });
  const rotated = !!tokens.refresh_token && tokens.refresh_token !== before;
  writeStore({
    ...store,
    client: clientInformation,
    tokens: { ...tokens, refresh_token: tokens.refresh_token ?? before },
  });
  console.log('Headless refresh succeeded.');
  console.log(`  access token expires_in: ${tokens.expires_in ?? 'not stated'}s`);
  console.log(
    `  refresh token rotated: ${rotated ? 'yes (must persist the new one every run)' : 'no (same token reusable)'}`,
  );
  await probeSession({ requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } });
}

/** With working auth: list tools and run one query_data call. */
async function probeSession(opts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1]) {
  const transport = new StreamableHTTPClientTransport(SERVER_URL, opts);
  const client = new Client({ name: 'hark-probe', version: '0' });
  await client.connect(transport);
  const server = client.getServerVersion();
  console.log(`\nConnected: ${server?.name ?? '?'} ${server?.version ?? ''}`);

  const { tools } = await client.listTools();
  console.log(`Tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
  if (!tools.some((t) => t.name === 'query_data')) throw new Error('query_data tool not found');

  const day = isoDate(new Date(Date.now() - 864e5));
  const args = {
    workspace: WORKSPACE, // always explicit: the connection default is shared and can change
    platform: 'google_ads',
    table: 'campaigns',
    start_date: day,
    end_date: day,
    group_by: ['date', 'campaign_name'],
    aggregations: { google_ads_spend: ['sum'], google_ads_impressions: ['sum'], google_ads_clicks: ['sum'] },
    limit: 50,
  };
  const result = await client.callTool({ name: 'query_data', arguments: args });
  mkdirSync(PROBE_DIR, { recursive: true });
  const file = join(PROBE_DIR, `query_data-google_ads-${day}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));

  const body = parseToolText(result);
  console.log(`\nquery_data google_ads/campaigns ${day}: ${body ? 'ok' : 'unparsed'} (raw: ${file})`);
  if (body) {
    const summary = body.summary as Record<string, unknown> | undefined;
    const bind = body.bind as { window?: { tz?: string } } | undefined;
    const page = body.page as { truncated?: boolean } | undefined;
    console.log(`  total spend: ${String(summary?.total_google_ads_spend ?? '—')}`);
    console.log(`  window tz: ${bind?.window?.tz ?? '—'}  ·  truncated: ${String(page?.truncated ?? '—')}`);
    console.log(`  groups: ${Array.isArray(body.groups) ? body.groups.length : '—'}`);
  }
  await client.close();
}

// ---------------------------------------------------------------------------------------------

interface Store {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

class FileOAuthProvider implements OAuthClientProvider {
  constructor(private store: Store) {}
  get redirectUrl() {
    return REDIRECT_URL;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Hark Paid Media Dashboard (Darkroom)',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.store.client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.store.client = info;
    writeStore(this.store);
  }
  tokens() {
    return this.store.tokens;
  }
  tokensSync() {
    return this.store.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.store.tokens = tokens;
    writeStore(this.store);
  }
  redirectToAuthorization(url: URL) {
    console.log(
      `\nOpen this URL to sign in to Shadow (the account must have access to ${WORKSPACE}):\n\n  ${url.href}\n`,
    );
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [url.href], { stdio: 'ignore', detached: true }).on('error', () => {});
    } catch {
      // Printing the URL is enough.
    }
  }
  saveCodeVerifier(v: string) {
    this.store.codeVerifier = v;
    writeStore(this.store);
  }
  codeVerifier() {
    if (!this.store.codeVerifier) throw new Error('No PKCE verifier saved');
    return this.store.codeVerifier;
  }
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URL);
      if (url.pathname !== '/callback') return void res.writeHead(404).end();
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<p style="font:16px system-ui">${code ? 'Signed in. You can close this tab.' : `Error: ${error}`}</p>`,
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(`OAuth error: ${error ?? 'no code'}`));
    });
    server.listen(CALLBACK_PORT, '127.0.0.1');
  });
}

function readStore(): Store {
  return existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Store) : {};
}

function writeStore(s: Store) {
  writeFileSync(TOKEN_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function parseToolText(result: unknown): Record<string, unknown> | null {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content.find((c) => c.type === 'text')?.text;
  if (!text) return null;
  // Shadow wraps the JSON body as {"result": "<json>\n\n_Workspace: X_"}.
  try {
    const outer = JSON.parse(text) as { result?: string };
    const inner = typeof outer.result === 'string' ? outer.result : text;
    const json = inner.slice(0, inner.lastIndexOf('}') + 1);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in .env.local`);
  return v;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
