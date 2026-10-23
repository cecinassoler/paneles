// Guarda en el repositorio las metas ya cargadas, para que no se pierdan cuando la planilla pase al año siguiente
// (y para usarlas si un dia el Excel no se puede leer).
// Se conservan solo los ultimos 12 meses: desde el mismo mes del año pasado en adelante
// (en enero 2027 quedan enero 2026 .. enero 2027, mas los meses futuros que ya tengan meta).
// Uso:
//   node guardar_metas.mjs unir    <config base.json> <metas_guardadas.json> <salida.json>
//        -> config base + metas guardadas (las guardadas mandan, mes a mes)
//   node guardar_metas.mjs recortar <config.json>
//        -> deja en config.json solo las metas desde el mismo mes del año pasado (hora de Chile) en adelante
//   node guardar_metas.mjs guardar <config final.json> <metas_guardadas.json>
//        -> escribe metas y metasTotal en metas_guardadas.json; imprime "guardadas: cambio" o "guardadas: igual"
import fs from 'node:fs';
const [modo, a, b, c] = process.argv.slice(2);
const leer = p => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j.data || j; };
const ordenar = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? ordenar(o[k]) : o[k]]));

function desde() {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  return (+hoy.slice(0, 4) - 1) + '-' + hoy.slice(5, 7);
}
function recortar(cfg) {
  const min = process.env.METAS_DESDE || desde();
  const filtra = o => Object.fromEntries(Object.entries(o || {}).filter(([m]) => m >= min));
  const metas = {};
  for (const v in cfg.metas || {}) { const f = filtra(cfg.metas[v]); if (Object.keys(f).length) metas[v] = f; }
  return Object.assign({}, cfg, { metas, metasTotal: filtra(cfg.metasTotal), metasDesde: min });
}

if (modo === 'recortar') {
  const cfg = recortar(leer(a));
  fs.writeFileSync(a, JSON.stringify(cfg));
  const k = Object.keys(cfg.metasTotal || {}).sort();
  console.log(`metas en uso: ${k.length} meses (${k[0] || '-'} .. ${k[k.length - 1] || '-'})`);
} else if (modo === 'unir') {
  const cfg = leer(a);
  if (fs.existsSync(b)) {
    const g = leer(b);
    cfg.metas = cfg.metas || {}; cfg.metasTotal = cfg.metasTotal || {};
    for (const v in g.metas || {}) cfg.metas[v] = Object.assign({}, cfg.metas[v], g.metas[v]);
    Object.assign(cfg.metasTotal, g.metasTotal || {});
    const meses = Object.keys(g.metasTotal || {}).sort();
    console.log(`metas guardadas: ${meses.length} meses (${meses[0] || '-'} .. ${meses[meses.length - 1] || '-'})`);
  } else console.log('metas guardadas: todavia no hay (se crean en la primera carga)');
  fs.writeFileSync(c, JSON.stringify(cfg));
} else if (modo === 'guardar') {
  const cfg = recortar(leer(a));
  const nuevo = JSON.stringify(ordenar({ metas: cfg.metas || {}, metasTotal: cfg.metasTotal || {} }), null, 1) + '\n';
  const viejo = fs.existsSync(b) ? fs.readFileSync(b, 'utf8') : '';
  if (nuevo !== viejo) { fs.writeFileSync(b, nuevo); console.log('guardadas: cambio'); }
  else console.log('guardadas: igual');
} else { console.log('Uso: node guardar_metas.mjs unir|guardar ...'); process.exit(1); }
