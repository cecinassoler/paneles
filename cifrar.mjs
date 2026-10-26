// Panel Comercial Cecinas Soler - cifrado con clave de las paginas publicadas (version publica y paneles por vendedor)
// Uso: node cifrar.mjs <claves.json> <dirSalida de actualizar.mjs>
// claves.json = {"publico":"<clave>","vendedores":{"<archivo>.html":"<clave>", ...}}
// Cifra EN SU LUGAR <dirSalida>/publico.html y <dirSalida>/vendedores/*.html (AES-256-GCM, clave derivada con PBKDF2-SHA256).
// Si algo falla (falta una clave, no hay datos, queda texto sin cifrar) imprime ERROR y no deja ningun archivo a medio cifrar.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
const [clavesPath, outDir] = process.argv.slice(2);
const fail = m => { console.log(JSON.stringify({ estado: 'ERROR', error: m })); process.exit(1); };
if (!outDir) fail('faltan argumentos');
const claves = JSON.parse(fs.readFileSync(clavesPath, 'utf8'));
const ITER = 250000;
const INI = '<!--SOLER-ENC-INI-->', FIN = '<!--SOLER-ENC-FIN-->';
const MARCA = 'window.__DATA__ = ';
const LOADER = `
<style>
  #solerLock{ position:fixed; inset:0; z-index:9999; background:var(--bg,#f4f5f3); display:flex; align-items:center; justify-content:center; padding:16px; }
  #solerLock[hidden]{ display:none !important; }
  #solerLock .lk-card{ width:100%; max-width:360px; background:var(--surface,#fff); color:var(--ink,#16201a); border:1px solid var(--border,rgba(0,0,0,.1)); border-radius:16px; padding:26px 24px; box-shadow:var(--shadow,0 8px 24px -16px rgba(0,0,0,.3)); font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif; }
  #solerLock .lk-brand{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--accent,#6e2130); }
  #solerLock h2{ font-family:'Archivo',system-ui,sans-serif; font-size:20px; margin:6px 0 4px; }
  #solerLock p{ font-size:13px; color:var(--ink-2,#4b564e); margin:0 0 16px; }
  #solerLock input{ width:100%; font:inherit; font-size:15px; padding:10px 12px; border-radius:10px; border:1px solid var(--border-strong,rgba(0,0,0,.2)); background:var(--surface,#fff); color:var(--ink,#16201a); }
  #solerLock button{ width:100%; margin-top:12px; font:inherit; font-size:14px; font-weight:700; padding:10px 12px; border-radius:10px; border:1px solid var(--accent,#6e2130); background:var(--accent,#6e2130); color:#fff; cursor:pointer; }
  #solerLock button:disabled{ opacity:.6; cursor:default; }
  #solerLock .lk-err{ font-size:12.5px; color:var(--critical,#d03b3b); min-height:18px; margin-top:10px; }
</style>
<div id="solerLock">
  <form class="lk-card" id="solerLockForm" autocomplete="off">
    <div class="lk-brand">Cecinas Soler</div>
    <h2 id="solerLockTitle">Panel Comercial</h2>
    <p>Ingresa la clave para ver el panel.</p>
    <input type="password" id="solerLockPass" placeholder="Clave" aria-label="Clave" autofocus>
    <button type="submit" id="solerLockBtn">Entrar</button>
    <div class="lk-err" id="solerLockErr" role="alert"></div>
  </form>
</div>
<script>
(function(){
  var lock=document.getElementById('solerLock'), form=document.getElementById('solerLockForm'), inp=document.getElementById('solerLockPass'),
      btn=document.getElementById('solerLockBtn'), err=document.getElementById('solerLockErr');
  var h1=document.querySelector('.masthead h1'); if(h1) document.getElementById('solerLockTitle').textContent=h1.textContent;
  var E=JSON.parse(document.getElementById('solerEnc').textContent);
  function b64(s){ var b=atob(s), u=new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
  async function abrir(clave){
    var base=await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
    var key=await crypto.subtle.deriveKey({name:'PBKDF2', salt:b64(E.s), iterations:E.it, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['decrypt']);
    var gz;
    try{ gz=await crypto.subtle.decrypt({name:'AES-GCM', iv:b64(E.iv)}, key, b64(E.c)); }catch(e){ return null; }
    var txt=await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(txt);
  }
  function mostrar(data){
    window.__DATA__=data;
    var olds=document.querySelectorAll('script[type="text/x-soler-app"]');
    for(var i=0;i<olds.length;i++){ var s=document.createElement('script'); s.textContent=olds[i].textContent; olds[i].parentNode.replaceChild(s, olds[i]); }
    lock.hidden=true;
  }
  async function intentar(clave, silencioso){
    btn.disabled=true; if(!silencioso) err.textContent='Abriendo…';
    try{
      var d=await abrir(clave);
      if(!d){ if(!silencioso){ err.textContent='Clave incorrecta.'; inp.select(); } btn.disabled=false; return; }
      try{ sessionStorage.setItem('solerClave', clave); }catch(e){}
      err.textContent=''; mostrar(d);
    }catch(e){ err.textContent='No se pudo abrir el panel en este navegador ('+(e&&e.message||e)+').'; btn.disabled=false; }
  }
  form.addEventListener('submit', function(ev){ ev.preventDefault(); if(inp.value) intentar(inp.value, false); });
  var guardada=null; try{ guardada=sessionStorage.getItem('solerClave'); }catch(e){}
  if(guardada) intentar(guardada, true);
})();
</script>`;

