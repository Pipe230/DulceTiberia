# DulceTiberia · Landing Page

Landing page estática para DulceTiberia, coffee break corporativo y repostería artesanal en Antofagasta, Chile.

## Estructura

- `index.html`: la página completa (Tailwind CSS por CDN, íconos Lucide y JavaScript nativo).
- `assets/logo.webp`: logo de la marca.

Para verla, abre `index.html` en el navegador. Para publicarla, sirve la carpeta en cualquier hosting estático (GitHub Pages, Netlify, Cloudflare Pages).

## Formulario de cotización

El formulario envía las solicitudes por correo mediante [Web3Forms](https://web3forms.com). El correo de destino **no aparece en el código**: solo se publica la clave de acceso (`WEB3FORMS_ACCESS_KEY` en `index.html`), que es pública por diseño y únicamente permite enviar mensajes al correo registrado en Web3Forms.

Protecciones incluidas:

- Campo trampa invisible (`botcheck`) y bloqueo de envíos hechos en menos de 4 segundos (bots).
- Límite por navegador: 1 envío por minuto y 3 por hora.
- Validación de nombre, correo, teléfono chileno, RUT (módulo 11), fecha (mínimo 48 h de anticipación) y cantidad de personas.
- Limpieza de caracteres de control y de `<` `>`; no se aceptan enlaces en los mensajes; sin archivos adjuntos.
- Los mensajes al usuario se muestran con `textContent` (sin inyección de HTML).
- Política de seguridad de contenido (CSP) que solo permite enviar datos a `api.web3forms.com`.

Para cambiar el correo de destino, genera una nueva clave en web3forms.com y reemplázala en `index.html`.
