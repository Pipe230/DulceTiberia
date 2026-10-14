// Ejecutar con: node --test organizador/pruebas/plan.test.js
// Ver el reporte de ejemplo: node organizador/pruebas/plan.test.js --mostrar
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

// Codigo.gs es JavaScript normal; se carga como módulo CommonJS.
const archivo = path.join(__dirname, '..', 'Codigo.gs');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(archivo, 'utf8'), { module: mod });
const g = mod.exports;

const LUNES = '2026-10-19';

function datosEjemplo() {
  const e = g.datosDeEjemplo(LUNES);
  const tabla = (nombre) => g.filasAObjetos([g.ENCABEZADOS[nombre]].concat(e[nombre]));
  return { pedidos: tabla('Pedidos'), recetas: tabla('Recetas'), insumos: tabla('Insumos'), tareas: tabla('Tareas') };
}

const dia = (plan, iso) => plan.dias.find((d) => d.fecha === iso);
const compra = (d, insumo) => d.compras.find((c) => c.insumo === insumo);

test('cálculo de lunes', () => {
  assert.strictEqual(g.proximoLunes('2026-10-18'), '2026-10-19'); // domingo
  assert.strictEqual(g.proximoLunes('2026-10-14'), '2026-10-19'); // miércoles
  assert.strictEqual(g.proximoLunes('2026-10-19'), '2026-10-26'); // lunes
  assert.strictEqual(g.lunesActual('2026-10-18'), '2026-10-12');
  assert.strictEqual(g.lunesActual('2026-10-14'), '2026-10-12');
});

test('los secos se juntan en la compra del lunes', () => {
  const plan = g.generarPlan(datosEjemplo(), LUNES);
  const lunes = dia(plan, LUNES);
  // Harina: torta 600 + cupcakes 2×250 + pie 2×250 = 1600 g
  assert.strictEqual(compra(lunes, 'Harina').cantidad, 1600);
  assert.strictEqual(compra(lunes, 'Manjar').cantidad, 1000);
  assert.strictEqual(compra(lunes, 'Café de grano').cantidad, 25 * 15);
});

test('los frescos se compran el día antes de empezar a trabajar', () => {
  const plan = g.generarPlan(datosEjemplo(), LUNES);
  // Torta entrega jueves 22, hornea martes 20 → crema el lunes 19
  assert.strictEqual(compra(dia(plan, '2026-10-19'), 'Crema para batir').cantidad, 1000);
  // Pie entrega sábado 24, hornea viernes 23 → limones el jueves 22
  assert.strictEqual(compra(dia(plan, '2026-10-22'), 'Limones').cantidad, 12);
  // Huevos: torta+cupcakes el lunes y martes respectivamente, pie el jueves
  assert.strictEqual(compra(dia(plan, '2026-10-19'), 'Huevos').cantidad, 10);
  assert.strictEqual(compra(dia(plan, '2026-10-20'), 'Huevos').cantidad, 8);
  assert.strictEqual(compra(dia(plan, '2026-10-22'), 'Huevos').cantidad, 8);
});

test('tareas, entregas, cobros y pedidos por confirmar', () => {
  const plan = g.generarPlan(datosEjemplo(), LUNES);
  assert.ok(dia(plan, '2026-10-20').tareas.some((t) => t.startsWith('Hornear bizcochos')));
  assert.strictEqual(dia(plan, '2026-10-22').entregas.length, 2);
  assert.deepStrictEqual([...plan.porCobrar.map((c) => c.cliente)], ['María González', 'Camila Rojas']);
  assert.strictEqual(plan.porConfirmar.length, 1);
  assert.strictEqual(plan.porConfirmar[0].cliente, 'Pedro Soto');
  assert.strictEqual(plan.alertas.length, 0);
});

test('lo atrasado pasa al lunes con alerta y se avisa si falta la receta', () => {
  const datos = datosEjemplo();
  datos.pedidos = g.filasAObjetos([g.ENCABEZADOS.Pedidos,
    ['X', LUNES, '09:00', 'Ana', 'WhatsApp', 'Torta manjar lúcuma (20 personas)', 1, 'Retiro', '', 'Confirmado', 'Sí', ''],
    ['Y', '2026-10-21', '09:00', 'Luis', 'Instagram', 'Alfajores', 3, 'Retiro', '', 'confirmado', 'si', '']]);
  const plan = g.generarPlan(datos, LUNES);
  assert.ok(dia(plan, LUNES).tareas.some((t) => t.includes('atrasada')));
  assert.ok(plan.alertas.some((a) => a.startsWith('Compra atrasada')));
  assert.ok(plan.alertas.some((a) => a.includes('"Alfajores" no tiene ficha técnica')));
  // Sin tareas definidas: "Preparar" el día anterior
  assert.ok(dia(plan, '2026-10-20').tareas.some((t) => t.startsWith('Preparar: 3 × Alfajores')));
});

test('pedidos de la semana siguiente generan compras en esta', () => {
  const datos = datosEjemplo();
  datos.pedidos = g.filasAObjetos([g.ENCABEZADOS.Pedidos,
    ['Z', '2026-10-27', '10:00', 'Ana', 'Correo', 'Torta manjar lúcuma (20 personas)', 1, 'Retiro', '', 'Confirmado', 'Sí', '']]);
  const plan = g.generarPlan(datos, LUNES);
  // Hornea el domingo 25 → crema el sábado 24 y secos en el mayorista del lunes
  assert.ok(dia(plan, '2026-10-25').tareas.length === 1);
  assert.strictEqual(compra(dia(plan, '2026-10-24'), 'Crema para batir').cantidad, 1000);
  assert.strictEqual(compra(dia(plan, LUNES), 'Harina').cantidad, 600);
  // Un pedido que empieza a trabajarse la otra semana no compra secos en esta
  datos.pedidos[0]['Fecha entrega'] = '2026-10-29';
  assert.ok(!compra(dia(g.generarPlan(datos, LUNES), LUNES), 'Harina'));
  assert.ok(plan.dias.every((d) => d.entregas.length === 0));
});

test('formato del reporte', () => {
  assert.strictEqual(g.formatearCantidad(1600, 'g'), '1.6 kg');
  assert.strictEqual(g.formatearCantidad(2000, 'ml'), '2 L');
  assert.strictEqual(g.formatearCantidad(12, 'un'), '12 un');
  const texto = g.formatearReporte(g.generarPlan(datosEjemplo(), LUNES), 'Mamá');
  assert.match(texto, /Semana del lunes 19 de octubre al domingo 25 de octubre/);
  assert.match(texto, /Harina: 1\.6 kg — Mayorista/);
  assert.match(texto, /Pedidos por confirmar/);
  assert.ok(!g.reporteAHtml('<b>x</b> *y*').includes('<b>x</b>'));
});

if (process.argv.includes('--mostrar')) {
  console.log(g.formatearReporte(g.generarPlan(datosEjemplo(), LUNES), 'Mamá'));
}
