// Panel Comercial Cecinas Soler - actualizacion de datos (v5: margen solo en panel completo + metricas Cobertura + paneles por vendedor + paneles de grupo)
// Uso: node actualizar.mjs <config.json> <dirPaginas> <publico.html> <dirSalida> [genAnterior] [nAnterior] [shaAnterior]
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
var SOLER_CFG = (function(){ var j=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); return j.data||j; })();
var MES_NOMBRES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var SEP=String.fromCharCode(1);
var MES_CORTO=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function _split(line){
  if(line.indexOf('"')===-1) return line.split(';');
  var out=[],cur='',q=false;
  for(var i=0;i<line.length;i++){var ch=line[i];
    if(q){ if(ch==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
    else if(ch==='"') q=true; else if(ch===';'){out.push(cur);cur='';} else cur+=ch; }
  out.push(cur); return out;
}
function _num(s){
  if(s==null) return null; s=String(s).trim(); if(!s||s==='-'||/^\$\s*-$/.test(s)) return null;
  var neg=false; if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
  s=s.replace(/\$/g,'').replace(/\s/g,''); if(s.charAt(0)==='-'){neg=!neg;s=s.slice(1);}
  s=s.replace(/\./g,'').replace(',','.'); var v=parseFloat(s); if(isNaN(v)) return null; return neg?-v:v;
}
function _norm(s){ return String(s||'').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu,''); }
function parseInetCSV(text){
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  var lines=text.split(/\r?\n/), h=-1;
  for(var i=0;i<Math.min(lines.length,200);i++){ if(_norm(_split(lines[i])[0]).indexOf('vendedor')===0){h=i;break;} }
  if(h<2) throw new Error('No encontré la fila de encabezados (VendedorNombre). Revisa que el CSV sea la hoja "Comercial".');
  var head=_split(lines[h]).map(_norm), mon=_split(lines[h-1]), yr=_split(lines[h-2]);
  function ix(p){ for(var j=0;j<head.length;j++) if(head[j].indexOf(p)===0) return j; return -1; }
  var C={vend:ix('vendedor'),dp:ix('dia preventa'),de:ix('dia entrega'),canal:ix('canal'),sub:ix('subcanal'),cli:ix('clientenombre'),com:ix('clientecomuna'),cat:ix('categoria'),prod:ix('prodvta'),at:ix('atencion')};
  for(var k in C) if(C[k]<0) throw new Error('Falta la columna "'+k+'" en el CSV.');
  var labCols=[C.vend,C.dp,C.de,C.canal,C.sub,C.cli,C.com,C.cat,C.prod,C.at], labKeys=['vend','dp','de','canal','sub','cli','com','cat','prod','at'];
  var groups=[], year=null, m=null, cur=null;
  for(var c=C.at+1;c<head.length;c++){
    var y=String(yr[c]||'').trim();
    if(/^\d{4}$/.test(y)){year=+y;m=null;} else if(y){year=null;}
    var mi=MES_NOMBRES.indexOf(_norm(mon[c])); if(mi>=0) m=mi;
    if(year==null||m==null) continue;
    var key=year+'-'+(m<9?'0':'')+(m+1);
    if(!cur||cur.ym!==key){ cur={ym:key}; groups.push(cur); }
    if(head[c].indexOf('venta')===0) cur.v=c; else if(head[c].indexOf('qty')===0) cur.q=c; else if(head[c].indexOf('suma de margen')===0) cur.mg=c;
  }
  groups=groups.filter(function(g){return g.v!=null;});
  if(!groups.length) throw new Error('No encontré columnas mensuales de venta en el CSV.');
  var recs=[], f={};
  for(var i2=h+1;i2<lines.length;i2++){
    var line=lines[i2]; if(!line||/^[;\s]*$/.test(line)) continue;
    var r=_split(line), isTot=false;
    for(var a=0;a<labCols.length;a++){ var s=(r[labCols[a]]||'').trim(); if(/total/i.test(s)){isTot=true;break;} }
    if(isTot) continue;
    for(var b=0;b<labCols.length;b++){ var val=(r[labCols[b]]||'').trim(); if(val) f[labKeys[b]]=val; }
    if(!f.vend||!f.at) continue;
    for(var g=0;g<groups.length;g++){
      var G=groups[g], v=_num(r[G.v]); if(v==null||v===0) continue;
      var q=G.q!=null?(_num(r[G.q])||0):0;
      var mg=G.mg!=null?(_num(r[G.mg])||0):0;
      recs.push({vend:f.vend,dp:f.dp,de:f.de,canal:f.canal,sub:f.sub,cli:f.cli,com:f.com,cat:f.cat,prod:f.prod,at:f.at,ym:G.ym,v:v,q:q,mg:mg});
    }
  }
  return recs;
}
function buildSolerData(recs, info){
  var CFG=SOLER_CFG, blank=function(s){ return !s || /^\(en blanco\)$/i.test(s); };
  var monthsSet={}, vendSet={};
  var GC=['Supermercados','Cobertura','Locales Propios'];
  function gcOf(canal){ return canal==='GGCC'?'Supermercados':canal==='LOCALES PROPIOS'?'Locales Propios':'Cobertura'; }
  function vendOf(raw){ return CFG.vendedores[raw] || raw.toLowerCase().replace(/(^|\s)\S/g,function(c){return c.toUpperCase();}); }
  var DIMS=['categoria','canal','subcanal','producto','comuna','diaPreventa','diaEntrega'];
  var cube={};
  function cell(v,gc){ var a=cube[v]||(cube[v]={}); return a[gc]||(a[gc]={mensual:{},categoria:{},canal:{},subcanal:{},producto:{},comuna:{},diaPreventa:{},diaEntrega:{}}); }
  function acc(map,key,ym,r){ var e=map[key]||(map[key]={}); var c=e[ym]||(e[ym]={venta:0,kilos:0,margen:0,_c:new Set(),_t:new Set()}); c.venta+=r.v; c.kilos+=r.kg; c.margen+=r.mg; c._c.add(r.cli); c._t.add(r.at); return e; }
  function cliAcc(store,storeM,r,V){
    var c=store[r.cli]||(store[r.cli]={venta:0,kilos:0,_t:new Set(),_v:{},_row:{},first:r.ym,last:r.ym});
    c.venta+=r.v; c.kilos+=r.kg; c._t.add(r.at); c._v[V]=(c._v[V]||0)+r.v;
    if(r.v>0){ if(!c.pf||r.ym<c.first) c.first=r.ym; if(!c.pf||r.ym>c.last) c.last=r.ym; c.pf=true; var cp=c._pos||(c._pos={}); cp[r.ym]=(cp[r.ym]||0)+r.v; }
    var cm=storeM[r.cli]||(storeM[r.cli]={}); var cmm=cm[r.ym]||(cm[r.ym]={venta:0,kilos:0}); cmm.venta+=r.v; cmm.kilos+=r.kg;
    return c;
  }
  var cli={}, cliM={}, cliC={}, cliMC={};
  for(var i=0;i<recs.length;i++){
    var r=recs[i];
    r.kg=r.q*(CFG.kgPorUnidad[r.prod]||1); r.mg=r.mg||0;
    var canal=blank(r.canal)?'SIN CANAL':r.canal, sub=blank(r.sub)?'SIN CATEGORIA':r.sub;
    var V=vendOf(r.vend), G=gcOf(canal);
    monthsSet[r.ym]=1; vendSet[V]=(vendSet[V]||0)+r.v;
    var targets=[cell('TODOS','TODOS'),cell('TODOS',G),cell(V,'TODOS'),cell(V,G)];
    for(var t=0;t<4;t++){
      var x=targets[t];
      var mm=x.mensual[r.ym]||(x.mensual[r.ym]={venta:0,kilos:0,margen:0,_c:new Set(),_t:new Set()}); mm.venta+=r.v; mm.kilos+=r.kg; mm.margen+=r.mg; mm._c.add(r.cli); mm._t.add(r.at);
      if(!blank(r.cat)) acc(x.categoria,r.cat,r.ym,r);
      acc(x.canal,canal,r.ym,r);
      var sc=acc(x.subcanal,sub,r.ym,r); if(!sc._canal||(sc._canal==='SIN CANAL'&&canal!=='SIN CANAL')) sc._canal=canal;
      if(!blank(r.prod)) acc(x.producto,r.prod,r.ym,r)._categoria=blank(r.cat)?'':r.cat;
      if(!blank(r.com)) acc(x.comuna,r.com,r.ym,r);
      if(!blank(r.dp)) acc(x.diaPreventa,r.dp,r.ym,r);
      if(!blank(r.de)) acc(x.diaEntrega,r.de,r.ym,r);
    }
    var c=cliAcc(cli,cliM,r,V);
    var rk=canal+SEP+sub+SEP+(r.com||''); c._row[rk]=(c._row[rk]||0)+r.v;
    if(G==='Cobertura' && V!=='Venta Oficina') cliAcc(cliC,cliMC,r,V);
  }
  function fin(o){ o.clientes=o._c.size; o.tickets=o._t.size; delete o._c; delete o._t; }
  for(var v in cube) for(var g in cube[v]){ var x2=cube[v][g];
    for(var ym in x2.mensual) fin(x2.mensual[ym]);
    DIMS.forEach(function(d){ for(var k in x2[d]) for(var mk in x2[d][k]) if(mk.charAt(0)!=='_') fin(x2[d][k][mk]); });
  }
  var months=Object.keys(monthsSet).sort();
  var monthLabels={}; months.forEach(function(m){ monthLabels[m]=MES_CORTO[+m.slice(5)-1]+' '+m.slice(0,4); });
  var vendedores=CFG.ordenVendedores.filter(function(v){return vendSet[v]!=null;})
    .concat(Object.keys(vendSet).filter(function(v){return CFG.ordenVendedores.indexOf(v)<0;}).sort(function(a,b){return vendSet[b]-vendSet[a];}));
  vendedores.forEach(function(v){ GC.concat(['TODOS']).forEach(function(g){ cell(v,g); }); });
  GC.forEach(function(g){ cell('TODOS',g); });
  var cadenas=Object.keys(cube.TODOS.Supermercados.subcanal).sort();
  var ref=months[months.length-1];
  function realOf(v,mk){ var m=(cube[v]&&cube[v].TODOS.mensual[mk])||{venta:0,kilos:0,clientes:0}; return m; }
  var cumpV={}; Object.keys(CFG.metas).forEach(function(v){ var o={};
    Object.keys(CFG.metas[v]).forEach(function(mk){ if(!monthsSet[mk]) return; var me=CFG.metas[v][mk], re=realOf(v,mk);
      o[mk]={ventaReal:re.venta,ventaMeta:me[0],kilosReal:re.kilos,kilosMeta:me[1],clientesReal:re.clientes,clientesMeta:me[2]}; });
    cumpV[v]=o; });
  var cumpT={}; Object.keys(CFG.metasTotal).forEach(function(mk){ if(!monthsSet[mk]) return; var me=CFG.metasTotal[mk], re=realOf('TODOS',mk);
    cumpT[mk]={ventaReal:re.venta,ventaMeta:me[0],kilosReal:re.kilos,kilosMeta:me[1],clientesReal:re.clientes,clientesMeta:me[2]}; });
  function mdiff(a,b){ return (+b.slice(0,4)-+a.slice(0,4))*12+(+b.slice(5)-+a.slice(5)); }
  function argmax(o){ var best=null,bv=-Infinity; for(var k in o) if(o[k]>bv){bv=o[k];best=k;} return best; }
  function estadoOf(ms){ return ms<=2?'Activo':ms<=5?'Fugado':'Perdido'; }
  var porCliente={};
  Object.keys(cli).sort().forEach(function(name){
    var c=cli[name], row=argmax(c._row).split(SEP), ms=mdiff(c.last,ref), gc=gcOf(row[0]);
    porCliente[name]={venta:c.venta,kilos:c.kilos,tickets:c._t.size,vendedor:argmax(c._v),canal:row[0],subcanal:row[1],comuna:row[2],
      precioProm:c.kilos?Math.round(c.venta/c.kilos*10)/10:0,primerMes:c.first,ultimoMes:c.last,mesesSinComprar:ms,estado:estadoOf(ms),grandCanal:gc};
  });
  // Clientes nuevos/fugados/perdidos/concretados: solo canal Cobertura y sin "Venta Oficina"
  var porClienteCobertura={}, churn={referenceMonth:ref,activos:0,fugados:[],perdidos:[],nuevosPorMes:{},perdidosPorMes:{}};
  months.forEach(function(m){ churn.nuevosPorMes[m]=[]; churn.perdidosPorMes[m]=[]; });
  Object.keys(cliC).sort().forEach(function(name){
    var c=cliC[name], ms=mdiff(c.last,ref), estado=estadoOf(ms), vend=argmax(c._v);
    porClienteCobertura[name]={venta:c.venta,kilos:c.kilos,tickets:c._t.size,vendedor:vend,grandCanal:'Cobertura',ultimoMes:c.last,mesesSinComprar:ms,estado:estado};
    if(estado==='Activo') churn.activos++;
    else (estado==='Fugado'?churn.fugados:churn.perdidos).push({cliente:name,vendedor:vend,grandCanal:'Cobertura',ultimoMes:c.last,ventaHistorica:c.venta,mesesSinComprar:ms});
    if(!c.pf) return;
    if(churn.nuevosPorMes[c.first]) churn.nuevosPorMes[c.first].push({cliente:name,vendedor:vend,grandCanal:'Cobertura',venta:(c._pos&&c._pos[c.first])||0});
    months.forEach(function(m){ if(mdiff(c.last,m)===6) churn.perdidosPorMes[m].push({cliente:name,vendedor:vend,grandCanal:'Cobertura',ultimoMes:c.last,ventaHistorica:c.venta,mesesSinComprar:6}); });
  });
  var byHist=function(a,b){return b.ventaHistorica-a.ventaHistorica;};
  churn.fugados.sort(byHist); churn.perdidos.sort(byHist);
  for(var nm in churn.nuevosPorMes) churn.nuevosPorMes[nm].sort(function(a,b){return b.venta-a.venta;});
  for(var pm in churn.perdidosPorMes) churn.perdidosPorMes[pm].sort(byHist);
  return { meta:{generatedAt:(info&&info.at)||new Date().toISOString(), empresa:'Cecinas Soler', fuente:(info&&info.fuente)||'Inet_Comercial_JSEHok.csv'},
    months:months, monthLabels:monthLabels, vendedores:vendedores, grandesCanales:GC, cadenasGGCC:cadenas, cube:cube,
    cumplimientoPorVendedor:cumpV, cumplimientoTotal:cumpT, porCliente:porCliente, porClienteMensual:cliM,
    porClienteCobertura:porClienteCobertura, porClienteMensualCobertura:cliMC, churn:churn };
}
const [cfgPath, dirPag, publicoHtml, outDir, genPrev, nPrev, shaPrev] = process.argv.slice(2);
const fail = m => { console.log('ERROR: ' + m); process.exit(1); };
if (!outDir) fail('faltan argumentos');
const pages = {};
for (const f of fs.readdirSync(dirPag)) {
  const t = fs.readFileSync(path.join(dirPag, f), 'utf8');
  const m = t.match(/\n*\[page (\d+)[^\]]*\]\s*$/);
  if (m) pages[+m[1]] = { body: t.slice(0, m.index), last: /last page/i.test(m[0]), of: +((m[0].match(/of (\d+) —/) || [])[1] || 0) };
  else { const n = f.match(/^p(\d+)\.txt$/i); if (n) pages[+n[1]] = { body: t, last: true, of: 0 }; }
}
const nums = Object.keys(pages).map(Number).sort((a, b) => a - b);
if (!nums.length) fail('no hay paginas en ' + dirPag);
nums.forEach((n, i) => { if (n !== i + 1) fail('falta la pagina ' + (i + 1)); });
let head = null; const b64 = [];
for (const n of nums) for (let l of pages[n].body.split(/\r?\n/)) {
  if (l.charCodeAt(0) === 0xFEFF) l = l.slice(1);
  if (l.startsWith('SOLERGZ1;')) { head = head || l; continue; }
  b64.push(l.replace(/[^A-Za-z0-9+/=]/g, ''));
}
if (!head) fail('el archivo no tiene la cabecera SOLERGZ1');
let csvBuf;
try { csvBuf = zlib.gunzipSync(Buffer.from(b64.join(''), 'base64')); }
catch (e) { fail('no se pudo descomprimir (faltan paginas o hay una pagina mal copiada): ' + e.message); }
const want = +((head.match(/bytes=(\d+)/) || [])[1] || 0);
if (want && csvBuf.length !== want) fail(`tamano distinto: ${csvBuf.length} vs ${want}`);
const generado = (head.match(/generado=([^;\s]+)/) || [])[1] || '';
const sha = crypto.createHash('sha256').update(csvBuf).digest('hex').slice(0, 16);
if (shaPrev && shaPrev === sha) { console.log(JSON.stringify({ estado: 'SIN_CAMBIOS', sha, generado })); process.exit(0); }
const recs = parseInetCSV(csvBuf.toString('utf8'));
if (recs.length < 1000) fail('muy pocas filas de venta: ' + recs.length);
const at = new Date().toISOString();
const fmt = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }); };
const fuente = 'Inet_Comercial_JSEHok (OneDrive' + (generado ? ', generado ' + fmt(generado) : '') + ', actualización automática)';
const D = buildSolerData(recs, { at, fuente });
D.meta.generado = generado;
const CHUNK = 120000, s = JSON.stringify(D), gen = 'g' + Date.now().toString(36), n = Math.ceil(s.length / CHUNK);
fs.mkdirSync(path.join(outDir, 'chunks'), { recursive: true });
const writes = [];
for (let i = 0; i < n; i++) {
  const fp = path.resolve(outDir, 'chunks', `${gen}_${i}.json`);
  fs.writeFileSync(fp, JSON.stringify({ gen, i, s: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  writes.push({ op: 'set', collection: 'datos', doc_id: `${gen}_${i}`, file_path: fp });
}
const lotes = []; for (let i = 0; i < writes.length; i += 6) lotes.push(writes.slice(i, i + 6));
lotes.forEach((l, i) => fs.writeFileSync(path.join(outDir, `lote_${i + 1}.json`), JSON.stringify(l)));
const meta = { gen, n, loadedAt: at, source: fuente, generado, csvSha: sha };
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));
const borrar = (genPrev && genPrev !== gen && +nPrev > 0 && +nPrev <= 300) ? Array.from({ length: +nPrev }, (_, i) => ({ op: 'delete', collection: 'datos', doc_id: `${genPrev}_${i}`, if_version: 1 })) : [];
const borrarLotes = []; for (let i = 0; i < borrar.length; i += 50) borrarLotes.push(borrar.slice(i, i + 50));
borrarLotes.forEach((l, i) => fs.writeFileSync(path.join(outDir, `borrar_${i + 1}.json`), JSON.stringify(l)));
function llenar(p, Dx, sx) {
  const a = p.indexOf('window.__DATA__ = {'); const b = p.indexOf('</script>', a);
  if (a < 0 || b < 0) fail('no encontre window.__DATA__ en la version publica');
  p = p.slice(0, a) + 'window.__DATA__ = ' + sx.replace(/<\/script/gi, '<\\/script') + ';\n' + p.slice(b);
  p = p.replace(/(<span id="footNote">Fuente: Inet_Comercial_JSEHok \(datos al )[^)]*\)/, `$1${fmt(generado || at)})`);
  const M = Dx.months, L = Dx.monthLabels;
  p = p.replace(/(<div class="sub">Cecinas Soler · )[^<]*(<\/div>)/, `$1${L[M[0]]} – ${L[M[M.length - 1]]}$2`);
  const y = M[M.length - 1].slice(0, 4), my = M.filter(m => m.slice(0, 4) === y);
  p = p.replace(/(<button type="button" data-quick="2026">)[^<]*(<\/button>)/, `$1${y} (${L[my[0]].split(' ')[0]}–${L[my[my.length - 1]].split(' ')[0]})$2`);
  p = p.replace(/(<span class="card-note" id="mensualNote">)[^<]*(<\/span>)/, `$1${L[M[0]]} – ${L[M[M.length - 1]]} · no aplica el filtro de período (muestra todo el histórico)$2`);
  return p;
}
const escH = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let pubOut = null; const panelesV = [];
// Paneles de vendedores y de grupo: SIN margen. Se borra el dato (no viaja en la pagina) y se quitan
// la tarjeta "Margen" y la tabla "Rentabilidad por categoria". El panel completo (gerencia) lo conserva.
const sinMargenDatos = o => { if (Array.isArray(o)) o.forEach(sinMargenDatos); else if (o && typeof o === 'object') { delete o.margen; delete o.margenPct; for (const k in o) sinMargenDatos(o[k]); } return o; };
function sinMargenHtml(p) {
  const cambios = [
    [/\n[ \t]*<section class="card" id="sec-rentabilidad">[\s\S]*?<\/section>/, ''],
    [/\n[ \t]*\{label:'Margen',[^\n]*\},/, ''],
    [/\n[ \t]*safe\('rentabilidad', renderRentabilidad\);/, ''],
  ];
  for (const [re, r] of cambios) { if (!re.test(p)) fail('no pude quitar el margen de la plantilla: ' + re); p = p.replace(re, r); }
  return p.replace('</style>', '  @media (min-width:1181px){ .kpi-row{ grid-template-columns:repeat(5,1fr); } }\n</style>');
}
if (publicoHtml && fs.existsSync(publicoHtml)) {
  const tpl = fs.readFileSync(publicoHtml, 'utf8');
  pubOut = path.resolve(outDir, 'publico.html'); fs.writeFileSync(pubOut, llenar(tpl, D, s));
  // Paneles por vendedor: cada uno se construye SOLO con las filas de ese vendedor (no lleva datos de otros)
  const cfg0 = { metas: SOLER_CFG.metas, metasTotal: SOLER_CFG.metasTotal, ordenVendedores: SOLER_CFG.ordenVendedores };
  const vOf = raw => SOLER_CFG.vendedores[raw] || raw.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  fs.mkdirSync(path.join(outDir, 'vendedores'), { recursive: true });
  for (const V of D.vendedores) {
    if (V === 'Venta Oficina') continue;
    const rv = recs.filter(r => vOf(r.vend) === V);
    if (!rv.length) continue;
    const mv = cfg0.metas[V] || {};
    SOLER_CFG.metas = { [V]: mv }; SOLER_CFG.metasTotal = mv; SOLER_CFG.ordenVendedores = [V];
    const Dv = buildSolerData(rv, { at, fuente });
    SOLER_CFG.metas = cfg0.metas; SOLER_CFG.metasTotal = cfg0.metasTotal; SOLER_CFG.ordenVendedores = cfg0.ordenVendedores;
    Dv.meta.generado = generado; Dv.meta.vendedor = V;
    if (Object.keys(Dv.cube).some(k => k !== 'TODOS' && k !== V)) fail('panel de ' + V + ' trae datos de otro vendedor');
    sinMargenDatos(Dv);
    let pv = sinMargenHtml(llenar(tpl, Dv, JSON.stringify(Dv)));
    pv = pv.replace(/<title>[^<]*<\/title>/, `<title>Panel Comercial — ${escH(V)}</title>`);
    pv = pv.replace('<h1>Panel Comercial</h1>', `<h1>Panel Comercial · ${escH(V)}</h1>`);
    pv = pv.replace('</style>', '  .filters-item, .filters label:has(#bodegaSelect){ display:none !important; }\n</style>');
    const fv = path.resolve(outDir, 'vendedores', slug(V) + '.html'); fs.writeFileSync(fv, pv);
    const tv = Object.values(Dv.cube.TODOS.TODOS.mensual).reduce((x, m) => x + m.venta, 0);
    panelesV.push({ vendedor: V, archivo: fv, venta: Math.round(tv), bytes: pv.length });
  }
  // Paneles de grupo (ej. Santiago): toda la informacion, pero SOLO de los vendedores del grupo.
  // Grupos desde la config (gruposPaneles) o, si no viene, desde grupos.json en la carpeta actual.
  let grupos = SOLER_CFG.gruposPaneles;
  if (!grupos && fs.existsSync('grupos.json')) { const gj = JSON.parse(fs.readFileSync('grupos.json', 'utf8')); grupos = gj.gruposPaneles || gj; }
  for (const Gp of (Array.isArray(grupos) ? grupos : [])) {
    if (!Gp || !Gp.archivo || !/^[a-z0-9-]+\.html$/.test(Gp.archivo) || !Array.isArray(Gp.vendedores) || !Gp.vendedores.length) fail('grupo de paneles mal definido: ' + JSON.stringify(Gp));
    // un vendedor es del grupo si todas las palabras de algun miembro estan en su nombre (sin tildes ni mayusculas)
    const miembros = Gp.vendedores.map(m => slug(m).split('-').filter(Boolean));
    const coincide = t => { const w = new Set(slug(t).split('-')); return miembros.some(m => m.every(x => w.has(x))); };
    const esDelGrupo = raw => vOf(raw) !== 'Venta Oficina' && (coincide(vOf(raw)) || coincide(raw));
    const rg = recs.filter(r => esDelGrupo(r.vend));
    if (!rg.length) continue;
    const Vs = [...new Set(rg.map(r => vOf(r.vend)))];
    const mg = {}, mt = {};
    for (const V of Vs) if (cfg0.metas[V]) { mg[V] = cfg0.metas[V]; for (const mk in cfg0.metas[V]) { const a = mt[mk] || (mt[mk] = [0, 0, 0]); cfg0.metas[V][mk].forEach((x, k) => a[k] += +x || 0); } }
    SOLER_CFG.metas = mg; SOLER_CFG.metasTotal = mt; SOLER_CFG.ordenVendedores = (cfg0.ordenVendedores || []).filter(v => Vs.includes(v));
    const Dg = buildSolerData(rg, { at, fuente });
    SOLER_CFG.metas = cfg0.metas; SOLER_CFG.metasTotal = cfg0.metasTotal; SOLER_CFG.ordenVendedores = cfg0.ordenVendedores;
    const titulo = Gp.titulo || Gp.archivo.replace(/\.html$/, '');
    Dg.meta.generado = generado; Dg.meta.grupo = titulo; // sin meta.vendedor: el panel de grupo conserva el selector de vendedores
    if (Object.keys(Dg.cube).some(k => k !== 'TODOS' && !Vs.includes(k))) fail('panel de grupo ' + titulo + ' trae datos de otro vendedor');
    sinMargenDatos(Dg);
    let pg = sinMargenHtml(llenar(tpl, Dg, JSON.stringify(Dg)));
    pg = pg.replace(/<title>[^<]*<\/title>/, `<title>Panel Comercial ${escH(titulo)}</title>`);
    pg = pg.replace('<h1>Panel Comercial</h1>', `<h1>Panel Comercial ${escH(titulo)}</h1>`);
    pg = pg.split('Total Compañía').join('Total ' + escH(titulo));
    pg = pg.replace('</style>', '  .filters label:has(#bodegaSelect){ display:none !important; }\n</style>');
    const fg = path.resolve(outDir, 'vendedores', Gp.archivo); fs.writeFileSync(fg, pg);
    const tg = Object.values(Dg.cube.TODOS.TODOS.mensual).reduce((x, m) => x + m.venta, 0);
    panelesV.push({ vendedor: 'Grupo ' + titulo, integrantes: Vs, archivo: fg, venta: Math.round(tg), bytes: pg.length });
  }
  fs.writeFileSync(path.join(outDir, 'vendedores.json'), JSON.stringify(panelesV, null, 1));
}
const tot = Object.values(D.cube.TODOS.TODOS.mensual).reduce((a, m) => (a.venta += m.venta, a.kilos += m.kilos, a.margen += m.margen, a), { venta: 0, kilos: 0, margen: 0 });
console.log(JSON.stringify({ estado: 'OK', gen, n, lotes: lotes.length, borrarLotes: borrarLotes.length, filas: recs.length, meses: D.months[0] + '..' + D.months[D.months.length - 1],
  ventaTotal: Math.round(tot.venta), kilos: Math.round(tot.kilos), margen: Math.round(tot.margen), vendedores: D.vendedores.length, generado, sha, meta: path.resolve(outDir, 'meta.json'), publico: pubOut, panelesVendedor: panelesV.length }, null, 1));
