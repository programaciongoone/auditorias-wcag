# Integración de ChatGPT con auditorías WCAG

## Estado
Este repositorio dispone del workflow `.github/workflows/accesibilidad.yml` con entrada `url`. Esta rama documenta la integración; no activa por sí sola la ejecución remota desde ChatGPT.

## Ejecutar mediante API de GitHub
Petición autenticada:

```http
POST /repos/programaciongoone/auditorias-wcag/actions/workflows/accesibilidad.yml/dispatches
Authorization: Bearer <TOKEN>
Accept: application/vnd.github+json
Content-Type: application/json

{"ref":"main","inputs":{"url":"https://example.com/"}}
```

Permiso requerido: **Actions: write** en el repositorio. El token no debe enviarse al chat ni incluirse en archivos públicos.

## Recuperar resultados
1. Consultar `GET /repos/programaciongoone/auditorias-wcag/actions/workflows/accesibilidad.yml/runs?event=workflow_dispatch`.
2. Identificar la ejecución correspondiente a la petición (evitar confundir ejecuciones simultáneas).
3. Consultar `GET /repos/programaciongoone/auditorias-wcag/actions/runs/{run_id}` hasta `status=completed`.
4. Consultar `GET /repos/programaciongoone/auditorias-wcag/actions/runs/{run_id}/artifacts`.
5. Descargar el ZIP del artefacto y analizar `resultados/axe.json`, `resultados/htmlcs.json`, `resultados/pagina.json` y `resultados/informe.html`.

## Limitaciones actuales
La conexión GitHub de este chat permite leer archivos y modificar el repositorio, pero no expone aquí una operación para lanzar `workflow_dispatch`. Registrar una GitHub App no cambia por sí solo las herramientas disponibles en ChatGPT: se necesita una integración que exponga la acción de ejecución (por ejemplo, un conector personalizado o servicio intermedio autenticado).

El workflow actual instala dependencias sin un lockfile y permite URLs proporcionadas como entrada. Antes de exponerlo como servicio abierto hay que reforzar la protección SSRF (DNS, redirecciones, IPs privadas y metadatos), la autenticación y los límites de uso. Los artefactos de un repositorio público no son privados.

## Prueba de integración
No compartir tokens en mensajes. Una vez que se disponga de una herramienta autorizada con `workflow_dispatch`, probar primero con una URL pública controlada, comprobar la finalización y analizar los informes.
