import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const { GITHUB_TOKEN, MCP_API_KEY, PORT = '10000' } = process.env;
const OWNER = 'programaciongoone';
const REPO = 'auditorias-wcag';
const WORKFLOW = 'accesibilidad.yml';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const VERSION = '2025-03-26';

function fail(message) { throw new Error(message); }
function isAuthorized(req) {
  const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? '';
  const a = Buffer.from(token), b = Buffer.from(MCP_API_KEY ?? '');
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
async function github(path, { method = 'GET', body } = {}) {
  if (!GITHUB_TOKEN) fail('GITHUB_TOKEN no configurado');
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) fail(`GitHub API: HTTP ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
const tools = [
  { name: 'iniciar_auditoria', description: 'Inicia una auditoría WCAG de una URL HTTPS pública de confianza mediante GitHub Actions.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL HTTPS pública a auditar' } }, required: ['url'], additionalProperties: false } },
  { name: 'listar_auditorias', description: 'Lista las últimas ejecuciones de auditoría y su estado.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'consultar_auditoria', description: 'Consulta una ejecución por su identificador numérico.', inputSchema: { type: 'object', properties: { run_id: { type: 'integer' } }, required: ['run_id'], additionalProperties: false } },
  { name: 'listar_informes', description: 'Obtiene los metadatos y URL de descarga de los artifacts de una ejecución (caducan en 1 día).', inputSchema: { type: 'object', properties: { run_id: { type: 'integer' } }, required: ['run_id'], additionalProperties: false } }
];
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function validRunId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('run_id inválido');
  return value;
}
async function callTool(name, args = {}) {
  if (name === 'iniciar_auditoria') {
    if (typeof args.url !== 'string' || args.url.length > 2048) fail('URL inválida');
    const u = new URL(args.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.') || u.hostname === 'localhost') fail('Se requiere URL HTTPS pública');
    await github(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: { ref: 'main', inputs: { url: u.toString() } } });
    return result({ submitted: true, message: 'Workflow solicitado. Usa listar_auditorias para localizar su ejecución.' });
  }
  if (name === 'listar_auditorias') {
    const data = await github(`/actions/workflows/${WORKFLOW}/runs?per_page=10&event=workflow_dispatch`);
    return result(data.workflow_runs.map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion, created_at: r.created_at, html_url: r.html_url })));
  }
  if (name === 'consultar_auditoria') {
    const r = await github(`/actions/runs/${validRunId(args.run_id)}`);
    return result({ id: r.id, status: r.status, conclusion: r.conclusion, html_url: r.html_url });
  }
  if (name === 'listar_informes') {
    const data = await github(`/actions/runs/${validRunId(args.run_id)}/artifacts`);
    return result(data.artifacts.map(a => ({ name: a.name, expired: a.expired, size_in_bytes: a.size_in_bytes, archive_download_url: a.archive_download_url })));
  }
  fail('Herramienta desconocida');
}
function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
async function handle(message) {
  const { id, method, params = {} } = message;
  if (method === 'notifications/initialized') return null;
  if (id === undefined) return null;
  if (method === 'initialize') return rpc(id, { protocolVersion: VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'auditorias-wcag', version: '0.1.0' } });
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools });
  if (method === 'tools/call') {
    try { return rpc(id, await callTool(params.name, params.arguments)); }
    catch (e) { return rpc(id, { isError: true, content: [{ type: 'text', text: e.message }] }); }
  }
  return rpcError(id, -32601, 'Método no disponible');
}
http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.url !== '/mcp') { res.writeHead(404); return res.end(); }
  if (!isAuthorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  if (!req.headers.accept?.includes('application/json') || !req.headers.accept?.includes('text/event-stream')) { res.writeHead(406); return res.end(); }
  let body = '';
  try {
    for await (const chunk of req) { body += chunk; if (body.length > 65536) fail('Solicitud demasiado grande'); }
    const message = JSON.parse(body);
    if (!message || typeof message !== 'object' || Array.isArray(message)) fail('JSON-RPC inválido');
    const output = await handle(message);
    if (output === null) { res.writeHead(202); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(output));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpcError(null, -32700, e.message)));
  }
}).listen(Number(PORT), '0.0.0.0', () => console.log(`MCP escuchando en puerto ${PORT}`));
