# Organizador semanal DulceTiberia

Prototipo del reporte semanal: una planilla de Google con los pedidos y, cada domingo a las 19:00, un correo con el plan de la semana siguiente:

- 🛒 **Qué comprar cada día**: los secos se juntan en una compra mayorista el lunes; lo fresco y refrigerado se compra el día antes de empezar cada pedido.
- 👩‍🍳 **Qué preparar cada día**: hornear, rellenar, decorar, según las tareas de cada producto.
- 🚚 **Qué entregar**: hora, cliente, retiro o delivery.
- 💰 **Quién debe pagar**, ❓ **qué pedidos faltan por confirmar** y ⚠️ **qué quedó atrasado**.

Funciona con Google Apps Script dentro de la misma planilla: no hay servidor que mantener, es gratis, los datos de clientes quedan privados en su Google Drive y el correo sale desde su propia cuenta de Gmail.

## Instalación (unos 10 minutos)

1. Con la cuenta de Google de tu mamá, crea una planilla nueva en [sheets.new](https://sheets.new) y ponle nombre, por ejemplo "DulceTiberia · Pedidos".
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega el de [`Codigo.gs`](Codigo.gs).
4. En **Configuración del proyecto** (engranaje) marca "Mostrar el archivo de manifiesto appsscript.json" y reemplaza su contenido por el de [`appsscript.json`](appsscript.json) (deja la zona horaria en `America/Santiago`).
5. Guarda, vuelve a la planilla y recárgala. Aparece el menú **🍰 DulceTiberia**.
6. **🍰 DulceTiberia → Crear hojas con datos de ejemplo**. Google pedirá permisos la primera vez (planilla, Gmail para enviar y disparadores). Como el script es propio, mostrará "Google no verificó esta app": entra en *Configuración avanzada → Ir a … (no seguro)*.
7. **🍰 DulceTiberia → Ver plan de la próxima semana** para ver el reporte con los pedidos de ejemplo.
8. En la hoja **Configuración** escribe el correo donde quiere recibir el reporte (si queda vacío, se envía a la cuenta dueña de la planilla).
9. **🍰 DulceTiberia → Activar envío automático (domingos 19:00)**.

Después, borra los pedidos de ejemplo y ajusta las recetas e insumos a los reales.

## Las hojas

| Hoja | Qué va | Quién la llena |
|---|---|---|
| **Pedidos** | Una fila por producto del pedido (un pedido con torta y cupcakes = 2 filas con el mismo ID). Solo se planifican los que están en *Confirmado*. | Ella, cada vez que confirma una venta (más adelante, la IA) |
| **Recetas** | Ficha técnica: cuánto de cada insumo lleva **una unidad** del producto, tal como se vende (1 torta de 20 personas, 1 docena de cupcakes). | Una vez, y se ajusta cuando cambia una receta |
| **Insumos** | Unidad, tipo (*Seco*, *Fresco* o *Refrigerado*), cuántos días antes comprarlo y dónde. | Una vez |
| **Tareas** | Los pasos de cada producto y cuántos días antes de la entrega se hacen (0 = el mismo día). Si un producto no tiene tareas, se asume "Preparar" el día anterior. | Una vez |
| **Configuración** | `Correo destino` y `Nombre` (para el saludo). | Una vez |
| **Último reporte** | Se rellena sola con el último plan generado. | El script |

El nombre del producto tiene que escribirse igual en Pedidos, Recetas y Tareas (no importan mayúsculas ni tildes). Si un producto vendido no tiene receta, el reporte lo avisa en ⚠️ *Revisar*.

## Probar el cálculo sin Google

La lógica no depende de Google, así que se prueba con Node:

```bash
node --test organizador/pruebas/plan.test.js            # pruebas
node organizador/pruebas/plan.test.js --mostrar         # imprime el reporte de ejemplo
```

## Próximos pasos: que los pedidos se registren solos

El reporte se alimenta de la hoja **Pedidos**. La idea es usarlo unas semanas llenándola a mano; cuando el formato le acomode, se automatiza la captura canal por canal, de más fácil a más difícil. En todos los casos la IA solo **propone** filas (con estado *Por confirmar*) y ella las confirma: un mensaje como "¿tienes torta para el sábado?" no es una venta, y un error de la IA no debe llegar a la lista de compras.

1. **Gmail** (fácil, gratis): el mismo Apps Script puede leer su correo con `GmailApp` cada hora, buscar comprobantes de transferencia y solicitudes del formulario web (llegan por Web3Forms), pasar el texto a un modelo de IA pequeño con salida JSON y agregar la fila.
2. **Instagram** (medio): requiere cuenta Profesional (Empresa o Creador) y una app en Meta for Developers con la *Instagram API with Instagram Login*, que ya no exige página de Facebook. Los mensajes llegan por webhook, así que hace falta un pequeño servicio (Apps Script como web app, n8n o una función en la nube).
3. **WhatsApp** (difícil): un WhatsApp **personal** no se puede conectar de forma oficial, y las librerías no oficiales (Baileys, Evolution API, etc.) arriesgan el bloqueo del número con el que vende. El camino seguro es pasar el número a **WhatsApp Business** (conserva chats y contactos) y conectarlo a la API oficial de Meta en modo *coexistencia*, que permite seguir usando la app en el teléfono. Mientras tanto, la opción sin riesgo es que ella reenvíe a su correo (o a un número del negocio) los mensajes de pedidos confirmados.

Notas para cuando se haga:

- **Precios de la API de WhatsApp**: desde julio de 2025 Meta cobra por mensaje de plantilla enviado, no por conversación; responder dentro de las 24 horas a quien escribió es gratis. Ya no existe el tramo de "1.000 conversaciones gratis". Por eso el reporte parte por correo: enviarlo por WhatsApp requiere una plantilla aprobada y un costo pequeño por envío.
- **Modelo de IA**: para extraer pedidos basta un modelo pequeño y barato con salida estructurada (JSON Schema). Algunos de los modelos que se suelen sugerir (Gemini 1.5 Flash, por ejemplo) ya están retirados; conviene elegir uno vigente al momento de construirlo.
- **Datos personales**: la planilla tiene nombres, teléfonos y direcciones de clientes. Debe quedar privada (no usar "Publicar en la web") y no se suben datos reales a este repositorio, que es público como sitio web.
