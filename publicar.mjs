// Copia SOLO los paneles de los vendedores listados en vendedores.txt a la carpeta del sitio,
// con un sufijo derivado de la CLAVE secreta para que los links no se puedan adivinar.
// Uso: node publicar.mjs <dirPanelesVendedor> <vendedores.txt> <dirSitio>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [dirV, lista, dirSitio] = process.argv.slice(2);
const clave = process.env.CLAVE || '';
if (!clave) { console.log('ERROR: falta el secreto CLAVE'); process.exit(1); }
const slugs = fs.readFileSync(lista, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
fs.mkdirSync(dirSitio, { recursive: true });
const noindex = '<meta name="robots" content="noindex, nofollow">';
let ok = 0, faltan = [];
for (const slug of slugs) {
  const src = path.join(dirV, slug + '.html');
  if (!fs.existsSync(src)) { faltan.push(slug); continue; }
  const suf = crypto.createHash('sha256').update(clave + ':' + slug).digest('hex').slice(0, 8);
  let html = fs.readFileSync(src, 'utf8');
  html = html.replace('<title>', noindex + '\n<title>');
  fs.writeFileSync(path.join(dirSitio, `${slug}-${suf}.html`), html);
  ok++;
}
fs.writeFileSync(path.join(dirSitio, 'index.html'),
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + noindex +
  '<title>Cecinas Soler</title></head><body style="font-family:sans-serif;padding:24px">Panel Comercial Cecinas Soler. Usa el link personal que te enviaron.</body></html>');
fs.writeFileSync(path.join(dirSitio, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`Paneles publicados: ${ok} de ${slugs.length}` + (faltan.length ? ` (sin datos: ${faltan.join(', ')})` : ''));
if (!ok) process.exit(1);
