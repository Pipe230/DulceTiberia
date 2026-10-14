/**
 * DulceTiberia · Organizador semanal
 *
 * Google Apps Script que vive dentro de una planilla de Google. Lee los
 * pedidos, las fichas técnicas (recetas), los insumos y las tareas de cada
 * producto, y cada domingo a las 19:00 envía por correo el plan de la semana
 * siguiente: qué comprar cada día, qué preparar y qué entregar.
 *
 * Las funciones de cálculo (generarPlan, formatearReporte y sus ayudantes)
 * no usan servicios de Google, así que se pueden probar con Node
 * (ver pruebas/plan.test.js). Las funciones con SpreadsheetApp, GmailApp o
 * ScriptApp están al final.
 */

var HOJAS = {
  pedidos: 'Pedidos',
  recetas: 'Recetas',
  insumos: 'Insumos',
  tareas: 'Tareas',
  config: 'Configuración',
  reporte: 'Último reporte'
};

var ENCABEZADOS = {
  Pedidos: ['ID', 'Fecha entrega', 'Hora', 'Cliente', 'Canal', 'Producto', 'Cantidad', 'Entrega', 'Dirección', 'Estado', 'Pagado', 'Notas'],
  Recetas: ['Producto', 'Insumo', 'Cantidad por unidad', 'Unidad'],
  Insumos: ['Insumo', 'Unidad', 'Tipo', 'Días antes de compra', 'Dónde comprar'],
  Tareas: ['Producto', 'Tarea', 'Días antes de entrega'],
  'Configuración': ['Clave', 'Valor']
};

var DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ======================= Fechas (texto AAAA-MM-DD) ======================= */

function aFechaUTC(iso) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}

function aIso(fecha) {
  return fecha.toISOString().slice(0, 10);
}

function sumarDias(iso, dias) {
  var f = aFechaUTC(iso);
  f.setUTCDate(f.getUTCDate() + dias);
  return aIso(f);
}

function diaSemana(iso) {
  return aFechaUTC(iso).getUTCDay();
}

/** Lunes de la semana que viene. Un domingo devuelve el día siguiente. */
function proximoLunes(isoHoy) {
  var d = diaSemana(isoHoy);
  return sumarDias(isoHoy, d === 0 ? 1 : 8 - d);
}

/** Lunes de la semana en curso (el domingo pertenece a la semana que termina). */
function lunesActual(isoHoy) {
  var d = diaSemana(isoHoy);
  return sumarDias(isoHoy, d === 0 ? -6 : 1 - d);
}

function nombreDia(iso) {
  var f = aFechaUTC(iso);
  return DIAS_SEMANA[f.getUTCDay()] + ' ' + f.getUTCDate();
}

