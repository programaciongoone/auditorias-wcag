import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://auditorias-wcag-mcp.onrender.com';
const GITHUB_USER = 'programaciongoone';
const pending = new Map();
const codes = new Map();
const rand = () => randomBytes(32).toString('base64url');
const secret = () => {
  const key = process.env.MCP_API_KEY;
  if (!key || key.length < 32) throw Error('MCP_API_KEY debe tener al menos 32 caracteres');
  return key;
};
const sign = data => {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + signature;
};
const verify = token => {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const pieces = token.split('.');
  if (pieces.length !== 2) return null;
  const [payload, signature] = pieces;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
};
const readClient = id => {
  const client = verify(id);
  return client?.kind === 'oauth-client' && Array.isArray(client.redirect_uris) ? client : null;
};
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
};
const form = async req => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16384) throw Error('Solicitud demasiado grande');
  }
  return req.headers['content-type']?.includes('application/json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
};
const safeRedirect = value => {
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname)));
  } catch { return false; }
};
const equal = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const error = (res, status, code, description) => json(res, status, { error: code, error_description: description });
const expire = () => {
  const now = Date.now();
  for (const map of [pending, codes]) for (const [key, value] of map) if (value.expires < now) map.delete(key);
};
function authMetadata() {
  return {
    issuer: BASE,
    authorization_endpoint: BASE + '/authorize',
    token_endpoint: BASE + '/token',
    registration_endpoint: BASE + '/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  };
}
export function bearerAuthorized(req) {
  expire();
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return false;
  const value = verify(token);
  return Boolean(value && value.kind === 'mcp-access' && value.user === GITHUB_USER);
}
export async function handleOAuth(req, res, pathname, searchParams) {
  expire();
  if (req.method === 'GET' && (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/oauth-authorization-server/mcp')) {
    json(res, 200, authMetadata()); return true;
  }
  if (req.method === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp')) {
    json(res, 200, { resource: BASE + '/mcp', authorization_servers: [BASE], bearer_methods_supported: ['header'] }); return true;
  }
  if (pathname === '/register' && req.method === 'POST') {
    try {
      const input = await form(req);
      if (!Array.isArray(input.redirect_uris) || !input.redirect_uris.length || input.redirect_uris.length > 5 ||
          !input.redirect_uris.every(safeRedirect) || (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none')) {
        error(res, 400, 'invalid_client_metadata', 'Redirect URIs o método de autenticación inválidos'); return true;
      }
      const id = sign({ kind: 'oauth-client', redirect_uris: input.redirect_uris, exp: Date.now() + 365 * 86400000 });
      json(res, 201, { client_id: id, client_id_issued_at: Math.floor(Date.now()/1000),
        redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'], response_types: ['code'], client_name: input.client_name || 'ChatGPT MCP' });
    } catch { error(res, 400, 'invalid_client_metadata', 'Registro inválido'); }
    return true;
  }
  if (pathname === '/authorize' && req.method === 'GET') {
    const client = readClient(searchParams.get('client_id'));
    const redirect = searchParams.get('redirect_uri');
    const challenge = searchParams.get('code_challenge');
    const state = searchParams.get('state');
    const reason = !client ? 'client_id_no_registrado' :
      !client.redirect_uris.includes(redirect) ? 'redirect_uri_no_registrada' :
      searchParams.get('response_type') !== 'code' ? 'response_type_no_admitido' :
      searchParams.get('code_challenge_method') !== 'S256' ? 'pkce_method_invalido' :
      !challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) ? 'pkce_challenge_invalido' :
      !state || state.length > 2048 ? 'state_invalido' : null;
    if (reason) {
      console.warn('OAuth authorize rejected:', reason);
      error(res, 400, 'invalid_request', 'Validación OAuth fallida: ' + reason); return true;
    }
    if (!process.env.GITHUB_OAUTH_CLIENT_ID || !process.env.GITHUB_OAUTH_CLIENT_SECRET) {
      error(res, 503, 'temporarily_unavailable', 'Credenciales GitHub OAuth no configuradas'); return true;
    }
    const nonce = rand();
    pending.set(nonce, { client_id: searchParams.get('client_id'), redirect, challenge, state, expires: Date.now()+600000 });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', process.env.GITHUB_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', BASE + '/oauth/github/callback');
    url.searchParams.set('state', nonce);
    res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' }); res.end(); return true;
  }
  if (pathname === '/oauth/github/callback' && req.method === 'GET') {
    const nonce = searchParams.get('state');
    const data = pending.get(nonce);
    if (!data || data.expires < Date.now()) { error(res, 400, 'invalid_request', 'Estado OAuth caducado'); return true; }
    pending.delete(nonce);
    if (!searchParams.get('code')) { error(res, 400, 'access_denied', 'GitHub no autorizó el acceso'); return true; }
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.GITHUB_OAUTH_CLIENT_ID, client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET, code: searchParams.get('code'), redirect_uri: BASE + '/oauth/github/callback' })
      });
      if (!response.ok) throw Error('GitHub token HTTP ' + response.status);
      const grant = await response.json();
      if (!grant.access_token) throw Error('GitHub no entregó token');
      const profileResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: 'Bearer ' + grant.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'auditorias-wcag-mcp' }
      });
      if (!profileResponse.ok) throw Error('No se pudo verificar la identidad');
      const profile = await profileResponse.json();
      if (String(profile.login).toLowerCase() !== GITHUB_USER) {
        error(res, 403, 'access_denied', 'Solo se autoriza la cuenta GitHub programaciongoone'); return true;
      }
      const code = rand();
      codes.set(code, { client_id: data.client_id, redirect: data.redirect, challenge: data.challenge, user: GITHUB_USER, expires: Date.now()+120000 });
      const target = new URL(data.redirect);
      target.searchParams.set('code', code);
      target.searchParams.set('state', data.state);
      res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' }); res.end();
    } catch (e) { error(res, 502, 'server_error', 'No se pudo completar la autenticación con GitHub'); }
    return true;
  }
  if (pathname === '/token' && req.method === 'POST') {
    try {
      const input = await form(req);
      const code = codes.get(input.code);
      if (input.grant_type !== 'authorization_code' || !code || code.expires < Date.now() ||
          !equal(code.client_id, input.client_id) || !equal(code.redirect, input.redirect_uri) ||
          typeof input.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier) ||
          !equal(createHash('sha256').update(input.code_verifier).digest('base64url'), code.challenge)) {
        error(res, 400, 'invalid_grant', 'Código o verificador PKCE inválido'); return true;
      }
      codes.delete(input.code);
      const access_token = sign({ kind: 'mcp-access', user: code.user, exp: Date.now() + 3600000 });
      json(res, 200, { access_token, token_type: 'Bearer', expires_in: 3600 });
    } catch { error(res, 400, 'invalid_request', 'Solicitud inválida'); }
    return true;
  }
  return false;
}
