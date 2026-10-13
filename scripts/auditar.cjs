'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pa11y = require('pa11y');
const puppeteer = require('puppeteer');

const target = process.env.TARGET_URL;
const out = path.resolve('resultados');
fs.mkdirSync(out, { recursive: true });
const launch = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
const viewport = { width: 1365, height: 900, deviceScaleFactor: 1 };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

async function main() {
  const browser = await puppeteer.launch(launch);
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const response = await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    const metadata = {
      requestedUrl: target,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      title: await page.title(),
      viewport,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(path.join(out, 'pagina.json'), JSON.stringify(metadata, null, 2));
    await page.screenshot({ path: path.join(out, 'captura.png'), fullPage: true });
    console.log('URL final:', metadata.finalUrl, '| HTTP:', metadata.httpStatus, '| Título:', metadata.title);
    if (!response || response.status() >= 400) throw new Error('La página no devolvió una respuesta HTTP correcta');

    const reports = {};
    for (const [name, runner] of [['axe', 'axe'], ['htmlcs', 'htmlcs']]) {
      try {
        const result = await pa11y(metadata.finalUrl, {
          runners: [runner],
          standard: 'WCAG2AA',
          timeout: 60000,
          wait: 1500,
          chromeLaunchConfig: launch,
          viewport: { width: viewport.width, height: viewport.height },
          includeWarnings: false,
          includeNotices: false
        });
        reports[name] = result;
        fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(result, null, 2));
        console.log(name + ':', result.issues.length, 'incidencias');
      } catch (error) {
        reports[name] = { error: error.message };
        fs.writeFileSync(path.join(out, name + '-error.txt'), error.stack || error.message);
        console.error(name + ' falló:', error.message);
      }
    }

    const rows = Object.entries(reports).flatMap(([engine, report]) =>
      (report.issues || []).map(issue => '<tr><td>' + escapeHtml(engine) +
        '</td><td>' + escapeHtml(issue.type) + '</td><td>' +
        escapeHtml(issue.code) + '</td><td>' + escapeHtml(issue.message) +
        '</td><td><code>' + escapeHtml(issue.selector) +
        '</code></td><td><code>' + escapeHtml(issue.context) + '</code></td></tr>'));
    const failures = Object.entries(reports).filter(([, r]) => r.error);
    const html = '<!doctype html><html lang="es"><meta charset="utf-8">' +
      '<title>Auditoría de accesibilidad</title><style>body{font:16px system-ui;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:.6rem;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}code{white-space:pre-wrap}</style>' +
      '<h1>Auditoría de accesibilidad</h1><p>URL solicitada: ' + escapeHtml(target) +
      '</p><p>URL final: ' + escapeHtml(metadata.finalUrl) +
      '</p><p>Fecha: ' + escapeHtml(metadata.timestamp) +
      '</p><p>axe: ' + escapeHtml(reports.axe.issues?.length ?? 'ERROR') +
      ' · HTML_CodeSniffer: ' + escapeHtml(reports.htmlcs.issues?.length ?? 'ERROR') +
      '</p><p>Resultados automáticos: no acreditan por sí solos conformidad WCAG.</p>' +
      (failures.length ? '<p>Fallos técnicos: ' + escapeHtml(failures.map(([n,r]) => n + ': ' + r.error).join('; ')) + '</p>' : '') +
      '<table><thead><tr><th>Motor</th><th>Tipo</th><th>Regla</th><th>Descripción</th><th>Selector</th><th>HTML</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></html>';
    fs.writeFileSync(path.join(out, 'informe.html'), html);
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
