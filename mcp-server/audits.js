import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

const API = 'https://api.github.com/repos/programaciongoone/auditorias-wcag';
const WORKFLOW = 'accesibilidad.yml';
const BRANCH = 'feature/mcp-render';
const jobs = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function github(path, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw Error('GITHUB_TOKEN no configurado');
  const response = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (!response.ok) throw Error('GitHub HTTP ' + response.status);
  return response.status === 204 ? {} : response.json();
}
function publicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw Error('URL inválida');
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      !u.hostname.includes('.') || /(^|\.)(localhost|local|internal)$/.test(u.hostname) ||
      /^(?:\d+\.){3}\d+$/.test(u.hostname)) throw Error('Se requiere URL HTTPS con dominio público');
  return u.toString();
}
async function locate(trackingId) {
  const data = await github('/actions/workflows/' + WORKFLOW + '/runs?event=workflow_dispatch&branch=' + encodeURIComponent(BRANCH) + '&per_page=50');
  return data.workflow_runs.find(r => r.display_title === 'WCAG ' + trackingId);
}
export async function startAudit(url) {
  const clean = publicUrl(url);
  const tracking_id = randomUUID();
  const job = { tracking_id, url: clean, created: Date.now(), run_id: null };
  jobs.set(tracking_id, job);
  try {
    await github('/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST', body: JSON.stringify({ ref: BRANCH, inputs: { url: clean, tracking_id } })
    });
  } catch (error) { jobs.delete(tracking_id); throw error; }
  return { tracking_id, status: 'submitted', url: clean,
    message: 'Auditoría iniciada. Consulta esperar_auditoria con tracking_id hasta completarse.' };
}
function validTracking(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw Error('tracking_id inválido');
  return id;
}
async function getReport(runId) {
  const data = await github('/actions/runs/' + runId + '/artifacts');
  const artifact = data.artifacts.find(a => !a.expired && a.name.startsWith('auditoria-wcag-'));
  if (!artifact) return { report_status: 'missing', message: 'No se encontró un artifact vigente' };
  const response = await fetch(API + '/actions/artifacts/' + artifact.id + '/zip', {
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) throw Error('Descarga artifact HTTP ' + response.status);
  if (Number(response.headers.get('content-length') || 0) > 15_000_000) throw Error('Artifact demasiado grande');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 15_000_000) throw Error('Artifact demasiado grande');
  const files = unzipSync(bytes);
  const read = name => {
    const entry = Object.entries(files).find(([key]) => key === name || key.endsWith('/' + name));
    if (!entry) return null;
    return JSON.parse(strFromU8(entry[1]));
  };
  const pagina = read('pagina.json');
  const visual = read('errores-visuales.json');
  const axe = read('axe.json');
  const htmlcs = read('htmlcs.json');
  const simplify = (name, report) => ({
    engine: name,
    count: report?.issues?.length ?? null,
    issues: (report?.issues ?? []).slice(0, 100).map(i => ({
      type: i.type, code: i.code, message: i.message, selector: i.selector,
      context: String(i.context ?? '').slice(0, 800)
    }))
  });
  return { report_status: 'available', page: pagina, engines: [simplify('axe', axe), simplify('htmlcs', htmlcs)],
    incomplete: !axe || !htmlcs, truncated: (axe?.issues?.length ?? 0) > 100 || (htmlcs?.issues?.length ?? 0) > 100,
    artifact_id: artifact.id, visual: visual ? { marked: visual.marked?.length ?? 0, not_visible: visual.notVisible?.length ?? 0, image: visual.image ?? null, error: visual.error ?? null } : null };
}
export async function waitAudit(trackingId, waitSeconds = 20) {
  const id = validTracking(trackingId);
  const job = jobs.get(id);
  if (!job) throw Error('Identificador no encontrado en este proceso de Render; las sesiones temporales se pierden al reiniciar');
  const wait = Math.min(Math.max(Number(waitSeconds) || 0, 0), 25);
  const deadline = Date.now() + wait * 1000;
  let run;
  do {
    run = job.run_id ? await github('/actions/runs/' + job.run_id) : await locate(id);
    if (run?.id) job.run_id = run.id;
    if (run?.status === 'completed') {
      const base = { tracking_id: id, run_id: run.id, status: 'completed', conclusion: run.conclusion, html_url: run.html_url };
      try { return { ...base, ...(await getReport(run.id)) }; }
      catch (error) { return { ...base, report_status: 'error', error: error.message }; }
    }
    if (Date.now() + 4000 > deadline) break;
    await sleep(4000);
  } while (true);
  return { tracking_id: id, run_id: job.run_id, status: run?.status ?? 'queued',
    message: 'La auditoría continúa. Vuelve a llamar esperar_auditoria con el mismo tracking_id.' };
}
export async function reportByRunId(runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw Error('run_id inválido');
  const run = await github('/actions/runs/' + runId);
  if (run.status !== 'completed') return { run_id: runId, status: run.status };
  return { run_id: runId, status: run.status, conclusion: run.conclusion, html_url: run.html_url, ...(await getReport(runId)) };
}

export async function visualByRunId(runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw Error('run_id inválido');
  const run = await github('/actions/runs/' + runId);
  if (run.status !== 'completed') return { run_id: runId, status: run.status };
  const data = await github('/actions/runs/' + runId + '/artifacts');
  const artifact = data.artifacts.find(a => !a.expired && a.name.startsWith('auditoria-wcag-'));
  if (!artifact) return { run_id: runId, status: 'artifact_no_disponible' };
  const response = await fetch(API + '/actions/artifacts/' + artifact.id + '/zip', {
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) throw Error('GitHub HTTP ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 15_000_000) throw Error('Artifact demasiado grande');
  const files = unzipSync(bytes);
  const entry = Object.entries(files).find(([name]) => name === 'errores-visuales.json' || name.endsWith('/errores-visuales.json'));
  if (!entry) return { run_id: runId, status: 'captura_no_disponible', message: 'Esta ejecución es anterior a la función visual.' };
  const visual = JSON.parse(strFromU8(entry[1]));
  const png = Object.entries(files).find(([name]) => name === 'captura-errores.png' || name.endsWith('/captura-errores.png'));
  return { run_id: runId, status: 'available', image: visual.image,
    marked: visual.marked, not_visible: visual.notVisible, error: visual.error,
    image_base64: png && png[1].byteLength <= 9_000_000 ? Buffer.from(png[1]).toString('base64') : null,
    image_omitted_reason: !png ? 'png_no_encontrado' : png[1].byteLength > 9_000_000 ? 'png_demasiado_grande' : null,
    artifact_id: artifact.id, download_url: 'https://github.com/programaciongoone/auditorias-wcag/actions/runs/' + runId + '/artifacts/' + artifact.id,
    message: 'Descarga el artifact desde GitHub: incluye captura-errores.png y errores-visuales.json.' };
}