function nombreDiaLargo(iso) {
  var f = aFechaUTC(iso);
  return nombreDia(iso) + ' de ' + MESES[f.getUTCMonth()];
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* =========================== Normalización =========================== */

function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function aNumero(valor) {
  if (typeof valor === 'number') return valor;
  var n = parseFloat(String(valor == null ? '' : valor).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** Convierte filas (arreglos) en objetos usando la primera fila como encabezado. */
function filasAObjetos(filas) {
  if (!filas || filas.length < 2) return [];
  var claves = filas[0].map(function (c) { return String(c).trim(); });
  return filas.slice(1)
    .filter(function (fila) {
      return fila.some(function (celda) { return String(celda == null ? '' : celda).trim() !== ''; });
    })
    .map(function (fila) {
      var obj = {};
      claves.forEach(function (clave, i) { obj[clave] = fila[i]; });
      return obj;
    });
}

/* ============================ Cantidades ============================ */

function redondear(n) {
  return Math.round(n * 100) / 100;
}

function formatearCantidad(cantidad, unidad) {
  var u = normalizar(unidad);
  if (u === 'g' && cantidad >= 1000) return redondear(cantidad / 1000) + ' kg';
  if (u === 'ml' && cantidad >= 1000) return redondear(cantidad / 1000) + ' L';
  return redondear(cantidad) + ' ' + unidad;
}

/* ============================ Plan semanal ============================ */

/**
 * Calcula el plan de la semana que empieza en `lunes` (AAAA-MM-DD).
 *
 * datos = { pedidos, recetas, insumos, tareas } como arreglos de objetos con
 * los encabezados de ENCABEZADOS. Las fechas deben venir como AAAA-MM-DD.
 *
 * Reglas:
 * - Solo se planifican pedidos con Estado "Confirmado".
 * - Cada tarea cae N días antes de la entrega (hoja Tareas). Si un producto no
 *   tiene tareas, se asume "Preparar" el día anterior.
 * - Los insumos frescos y refrigerados se compran "Días antes de compra"
 *   antes del primer día de trabajo del pedido. Los de Tipo "Seco" se juntan
 *   en una sola compra el lunes de la semana en que se empieza a trabajar,
 *   para hacer un solo viaje al mayorista.
 * - Lo que debió hacerse antes del lunes se pasa al lunes y queda como alerta.
 * - Se miran también los pedidos de la semana siguiente, porque sus compras y
 *   preparaciones pueden caer en esta.
 */
function generarPlan(datos, lunes) {
  var domingo = sumarDias(lunes, 6);
  var limite = sumarDias(lunes, 13);
  var dias = {};
  for (var i = 0; i < 7; i++) {
    var iso = sumarDias(lunes, i);
    dias[iso] = { fecha: iso, entregas: [], tareas: [], compras: {} };
  }

  var recetasPorProducto = agrupar(datos.recetas || [], 'Producto');
  var tareasPorProducto = agrupar(datos.tareas || [], 'Producto');
  var insumos = {};
  (datos.insumos || []).forEach(function (fila) {
    insumos[normalizar(fila['Insumo'])] = fila;
  });

  var alertas = [];
  var porConfirmar = [];
  var porCobrar = {};
  var sinReceta = {};

  function enSemana(iso) { return iso >= lunes && iso <= domingo; }

  function agregarCompra(fecha, nombre, cantidad, unidad, donde) {
    var clave = normalizar(nombre) + '|' + normalizar(unidad);
    var compras = dias[fecha].compras;
    if (!compras[clave]) compras[clave] = { insumo: nombre, cantidad: 0, unidad: unidad, donde: donde };
    compras[clave].cantidad += cantidad;
  }

  (datos.pedidos || []).forEach(function (p) {
    var entrega = String(p['Fecha entrega'] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entrega) || entrega < lunes || entrega > limite) return;

    var estado = normalizar(p['Estado']);
    var producto = String(p['Producto'] || '').trim();
    var cantidad = aNumero(p['Cantidad']) || 1;
    var cliente = String(p['Cliente'] || '').trim() || 'Sin nombre';
    var etiqueta = cantidad + ' × ' + producto + ' (' + cliente + ')';

    if (estado === 'cancelado') return;
    if (estado !== 'confirmado') {
      porConfirmar.push({ fecha: entrega, cliente: cliente, producto: producto, cantidad: cantidad, canal: p['Canal'] || '' });
      return;
    }

    if (enSemana(entrega)) {
      dias[entrega].entregas.push({
        hora: String(p['Hora'] || '').trim(),
        cliente: cliente,
        producto: producto,
        cantidad: cantidad,
        entrega: String(p['Entrega'] || '').trim(),
        direccion: String(p['Dirección'] || '').trim(),
        notas: String(p['Notas'] || '').trim()
      });
      var pagado = normalizar(p['Pagado']);
      if (pagado !== 'si') {
        var id = String(p['ID'] || cliente + entrega);
        porCobrar[id] = { fecha: entrega, cliente: cliente, estado: pagado === 'abono' ? 'abono' : 'sin pago' };
      }
    }

    // Tareas de preparación
    var tareas = tareasPorProducto[normalizar(producto)] || [{ 'Tarea': 'Preparar', 'Días antes de entrega': 1 }];
    var primerDia = entrega;
    tareas.forEach(function (t) {
      var fecha = sumarDias(entrega, -aNumero(t['Días antes de entrega']));
      if (fecha < primerDia) primerDia = fecha;
      var texto = String(t['Tarea']).trim() + ': ' + etiqueta + ' · entrega ' + nombreDia(entrega);
      if (fecha < lunes) {
        alertas.push('Tarea atrasada (era para el ' + nombreDia(fecha) + '): ' + texto);
        dias[lunes].tareas.push(texto + ' ⚠️ atrasada');
      } else if (fecha <= domingo) {
        dias[fecha].tareas.push(texto);
      }
    });

    // Compras según la ficha técnica
    var receta = recetasPorProducto[normalizar(producto)];
    if (!receta) {
      sinReceta[producto] = true;
      return;
    }
    receta.forEach(function (r) {
      var nombre = String(r['Insumo']).trim();
      var info = insumos[normalizar(nombre)] || {};
      var unidad = String(r['Unidad'] || info['Unidad'] || '').trim();
      var total = aNumero(r['Cantidad por unidad']) * cantidad;
      var fecha;
      if (normalizar(info['Tipo']) === 'seco') {
        // Secos: compra mayorista del lunes de la semana en que se empieza a trabajar.
        if (primerDia > domingo) return;
        fecha = primerDia < lunes ? sumarDias(primerDia, -1) : lunes;
      } else {
        var diasAntes = info['Días antes de compra'] === undefined || info['Días antes de compra'] === '' ? 1 : aNumero(info['Días antes de compra']);
        fecha = sumarDias(primerDia, -diasAntes);
        if (fecha > domingo) return;
      }
      if (fecha < lunes) {
        alertas.push('Compra atrasada (era para el ' + nombreDia(fecha) + '): ' + formatearCantidad(total, unidad) + ' de ' + nombre + ' para ' + etiqueta);
        fecha = lunes;
      }
      agregarCompra(fecha, nombre, total, unidad, String(info['Dónde comprar'] || '').trim());
    });
  });

  Object.keys(sinReceta).forEach(function (producto) {
    alertas.push('"' + producto + '" no tiene ficha técnica en la hoja Recetas: no se calcularon sus compras.');
  });

  var listaDias = Object.keys(dias).sort().map(function (iso) {
    var d = dias[iso];
    d.entregas.sort(function (a, b) { return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0; });
    d.compras = Object.keys(d.compras).map(function (k) { return d.compras[k]; })
      .sort(function (a, b) { return a.insumo.localeCompare(b.insumo, 'es'); });
    return d;
  });

  return {
    lunes: lunes,
    domingo: domingo,
    dias: listaDias,
    porConfirmar: porConfirmar.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }),
    porCobrar: Object.keys(porCobrar).map(function (k) { return porCobrar[k]; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }),
    alertas: alertas
  };
}

