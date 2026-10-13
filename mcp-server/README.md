# Servidor MCP de auditorías WCAG (prototipo)

Servidor HTTP MCP stateless para activar y consultar el workflow `.github/workflows/accesibilidad.yml`.

## Render
- Root Directory: `mcp-server`
- Language: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Variables secretas: `GITHUB_TOKEN` y `MCP_API_KEY`.
- No establecer `PORT` manualmente: Render lo proporciona.

El token GitHub fine-grained debe tener acceso solo a `programaciongoone/auditorias-wcag` con **Actions: Read and write**. No guardes secretos en Git.

## Limitaciones antes de conectar ChatGPT
- Este prototipo usa autenticación Bearer estática, **no implementa OAuth**. Hay que verificar la compatibilidad con el flujo de conexión MCP de ChatGPT antes de exponerlo.
- `listar_informes` devuelve metadatos, **no descarga ni interpreta el ZIP**.
- `iniciar_auditoria` confirma el envío, pero no devuelve el run_id de GitHub.
- La validación de URL del workflow no es defensa completa contra SSRF. Solo enviar dominios públicos de confianza.
- No desplegar como servicio público sin revisar autenticación, autorización y compatibilidad MCP.
