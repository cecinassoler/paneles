// Panel Comercial Cecinas Soler - lectura de metas mensuales desde "Metas vendedores.xlsx" (texto de read_resource)
// Uso: node metas.mjs <metas.txt> <config soler.json> <salida.json> [archivo con el anio | anio]
// Si se indica el anio (leido de la planilla), se usa ese y no se adivina por la fecha.
// Siempre escribe <salida.json> (config a usar) e imprime metasSha; si no puede leer metas deja la config tal cual.
import fs from 'node:fs'; import crypto from 'node:crypto';
const [txtPath, cfgPath, outPath, anioArg] = process.argv.slice(2);
if (!outPath) { console.log(JSON.stringify({ estado: 'ERROR', error: 'faltan argumentos' })); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); const cfg = raw.data || raw;
const shaOf = c => crypto.createHash('sha256').update(JSON.stringify([c.metas, c.metasTotal, c.vendedores, c.ordenVendedores])).digest('hex').slice(0, 16);
const fin = (estado, c, extra) => { fs.writeFileSync(outPath, JSON.stringify(c)); console.log(JSON.stringify(Object.assign({ estado, metasSha: shaOf(c), salida: outPath }, extra))); process.exit(0); };
const fail = m => fin('ERROR', cfg, { error: m + ' (se mantienen las metas anteriores)' });
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');
const num = s => { s = String(s == null ? '' : s).replace(/[$\s,]/g, ''); if (!s || s === '-') return 0; const v = parseFloat(s); if (isNaN(v)) fail('valor no numerico: ' + s); return v; };
if (!fs.existsSync(txtPath)) fail('no se pudo leer la planilla de metas');
let txt = fs.readFileSync(txtPath, 'utf8'); if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
const lines = txt.split(/\r?\n/);
let hi = -1;
for (let i = 0; i < lines.length; i++) { const c = lines[i].split('\t').map(norm); if (c.includes('enero') && c.includes('diciembre')) { hi = i; break; } }
if (hi < 0) fail('no encontre la fila de meses (Enero..Diciembre)');
const hc = lines[hi].split('\t').map(norm), col = {};
hc.forEach((c, j) => { const m = MESES.indexOf(c); if (m >= 0) col[m] = j; });
if (Object.keys(col).length !== 12) fail('no estan los 12 meses en la fila de encabezado');
const rows = []; let total = null;
for (let i = hi + 2; i < lines.length; i++) {
  const l = lines[i]; if (/^Formulas:/i.test(l) || /^##/.test(l)) break;
  const c = l.split('\t'); const name = (c[0] || '').trim(); if (!name) continue;
  const vals = {}; for (let m = 0; m < 12; m++) { const j = col[m]; vals[m] = [num(c[j]), num(c[j + 1]), num(c[j + 2])]; }
  if (norm(name) === 'total') { total = vals; break; } rows.push({ name, vals });
}
if (!total) fail('no encontre la fila TOTAL');
if (rows.length < 3) fail('muy pocos vendedores en la planilla: ' + rows.length);
// meses con metas = los que tienen venta TOTAL > 0
const meses = Object.keys(total).map(Number).filter(m => total[m][0] > 0);
if (!meses.length) fail('la planilla no tiene ningun mes con metas');
// control: la suma de los vendedores debe cuadrar con la fila TOTAL
for (const m of meses) { const s = [0, 0, 0]; rows.forEach(r => r.vals[m].forEach((v, k) => s[k] += v));
  if (Math.abs(s[0] - total[m][0]) > 1 || Math.abs(s[1] - total[m][1]) > rows.length || Math.abs(s[2] - total[m][2]) > 0.5)
    fail(`la suma de vendedores no cuadra con TOTAL en ${MESES[m]}: ${s.join('/')} vs ${total[m].join('/')}`); }
// anio en curso (hora de Chile)
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const anioTxt = !anioArg ? '' : /^\d{4}$/.test(anioArg.trim()) ? anioArg.trim() : (fs.existsSync(anioArg) ? fs.readFileSync(anioArg, 'utf8').trim() : '');
const anioXls = /^20\d\d$/.test(anioTxt) ? +anioTxt : 0;
const anio = anioXls || +hoy.slice(0, 4), mesHoy = +hoy.slice(5, 7);
if (!anioXls && meses.length > mesHoy + 2) fin('OMITIDO', cfg, { motivo: `la planilla trae ${meses.length} meses con metas pero estamos en el mes ${mesHoy} de ${anio}: parece ser la del anio anterior; no se cargaron metas` });
// nombres de la planilla -> nombres del panel
const alias = {}; Object.entries(cfg.aliasMetas || {}).forEach(([k, v]) => alias[norm(k)] = v);
const conocidos = {}; (cfg.ordenVendedores || []).concat(Object.keys(cfg.metas || {})).forEach(v => conocidos[norm(v)] = v);
const avisos = [], metas = JSON.parse(JSON.stringify(cfg.metas || {})), metasTotal = JSON.parse(JSON.stringify(cfg.metasTotal || {}));
const porV = {};
for (const r of rows) {
  let V = alias[norm(r.name)] || conocidos[norm(r.name)];
  if (!V) { V = r.name.trim(); avisos.push('vendedor nuevo en la planilla (no esta en el panel): ' + V); }
  const a = porV[V] || (porV[V] = {}); for (const m of meses) { const x = a[m] || (a[m] = [0, 0, 0]); r.vals[m].forEach((v, k) => x[k] += v); }
}
const ym = m => anio + '-' + String(m + 1).padStart(2, '0');
for (const V in porV) { const o = metas[V] || (metas[V] = {}); for (const m of meses) o[ym(m)] = porV[V][m].map(v => Math.round(v * 100) / 100); }
for (const m of meses) metasTotal[ym(m)] = total[m].map(v => Math.round(v * 100) / 100);
const igual = JSON.stringify(metas) === JSON.stringify(cfg.metas) && JSON.stringify(metasTotal) === JSON.stringify(cfg.metasTotal);
fin(igual ? 'IGUAL' : 'CAMBIO', Object.assign({}, cfg, { metas, metasTotal }), { anio, anioDesde: anioXls ? 'planilla' : 'fecha actual', meses: meses.map(ym), vendedores: Object.keys(porV).length, avisos });
