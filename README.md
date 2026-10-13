# Auditorías WCAG con Pa11y y axe-core

Repositorio público para ejecutar auditorías automatizadas de accesibilidad en páginas HTTPS públicas.

## Uso

1. Abre **Actions > Auditoría de accesibilidad > Run workflow**.
2. Introduce la URL, por ejemplo `https://albafotonica.com/`.
3. Espera a que termine la ejecución.
4. Descarga el artifact `informe-accesibilidad-...` desde el resumen de la ejecución.

Los informes JSON se conservan durante **1 día**. Al ser un repositorio público, los informes y registros no son privados.

El workflow usa Pa11y con axe-core y el estándar `WCAG2AA`. Una auditoría automática no acredita por sí sola conformidad WCAG 2.1 AA. El criterio 2.5.8 pertenece a WCAG 2.2 AA y necesita una comprobación adicional.

**Seguridad:** utiliza únicamente URLs públicas de confianza. No introduzcas URLs con tokens o datos personales. Para aceptar URLs arbitrarias de terceros sin confianza se requiere un filtrado más robusto contra SSRF y redirecciones.