function agrupar(filas, campo) {
  var grupos = {};
  filas.forEach(function (fila) {
    var clave = normalizar(fila[campo]);
    if (!clave) return;
    (grupos[clave] = grupos[clave] || []).push(fila);
  });
  return grupos;
}

/* ============================== Reporte ============================== */

/** Texto con formato de WhatsApp (*negrita*), que también se lee bien por correo. */
function formatearReporte(plan, nombre) {
  var lineas = [];
  var totalEntregas = plan.dias.reduce(function (n, d) { return n + d.entregas.length; }, 0);

  lineas.push('🍰 *Semana del ' + nombreDiaLargo(plan.lunes) + ' al ' + nombreDiaLargo(plan.domingo) + '*');
  lineas.push('Hola' + (nombre ? ' ' + nombre : '') + ', este es el plan de la semana: ' +
    totalEntregas + (totalEntregas === 1 ? ' entrega' : ' entregas') +
    (plan.porConfirmar.length ? ' y ' + plan.porConfirmar.length + ' por confirmar' : '') + '.');

  plan.dias.forEach(function (d) {
    lineas.push('');
    lineas.push('📅 *' + capitalizar(nombreDia(d.fecha)) + '*');
    if (!d.compras.length && !d.tareas.length && !d.entregas.length) {
      lineas.push('  Día libre 🙌');
      return;
    }
    if (d.compras.length) {
      lineas.push('  🛒 Comprar' + (d.fecha === plan.lunes ? ' (incluye compra mayorista de secos)' : '') + ':');
      d.compras.forEach(function (c) {
        lineas.push('   • ' + c.insumo + ': ' + formatearCantidad(c.cantidad, c.unidad) + (c.donde ? ' — ' + c.donde : ''));
      });
    }
    if (d.tareas.length) {
      lineas.push('  👩‍🍳 Preparar:');
      d.tareas.forEach(function (t) { lineas.push('   • ' + t); });
    }
    if (d.entregas.length) {
      lineas.push('  🚚 Entregar:');
      d.entregas.forEach(function (e) {
        var detalle = [e.hora, e.cliente, e.cantidad + ' × ' + e.producto, e.entrega + (e.direccion ? ' en ' + e.direccion : '')]
          .filter(function (x) { return x; }).join(' · ');
        lineas.push('   • ' + detalle + (e.notas ? ' (' + e.notas + ')' : ''));
      });
    }
  });

  if (plan.porCobrar.length) {
    lineas.push('');
    lineas.push('💰 *Por cobrar antes de entregar*');
    plan.porCobrar.forEach(function (c) {
      lineas.push('   • ' + c.cliente + ' — entrega ' + nombreDia(c.fecha) + ' (' + c.estado + ')');
    });
  }

  if (plan.porConfirmar.length) {
    lineas.push('');
    lineas.push('❓ *Pedidos por confirmar* (no se incluyeron en el plan)');
    plan.porConfirmar.forEach(function (p) {
      lineas.push('   • ' + nombreDia(p.fecha) + ': ' + p.cantidad + ' × ' + p.producto + ' (' + p.cliente + (p.canal ? ', ' + p.canal : '') + ')');
    });
  }

  if (plan.alertas.length) {
    lineas.push('');
    lineas.push('⚠️ *Revisar*');
    plan.alertas.forEach(function (a) { lineas.push('   • ' + a); });
  }

  return lineas.join('\n');
}

