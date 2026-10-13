# goOne WCAG Auditor — integración GitHub App

Objetivo: iniciar el workflow `accesibilidad.yml` y consultar resultados desde una integración autorizada de ChatGPT.

## Registro manual requerido
1. En GitHub, abre Settings → Developer settings → GitHub Apps → New GitHub App.
2. Nombre: `goOne WCAG Auditor` (si está disponible).
3. Homepage URL: `https://github.com/programaciongoone/auditorias-wcag`.
4. Desactiva Webhook si no se necesita; no publiques claves privadas.
5. Repository permissions: Actions = Read and write; Metadata = Read-only.
6. Crea la app y elige **Install App**, seleccionando **Only select repositories** → `auditorias-wcag`.

## Autenticación
La app necesita un servicio autenticado que firme un JWT con su clave privada y solicite un installation access token. **No subir claves privadas al repositorio ni enviarlas a un chat.** Almacenar las credenciales en un gestor de secretos del servicio.

## API de la integración
`POST /audit` con `{"url":"https://example.com/"}`: validar URL y autorizar usuario; generar installation token; llamar a `POST /repos/programaciongoone/auditorias-wcag/actions/workflows/accesibilidad.yml/dispatches` con `{"ref":"main","inputs":{"url":"https://example.com/"}}`.

`GET /audit/{id}`: consultar estado de ejecución y enlaces a artefactos. La implementación debe correlacionar solicitudes concurrentes (por ejemplo, usando identificador de correlación en el workflow).

## Seguridad pendiente antes de exposición
- Protección SSRF real para URL inicial y redirecciones; bloquear direcciones internas y rangos reservados también tras resolución DNS.
- Autorización de quien solicita auditorías, cuotas y registro mínimo.
- Mantener secretos solo en backend.
- Revisar que los artefactos públicos no contengan datos sensibles.
- Fijar dependencias y reforzar aislamiento del navegador.

## Estado
Documentación y diseño inicial. **No hay todavía GitHub App registrada, backend desplegado ni conector ChatGPT activo.**