function cifrar(file, clave) {
  if (!clave || String(clave).length < 6) fail('falta la clave (o es muy corta) para ' + path.basename(file));
  let h = fs.readFileSync(file, 'utf8');
  const a = h.indexOf(MARCA); if (a < 0) fail('no encontre window.__DATA__ en ' + path.basename(file));
  const b = h.indexOf('</script>', a); if (b < 0) fail('script de datos sin cierre en ' + path.basename(file));
  let js = h.slice(a + MARCA.length, b).trim(); if (js.endsWith(';')) js = js.slice(0, -1);
  let data; try { data = JSON.parse(js); } catch (e) { fail('datos ilegibles en ' + path.basename(file) + ': ' + e.message); }
  if (!data || !Array.isArray(data.months) || !data.months.length || !data.cube) fail('la pagina ' + path.basename(file) + ' no trae datos para cifrar');
  // 1) datos -> marcador vacio (la plantilla sigue sirviendo para actualizar.mjs)
  h = h.slice(0, a) + MARCA + '{"meta":{}};\n' + h.slice(b);
  // 2) quitar el bloque de cifrado anterior (si la plantilla ya venia cifrada)
  const i0 = h.indexOf(INI), i1 = h.indexOf(FIN);
  if (i0 >= 0 && i1 > i0) h = h.slice(0, i0) + h.slice(i1 + FIN.length);
  // 3) cifrar: gzip(JSON) -> AES-256-GCM con clave PBKDF2(clave, sal aleatoria)
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(String(clave), salt, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 })), c.final(), c.getAuthTag()]);
  const blob = JSON.stringify({ v: 1, it: ITER, s: salt.toString('base64'), iv: iv.toString('base64'), c: enc.toString('base64') });
  // 4) insertar bloque nuevo justo despues del script de datos y diferir los scripts de la app
  const a2 = h.indexOf(MARCA), b2 = h.indexOf('</script>', a2) + '</script>'.length;
  let resto = h.slice(b2).replace(/<script>/g, '<script type="text/x-soler-app">');
  h = h.slice(0, b2) + '\n' + INI + '\n<script type="application/json" id="solerEnc">' + blob + '</script>' + LOADER + '\n' + FIN + resto;
  // 5) controles: no debe quedar ningun dato en claro
  for (const t of ['"porCliente"', '"cube"', '"churn"', '"monthLabels"']) if (h.includes(t)) fail('quedo texto sin cifrar (' + t + ') en ' + path.basename(file));
  const nApp = (h.match(/<script type="text\/x-soler-app">/g) || []).length;
  if (nApp < 2) fail('no encontre los scripts de la app en ' + path.basename(file));
  // prueba de ida y vuelta
  const E = JSON.parse(blob), k2 = crypto.pbkdf2Sync(String(clave), Buffer.from(E.s, 'base64'), E.it, 32, 'sha256');
  const raw = Buffer.from(E.c, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', k2, Buffer.from(E.iv, 'base64'));
  d.setAuthTag(raw.subarray(raw.length - 16));
  const back = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()])).toString('utf8'));
  if (JSON.stringify(back) !== JSON.stringify(data)) fail('la prueba de descifrado no cuadra en ' + path.basename(file));
  return { html: h, bytes: h.length, scriptsApp: nApp, vendedor: (data.meta && data.meta.vendedor) || null };
}

const trabajos = [];
const pub = path.join(outDir, 'publico.html');
if (fs.existsSync(pub)) trabajos.push({ file: pub, clave: claves.publico, nombre: 'publico.html' });
const dv = path.join(outDir, 'vendedores'), sinClave = [];
// un panel de vendedor sin clave asignada NO se puede publicar: se elimina de la salida (nunca queda en claro)
if (fs.existsSync(dv)) for (const f of fs.readdirSync(dv).filter(f => f.endsWith('.html')).sort()) {
  const k = (claves.vendedores || {})[f];
  if (!k) { fs.unlinkSync(path.join(dv, f)); sinClave.push(f); continue; }
  trabajos.push({ file: path.join(dv, f), clave: k, nombre: 'vendedores/' + f });
}
if (!trabajos.length) fail('no hay paginas para cifrar en ' + outDir);
// claves distintas entre paginas
const usadas = trabajos.map(t => t.clave); if (new Set(usadas).size !== usadas.length) fail('hay paginas con la misma clave');
const res = trabajos.map(t => Object.assign({ nombre: t.nombre, file: t.file }, cifrar(t.file, t.clave)));
for (const r of res) fs.writeFileSync(r.file, r.html); // se escribe solo si TODAS se cifraron bien
console.log(JSON.stringify({ estado: 'OK', sinClaveEliminados: sinClave, paginas:res.map(r => ({ pagina: r.nombre, vendedor: r.vendedor, bytes: r.bytes })) }, null, 1));