function reporteAHtml(texto) {
  var html = texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">' + html + '</div>';
}

/* ===================== Funciones de Google Apps Script ===================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍰 DulceTiberia')
    .addItem('Ver plan de la próxima semana', 'verPlanProximaSemana')
    .addItem('Ver plan de esta semana', 'verPlanEstaSemana')
    .addItem('Enviar reporte ahora por correo', 'enviarReporteSemanal')
    .addSeparator()
    .addItem('Activar envío automático (domingos 19:00)', 'instalarDisparadorSemanal')
    .addItem('Crear hojas con datos de ejemplo', 'configurarPlanilla')
    .addToUi();
}

function hoyIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function leerHoja(libro, nombre) {
  var hoja = libro.getSheetByName(nombre);
  if (!hoja) return [];
  var zona = Session.getScriptTimeZone();
  var filas = hoja.getDataRange().getValues().map(function (fila, i) {
    return fila.map(function (celda) {
      if (i > 0 && celda instanceof Date) {
        // Las celdas de solo hora vienen con fecha 1899-12-30.
        return celda.getFullYear() < 1901
          ? Utilities.formatDate(celda, zona, 'HH:mm')
          : Utilities.formatDate(celda, zona, 'yyyy-MM-dd');
      }
      return celda;
    });
  });
  return filasAObjetos(filas);
}

function leerConfiguracion(libro) {
  var config = {};
  leerHoja(libro, HOJAS.config).forEach(function (fila) {
    config[normalizar(fila['Clave'])] = String(fila['Valor'] || '').trim();
  });
  return config;
}

function construirReporte(lunes) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var config = leerConfiguracion(libro);
  var plan = generarPlan({
    pedidos: leerHoja(libro, HOJAS.pedidos),
    recetas: leerHoja(libro, HOJAS.recetas),
    insumos: leerHoja(libro, HOJAS.insumos),
    tareas: leerHoja(libro, HOJAS.tareas)
  }, lunes);
  var texto = formatearReporte(plan, config['nombre']);

  var hoja = libro.getSheetByName(HOJAS.reporte) || libro.insertSheet(HOJAS.reporte);
  hoja.clear();
  hoja.getRange(1, 1, texto.split('\n').length, 1)
    .setValues(texto.split('\n').map(function (l) { return [l]; }));
  hoja.setColumnWidth(1, 900);

  return { plan: plan, texto: texto, config: config };
}

function mostrarReporte(lunes) {
  var r = construirReporte(lunes);
  var html = HtmlService.createHtmlOutput(reporteAHtml(r.texto)).setWidth(700).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Plan semanal');
}

function verPlanProximaSemana() { mostrarReporte(proximoLunes(hoyIso())); }
function verPlanEstaSemana() { mostrarReporte(lunesActual(hoyIso())); }

/** La ejecuta el disparador de cada domingo. */
function enviarReporteSemanal() {
  var r = construirReporte(proximoLunes(hoyIso()));
  var destino = r.config['correo destino'] || Session.getEffectiveUser().getEmail();
  GmailApp.sendEmail(destino, '🍰 Plan de la semana del ' + nombreDiaLargo(r.plan.lunes), r.texto, {
    htmlBody: reporteAHtml(r.texto),
    name: 'Organizador DulceTiberia'
  });
}

function instalarDisparadorSemanal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarReporteSemanal') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarReporteSemanal')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(19)
    .create();
  SpreadsheetApp.getUi().alert('Listo: el plan se enviará cada domingo entre las 19:00 y las 20:00.');
}

/** Crea las hojas que falten, con listas desplegables y datos de ejemplo. */
function configurarPlanilla() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var lunes = proximoLunes(hoyIso());
  var ejemplo = datosDeEjemplo(lunes);

  Object.keys(ENCABEZADOS).forEach(function (nombre) {
    if (libro.getSheetByName(nombre)) return;
    var hoja = libro.insertSheet(nombre);
    var filas = [ENCABEZADOS[nombre]].concat(ejemplo[nombre] || []);
    hoja.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
    hoja.getRange(1, 1, 1, filas[0].length).setFontWeight('bold').setBackground('#F4E3E6');
    hoja.setFrozenRows(1);
    hoja.autoResizeColumns(1, filas[0].length);
  });

  var pedidos = libro.getSheetByName(HOJAS.pedidos);
  var lista = function (valores) {
    return SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build();
  };
  pedidos.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  pedidos.getRange('E2:E').setDataValidation(lista(['Instagram', 'WhatsApp', 'Correo', 'Formulario web', 'Teléfono', 'En persona']));
  pedidos.getRange('H2:H').setDataValidation(lista(['Delivery', 'Retiro']));
  pedidos.getRange('J2:J').setDataValidation(lista(['Confirmado', 'Por confirmar', 'Cancelado']));
  pedidos.getRange('K2:K').setDataValidation(lista(['Sí', 'Abono', 'No']));
  libro.getSheetByName(HOJAS.insumos).getRange('C2:C').setDataValidation(lista(['Seco', 'Fresco', 'Refrigerado']));

  SpreadsheetApp.getUi().alert('Hojas creadas. Reemplaza los datos de ejemplo por los reales y escribe tu correo en la hoja Configuración.');
}

function datosDeEjemplo(lunes) {
  var d = function (n) { return sumarDias(lunes, n); };
  return {
    Pedidos: [
      ['P-001', d(1), '10:00', 'Constructora Norte', 'Correo', 'Coffee break ejecutivo (persona)', 25, 'Delivery', 'Av. Grecia 1200', 'Confirmado', 'Sí', 'Factura'],
      ['P-002', d(3), '16:00', 'María González', 'Instagram', 'Torta manjar lúcuma (20 personas)', 1, 'Retiro', '', 'Confirmado', 'Abono', 'Sin nueces'],
      ['P-002', d(3), '16:00', 'María González', 'Instagram', 'Cupcakes (docena)', 2, 'Retiro', '', 'Confirmado', 'Abono', 'Rosas'],
      ['P-003', d(5), '12:00', 'Camila Rojas', 'WhatsApp', 'Pie de limón', 2, 'Delivery', 'Jardines del Sur', 'Confirmado', 'No', ''],
      ['P-004', d(6), '11:00', 'Pedro Soto', 'WhatsApp', 'Cakesicles (docena)', 1, 'Retiro', '', 'Por confirmar', 'No', 'Baby shower']
    ],
    Recetas: [
      ['Torta manjar lúcuma (20 personas)', 'Harina', 600, 'g'],
      ['Torta manjar lúcuma (20 personas)', 'Huevos', 10, 'un'],
      ['Torta manjar lúcuma (20 personas)', 'Azúcar', 500, 'g'],
      ['Torta manjar lúcuma (20 personas)', 'Manjar', 1000, 'g'],
      ['Torta manjar lúcuma (20 personas)', 'Crema para batir', 1000, 'ml'],
      ['Torta manjar lúcuma (20 personas)', 'Pulpa de lúcuma', 500, 'g'],
      ['Cupcakes (docena)', 'Harina', 250, 'g'],
      ['Cupcakes (docena)', 'Huevos', 4, 'un'],
      ['Cupcakes (docena)', 'Azúcar', 200, 'g'],
      ['Cupcakes (docena)', 'Mantequilla', 200, 'g'],
      ['Cupcakes (docena)', 'Azúcar flor', 300, 'g'],
      ['Pie de limón', 'Harina', 250, 'g'],
      ['Pie de limón', 'Mantequilla', 125, 'g'],
      ['Pie de limón', 'Leche condensada', 2, 'tarros'],
      ['Pie de limón', 'Limones', 6, 'un'],
      ['Pie de limón', 'Huevos', 4, 'un'],
      ['Coffee break ejecutivo (persona)', 'Café de grano', 15, 'g'],
      ['Coffee break ejecutivo (persona)', 'Leche', 100, 'ml'],
      ['Coffee break ejecutivo (persona)', 'Pan de molde', 2, 'rebanadas'],
      ['Coffee break ejecutivo (persona)', 'Jamón', 30, 'g'],
      ['Coffee break ejecutivo (persona)', 'Queso', 30, 'g']
    ],
    Insumos: [
      ['Harina', 'g', 'Seco', 3, 'Mayorista'],
      ['Azúcar', 'g', 'Seco', 3, 'Mayorista'],
      ['Azúcar flor', 'g', 'Seco', 3, 'Mayorista'],
      ['Manjar', 'g', 'Seco', 3, 'Mayorista'],
      ['Leche condensada', 'tarros', 'Seco', 3, 'Mayorista'],
      ['Café de grano', 'g', 'Seco', 3, 'Tostaduría'],
      ['Huevos', 'un', 'Fresco', 1, 'Feria'],
      ['Limones', 'un', 'Fresco', 1, 'Feria'],
      ['Mantequilla', 'g', 'Refrigerado', 1, 'Supermercado'],
      ['Crema para batir', 'ml', 'Refrigerado', 1, 'Supermercado'],
      ['Pulpa de lúcuma', 'g', 'Refrigerado', 1, 'Supermercado'],
      ['Leche', 'ml', 'Refrigerado', 1, 'Supermercado'],
      ['Jamón', 'g', 'Refrigerado', 1, 'Supermercado'],
      ['Queso', 'g', 'Refrigerado', 1, 'Supermercado'],
      ['Pan de molde', 'rebanadas', 'Fresco', 1, 'Panadería']
    ],
    Tareas: [
      ['Torta manjar lúcuma (20 personas)', 'Hornear bizcochos', 2],
      ['Torta manjar lúcuma (20 personas)', 'Rellenar y decorar', 1],
      ['Cupcakes (docena)', 'Hornear', 1],
      ['Cupcakes (docena)', 'Decorar', 0],
      ['Pie de limón', 'Hornear masa y relleno', 1],
      ['Pie de limón', 'Merengue', 0],
      ['Coffee break ejecutivo (persona)', 'Preparar bocados', 0]
    ],
    'Configuración': [
      ['Correo destino', ''],
      ['Nombre', 'Mamá']
    ]
  };
}

// Permite cargar este archivo en Node para las pruebas; Apps Script lo ignora.
if (typeof module !== 'undefined') {
  module.exports = {
    generarPlan: generarPlan,
    formatearReporte: formatearReporte,
    reporteAHtml: reporteAHtml,
    filasAObjetos: filasAObjetos,
    proximoLunes: proximoLunes,
    lunesActual: lunesActual,
    sumarDias: sumarDias,
    formatearCantidad: formatearCantidad,
    datosDeEjemplo: datosDeEjemplo,
    ENCABEZADOS: ENCABEZADOS
  };
}
