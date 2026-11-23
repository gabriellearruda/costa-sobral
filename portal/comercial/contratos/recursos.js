/* =====================================================================
   GERADOR DE CONTRATOS · recursos extras
   - Modelos de contrato (padrão C&S, Flex e os salvos pelo usuário)
   - Importar contrato ou proposta (PDF ou Word) e preencher o gerador
   - Painel de pendências
   - Documento-base anexado
   - Escopo do contrato editável, com o "De → Para" em relação à proposta
   Este arquivo é carregado antes do script principal (index.html).
   ===================================================================== */

/* ---------- modelos ---------- */
function modelosTodos(){
  const padrao=Object.assign({id:'padrao',nome:'Modelo padrão C&S',numeracao:'auto',qualificacao:'quadro',preambulo:[]},PAR.modelo);
  const base=(window.MODELOS_BASE||[]);
  const salvos=(PAR.modelosSalvos||[]);
  const ids=new Set();return [padrao].concat(salvos,base).filter(m=>{if(ids.has(m.id))return false;ids.add(m.id);return true;});
}
function modeloPorId(id){return modelosTodos().find(m=>m.id===id)||modelosTodos()[0];}
function aplicarModelo(id,sil){
  const m=modeloPorId(id);
  if(!sil&&!confirm('Trocar as cláusulas deste contrato pelas do "'+m.nome+'"? O que você editou nas cláusulas será substituído.'))return editor();
  C.modeloId=m.id;C.titulo=m.titulo||C.titulo;C.numeracao=m.numeracao||'auto';C.qualificacao=m.qualificacao||'quadro';
  C.preambulo=(m.preambulo||[]).slice();C.fecho=m.fecho||C.fecho;
  if(m.multaCom)C.multaCom=m.multaCom;if(m.multaSem)C.multaSem=m.multaSem;
  C.clausulas=(m.clausulas||[]).map(c=>({t:c.t,p:(c.p||[]).slice(),on:true,h:c.h?1:0}));
  render();sujo();editor();if(!sil)toast('Modelo aplicado: '+m.nome+'.');
}
async function gravarPar(){
  const v={modelo:PAR.modelo,empresas:PAR.empresas,locais:PAR.locais,ultimoAno:PAR._ano,ultimoNumero:PAR._num,modelos:PAR.modelosSalvos||[]};
  const r=await sb.from('com_parametros').upsert({chave:'contratos',valor:v});if(r.error){toast('Erro ao salvar: '+r.error.message,1);return false}return true;
}
async function salvarComoModelo(){
  const nome=prompt('Nome do modelo (ex.: Modelo Vida, Modelo portaria 12x36):',C.contratante.nome?('Modelo '+C.contratante.nome):'');
  if(!nome)return;
  const m={id:'m'+Date.now().toString(36),nome:nome.trim(),titulo:C.titulo,numeracao:C.numeracao||'auto',qualificacao:C.qualificacao||'quadro',
    preambulo:(C.preambulo||[]).slice(),fecho:C.fecho,multaCom:C.multaCom,multaSem:C.multaSem,
    clausulas:C.clausulas.filter(c=>c.on).map(c=>({t:c.t,p:c.p.slice(),h:c.h?1:0}))};
  PAR.modelosSalvos=(PAR.modelosSalvos||[]).concat([m]);
  if(await gravarPar()){C.modeloId=m.id;editor();toast('Modelo "'+m.nome+'" salvo. Ele aparece na lista de modelos.');}
}
async function excluirModelo(id){
  const m=(PAR.modelosSalvos||[]).find(x=>x.id===id);if(!m)return;
  if(!confirm('Excluir o modelo "'+m.nome+'"? Os contratos já salvos não mudam.'))return;
  PAR.modelosSalvos=PAR.modelosSalvos.filter(x=>x.id!==id);if(await gravarPar()){editor();toast('Modelo excluído.');}
}
function uiModelo(){
  const ms=modelosTodos(),salvo=(PAR.modelosSalvos||[]).some(x=>x.id===C.modeloId);
  let h='<div class="grp"><h2>Modelo e documentos</h2>';
  h+='<div class="fld"><label>Modelo do contrato</label><div style="display:flex;gap:6px"><select id="selModelo" style="flex:1">'+
    ms.map(m=>'<option value="'+esc(m.id)+'"'+(C.modeloId===m.id?' selected':'')+'>'+esc(m.nome)+'</option>').join('')+'</select>'+
    '<button class="btn btn-mini" onclick="aplicarModelo(document.getElementById(\'selModelo\').value)">Aplicar</button></div>'+
    '<div class="hint">Aplicar troca as cláusulas deste contrato pelas do modelo. Os dados do cliente, o escopo e os valores continuam.</div></div>';
  h+='<div class="minis" style="margin-bottom:10px"><button onclick="salvarComoModelo()">Salvar cláusulas como modelo</button>'+(salvo?'<button onclick="excluirModelo(\''+esc(C.modeloId)+'\')">Excluir este modelo</button>':'')+'</div>';
  h+='<div class="fld"><label>Importar contrato ou proposta</label><label class="addbtn" style="display:block;text-align:center">Escolher arquivo PDF ou Word<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onchange="importarArquivo(this.files[0]);this.value=\'\'"></label>'+
    '<div class="hint">Lê o arquivo e preenche cliente, escopo, valores, condições e, se você quiser, as cláusulas. O que faltar aparece nas pendências.</div></div>';
  h+='<div class="fld"><label>Documento-base</label>'+(C.base?
    '<div class="numbox" style="display:flex;gap:8px;align-items:center;font-weight:600"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(C.base.nome)+'</span><button class="btn btn-mini" onclick="abrirBase()">Abrir</button><button class="btn btn-mini" style="background:#f3ece0;color:#9a7b3a" onclick="if(confirm(\'Tirar o documento-base deste contrato?\')){C.base=null;sujo();editor()}">Tirar</button></div>':
    '<label class="addbtn" style="display:block;text-align:center">Anexar contrato ou proposta de referência<input type="file" accept=".pdf,.docx" hidden onchange="anexarBase(this.files[0]);this.value=\'\'"></label>')+
    '<div class="hint">Fica guardado junto deste contrato, para consulta. Não entra no PDF.</div></div></div>';
  return h;
}

/* ---------- documento-base ---------- */
const MIME_DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function anexarBase(f,sil){
  if(!f)return;if(f.size>25*1024*1024)return toast('O arquivo passa de 25 MB.',1);
  const nome=f.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9._-]+/g,'_');
  const path='contratos/base/'+crypto.randomUUID()+'-'+nome;
  const tipo=/\.docx$/i.test(f.name)?MIME_DOCX:(f.type||'application/pdf');
  const r=await sb.storage.from('comercial').upload(path,await f.arrayBuffer(),{contentType:tipo});
  if(r.error){toast('Não foi possível anexar: '+r.error.message,1);return false}
  C.base={path,nome:f.name,tipo};sujo();editor();if(!sil)toast('Documento-base anexado. Salve o contrato para guardar.');return true;
}
async function abrirBase(){
  if(!C.base)return;const r=await sb.storage.from('comercial').createSignedUrl(C.base.path,600);
  if(r.error)return toast('Não foi possível abrir: '+r.error.message,1);window.open(r.data.signedUrl,'_blank');
}

/* ---------- escopo do contrato (editável) ---------- */
function escopoDif(){
  const o=C.propostaOrig;if(!o)return [];
  const a=(o.investimento||[]).filter(v=>v.servico),b=(C.proposta.investimento||[]).filter(v=>v.servico),out=[];
  const chave=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').replace(/\(.*?\)/g,'').trim();
  b.forEach(v=>{const x=a.find(y=>chave(y.servico)===chave(v.servico));
    if(!x){out.push('<b>Incluído:</b> '+esc(v.servico)+' · '+esc(v.escala||'')+' · '+(parseInt(v.qtd)||0)+' × '+brl(parseBRL(v.unit)));return}
    const ch=[];if((x.escala||'')!==(v.escala||''))ch.push(esc(x.escala||'—')+' → '+esc(v.escala||'—'));
    if((parseInt(x.qtd)||0)!==(parseInt(v.qtd)||0))ch.push('qtd. '+(parseInt(x.qtd)||0)+' → '+(parseInt(v.qtd)||0));
    if(Math.abs(parseBRL(x.unit)-parseBRL(v.unit))>.004)ch.push(brl(parseBRL(x.unit))+' → '+brl(parseBRL(v.unit)));
    if(ch.length)out.push('<b>'+esc(v.servico)+':</b> '+ch.join(' · '));});
  a.forEach(x=>{if(!b.some(v=>chave(v.servico)===chave(x.servico)))out.push('<b>Retirado:</b> '+esc(x.servico));});
  const ta=a.reduce((t,v)=>t+parseBRL(v.unit)*(parseInt(v.qtd)||0),0),tb=total();
  if(out.length&&Math.abs(ta-tb)>.004)out.push('<b>Valor mensal:</b> '+brl(ta)+' → '+brl(tb));
  return out;
}
function uiEscopo(){
  const inv=C.proposta.investimento=C.proposta.investimento||[],at=C.proposta.atribuicoes=C.proposta.atribuicoes||[];
  let h='<div class="grp"><h2>Escopo do contrato</h2><div class="hint" style="margin-bottom:8px">Começa igual ao da proposta. Se o escopo foi negociado, altere aqui: o contrato usa estes postos e valores.</div>';
  const dif=escopoDif();
  if(dif.length)h+='<div class="aviso" style="margin-bottom:10px"><b>Escopo diferente da proposta'+(C.proposta.numero?' Nº '+esc(C.proposta.numero):'')+':</b><br>'+dif.join('<br>')+'</div>';
  h+='<div class="hint" style="font-weight:600;color:#6b675e;margin-bottom:4px">Postos e valores</div>';
  inv.forEach((v,i)=>{h+='<div class="cl" style="padding:8px 10px 2px"><div class="fld"><label>Posto / serviço</label><input value="'+esc(v.servico)+'" oninput="setp(\'proposta.investimento.'+i+'.servico\',this.value)"></div>'+
    '<div class="row3"><div class="fld"><label>Escala</label><input value="'+esc(v.escala||'')+'" placeholder="5x2" oninput="setp(\'proposta.investimento.'+i+'.escala\',this.value)"></div>'+
    '<div class="fld"><label>Qtd.</label><input type="number" min="0" value="'+esc(v.qtd)+'" oninput="setp(\'proposta.investimento.'+i+'.qtd\',this.value)"></div>'+
    '<div class="fld"><label>Valor unitário</label><input value="'+esc(v.unit)+'" oninput="setp(\'proposta.investimento.'+i+'.unit\',this.value)"></div></div>'+
    '<div class="minis" style="margin:-2px 0 8px"><button onclick="C.proposta.investimento.splice('+i+',1);render();sujo();editor()">tirar posto</button></div></div>';});
  h+='<button class="addbtn" onclick="C.proposta.investimento.push({servico:\'\',escala:\'\',qtd:\'1\',unit:\'\'});render();sujo();editor()">+ Adicionar posto</button>';
  h+='<div class="hint" style="font-weight:600;color:#6b675e;margin:12px 0 4px">Atividades por posto <i style="font-weight:400">(entram onde o texto tem [[ESCOPO]])</i></div>';
  at.forEach((a,i)=>{h+='<div class="cl" style="padding:8px 10px 2px"><div class="row2"><div class="fld"><label>Posto</label><input value="'+esc(a.titulo)+'" oninput="setp(\'proposta.atribuicoes.'+i+'.titulo\',this.value)"></div>'+
    '<div class="fld"><label>Complemento</label><input value="'+esc(a.subtitulo||'')+'" oninput="setp(\'proposta.atribuicoes.'+i+'.subtitulo\',this.value)"></div></div>'+
    '<div class="fld"><label>Atividades (uma por linha)</label><textarea oninput="setp(\'proposta.atribuicoes.'+i+'.itens\',this.value)">'+esc(a.itens||'')+'</textarea></div>'+
    '<div class="minis" style="margin:-2px 0 8px"><button onclick="C.proposta.atribuicoes.splice('+i+',1);render();sujo();editor()">tirar</button></div></div>';});
  h+='<button class="addbtn" onclick="C.proposta.atribuicoes.push({titulo:\'\',subtitulo:\'\',itens:\'\'});render();sujo();editor()">+ Adicionar atividades de um posto</button></div>';
  return h;
}

/* ---------- pendências ---------- */
function textoContrato(){return C.clausulas.filter(c=>c.on).map(c=>c.t+'\n'+c.p.join('\n')).join('\n')+'\n'+(C.preambulo||[]).join('\n');}
function pendencias(){
  const p=[],t=C.contratante,tx=textoContrato(),usa=k=>tx.indexOf(k)>=0;
  if(!t.nome.trim())p.push('Nome do contratante');
  if(!/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test((t.cnpj||'').trim()))p.push('CNPJ do contratante'+(t.cnpj?' (formato inválido)':''));
  if(!t.endereco.trim())p.push('Endereço do contratante');
  if(!t.cidade.trim())p.push('Cidade do contratante');
  if(!/^\d{5}-?\d{3}$/.test((t.cep||'').trim()))p.push('CEP do contratante');
  const inv=(C.proposta.investimento||[]).filter(v=>v.servico);
  if(!inv.length&&(usa('[[VALORES]]')||usa('{VALOR_MENSAL}')))p.push('Escopo: nenhum posto com valor');
  inv.forEach(v=>{if(!(parseInt(v.qtd)>0))p.push('Quantidade do posto "'+v.servico+'"');if(!(parseBRL(v.unit)>0))p.push('Valor do posto "'+v.servico+'"');if(!v.escala)p.push('Escala do posto "'+v.servico+'"');});
  if(usa('[[ESCOPO]]')&&!(C.proposta.atribuicoes||[]).some(a=>a.titulo||a.itens))p.push('Atividades por posto (o texto usa [[ESCOPO]])');
  if(usa('{PROPOSTA}')&&!C.proposta.numero)p.push('Número da proposta');
  if(usa('{INICIO}')&&!C.inicio)p.push('Data de início dos serviços');
  if(usa('{VIGENCIA}')&&!(parseInt(C.vigencia)>0))p.push('Vigência (meses)');
  if(usa('{VENCIMENTO}')&&!(parseInt(C.vencimento)>0))p.push('Dia de vencimento');
  if(usa('{AVISO}')&&!(parseInt(C.aviso)>0))p.push('Aviso prévio (dias)');
  if(usa('{FORO}')&&!C.foro.trim())p.push('Foro (comarca)');
  const chaves=(tx.match(/\{[A-Z_]+\}|\[\[[A-Z]+\]\]/g)||[]).filter(k=>!(k in CHAVES)&&!['{MULTA_QTD}','{VALOR_MENSAL}','{VALOR_EXTENSO}','{VENCIMENTO}','{VIGENCIA}','{INICIO}','{AVISO}'].includes(k)&&!/^\{(PROPOSTA|MULTA|FORO|CONTRATANTE)\}$/.test(k));
  [...new Set(chaves)].forEach(k=>p.push('Chave desconhecida no texto: '+k));
  if(/_{5,}/.test(C.clausulas.filter(c=>c.on).map(c=>c.p.join(' ')).join(' ')))p.push('Há lacunas "_____" no texto das cláusulas');
  return p;
}
function uiPend(){
  const p=pendencias();
  return '<div id="pendBox" class="'+(p.length?'pend':'pend ok')+'">'+(p.length?'<b>Pendências ('+p.length+')</b><ul>'+p.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<b>Tudo preenchido.</b> O contrato pode ser exportado.')+'</div>';
}
function atualizaPend(){const b=document.getElementById('pendBox');if(b)b.outerHTML=uiPend();}

/* ---------- qualificação narrativa (como no contrato do Flex) ---------- */
function qualNarrativa(){
  const e=PAR.empresas[C.empresa]||PAR.empresas.cs,t=C.contratante;
  const end=[t.endereco&&(t.endereco+(t.numero?', nº '+t.numero:'')),t.bairro,t.cidade&&(t.cidade+(t.uf?' - '+t.uf:'')),t.cep&&('CEP '+t.cep)].filter(Boolean).join(', ');
  const art=t.tipo==='condomínio'?'o':'a',insc=t.tipo==='condomínio'?'inscrito':'inscrita',den=t.tipo==='condomínio'?'denominado':'denominada';
  return '<p>Pelo presente instrumento particular, de um lado, <b>'+esc(e.razao)+'</b>, sociedade empresária limitada, inscrita no CNPJ sob o nº <b>'+esc(e.cnpj)+'</b>'+(e.ie?', Inscrição Estadual nº '+esc(e.ie):'')+', com sede na '+esc(e.sede)+', '+esc(e.rep)+', doravante denominada simplesmente <b>CONTRATADA</b>;</p>'+
    '<p>E, de outro lado, '+art+' <b>'+esc((t.nome||'_______________').toUpperCase())+'</b>, '+insc+' no CNPJ sob o nº '+esc(t.cnpj||'_______________')+', localizado na '+esc(end||'_______________')+', '+esc(t.rep)+', doravante '+den+' simplesmente <b>CONTRATANTE</b>;</p>';
}

/* ---------- importar arquivo ---------- */
async function lerDocx(buf){
  const zip=await JSZip.loadAsync(buf),xml=await zip.file('word/document.xml').async('string');
  const doc=new DOMParser().parseFromString(xml,'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body=doc.getElementsByTagNameNS(W,'body')[0],out=[];
  const txt=el=>[...el.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('');
  [...body.children].forEach(el=>{
    if(el.localName==='tbl'){out.push({k:'tab',linhas:[...el.getElementsByTagNameNS(W,'tr')].map(tr=>[...tr.getElementsByTagNameNS(W,'tc')].map(tc=>[...tc.getElementsByTagNameNS(W,'p')].map(txt).join(' ').trim()))});return}
    if(el.localName!=='p')return;const t=txt(el).replace(/\s+/g,' ').trim();if(!t)return;
    const runs=[...el.getElementsByTagNameNS(W,'r')].filter(r=>r.getElementsByTagNameNS(W,'t').length);
    const negrito=runs.length&&runs.every(r=>{const b=r.getElementsByTagNameNS(W,'b')[0];return b&&b.getAttribute('w:val')!=='0'&&b.getAttribute('w:val')!=='false';});
    const ind=el.getElementsByTagNameNS(W,'ind')[0],esq=ind?parseInt(ind.getAttribute('w:left')||ind.getAttribute('w:start')||'0'):0;
    const lista=el.getElementsByTagNameNS(W,'numPr').length>0;
    out.push({k:negrito&&t.length<180?'h':(esq>=2000?'q':(lista?'li':'p')),t});});
  return out;
}
async function lerPdf(buf){
  const pdfjs=await import('/portal/_comum/vendor/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/portal/_comum/vendor/pdf.worker.min.mjs';
  const pdf=await pdfjs.getDocument({data:new Uint8Array(buf)}).promise,linhas=[];let temTexto=false;
  for(let n=1;n<=pdf.numPages;n++){const pg=await pdf.getPage(n),tc=await pg.getTextContent(),alt=pg.getViewport({scale:1}).height,mapa={};
    tc.items.forEach(it=>{if(!it.str.trim())return;temTexto=true;const y=Math.round(it.transform[5]);const k=Object.keys(mapa).find(z=>Math.abs(z-y)<=2)||y;(mapa[k]=mapa[k]||[]).push({x:it.transform[4],s:it.str,neg:/bold/i.test(it.fontName||'')});});
    Object.keys(mapa).map(Number).sort((a,b)=>b-a).forEach(y=>{if(y<alt*.06||y>alt*.95)return;const its=mapa[y].sort((a,b)=>a.x-b.x);
      const t=its.map(i=>i.s).join(' ').replace(/\s+/g,' ').trim();if(/^\d{1,3}$/.test(t))return;linhas.push({x:its[0].x,t});});}
  if(!temTexto)throw new Error('Este PDF não tem texto selecionável (parece digitalizado). Envie o arquivo Word ou um PDF gerado pelo Word.');
  const xs=linhas.map(l=>l.x).sort((a,b)=>a-b),base=xs[Math.floor(xs.length*.2)]||0,out=[];let cur=null;
  const caps=t=>{const w=t.replace(/^[\d.]+\s*/,'').split(/\s+/).filter(x=>x.length>3);return w.length?w.filter(x=>/^[A-ZÀ-Ú]/.test(x)).length/w.length:0;};
  const ehMaiusc=t=>t===t.toUpperCase()&&/[A-ZÀ-Ú]{4}/.test(t)&&t.split(/\s+/).length>=2&&t.length<120&&!/R\$|^EMENTA/.test(t)&&!/[;:,]\s*$/.test(t);
  const ehTit=(t,recuo)=>recuo<12&&(/^CL[ÁA]USULA\s+[A-ZÀ-Ú]+/.test(t)&&t.length<160||/^\d+(\.\d+)*\.\s+[A-ZÀ-Ú]/.test(t)&&t.length<130&&caps(t)>=.6||ehMaiusc(t)&&t.split(/\s+/).length>=3);
  let ultTit=false;
  linhas.forEach(l=>{const t=l.t,rc=l.x-base;
    if(ultTit&&t===t.toUpperCase()&&/[A-ZÀ-Ú]{3}/.test(t)&&t.length<100&&!/[;:,]\s*$|R\$|CONTRATO\s+N|^EMENTA/.test(t)&&!/^(CL[ÁA]USULA|\d)/.test(t)){out[out.length-1].t+=' '+t;return}
    if(ehTit(t,rc)){cur=null;out.push({k:'h',t});ultTit=true;return}
    ultTit=false;
    const recuo=l.x-base;
    if(!cur||recuo>25&&recuo<120||/[.;:]$/.test(cur.t)&&recuo>8){cur={k:recuo>=120?'q':'p',t};out.push(cur);return}
    cur.t=(/-$/.test(cur.t)&&/^[a-zà-ú]/.test(t))?cur.t.replace(/-$/,'')+t:cur.t+' '+t;});
  return out;
}
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function extrair(par){
  const R={contratante:{},condicoes:{},investimento:[],atribuicoes:[],clausulas:[],preambulo:[],fecho:'',avisos:[]};
  const so=par.filter(p=>p.k!=='tab'),texto=so.map(p=>p.t).join('\n');
  const m=(re,s)=>{const x=(s||texto).match(re);return x?x:null;};
  let x;
  if(x=m(/CONTRATO\s+N[º°o]\.?\s*(\d{1,4}\s*\/\s*\d{4})/i))R.numero=x[1].replace(/\s/g,'');
  const tit=so.find(p=>p.k==='h'&&/INSTRUMENTO|CONTRATO DE|PRESTA[ÇC][ÃA]O DE SERVI/i.test(p.t)&&!/CONTRATO\s+N[º°o]/i.test(p.t));if(tit)R.titulo=tit.t;
  R.empresa=/62\.729\.475/.test(texto)?'costa':'cs';
  const qp=so.find(p=>/de outro lado|^CONTRATANTE\s*:/i.test(p.t));
  if(qp){const s=qp.t;
    if(x=s.match(/(?:de outro lado,\s*(?:o|a)\s+|CONTRATANTE\s*:\s*)(.+?),\s*(?:inscrit|pessoa jur|condom[ií]nio edil|sociedade|associa)/i))R.contratante.nome=x[1].replace(/\s+/g,' ').trim();
    const cnpjs=s.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g);if(cnpjs)R.contratante.cnpj=cnpjs[0];
    if(x=s.match(/(?:localizad[oa]|situad[oa]|com sede|estabelecid[oa])\s+(?:n[ao]|à|em)\s+(.+?),?\s*CEP[:\s]*(\d{5}-?\d{3})/i)){
      R.contratante.cep=x[2];const partes=x[1].split(/,\s*/);R.contratante.endereco=partes[0];
      const rest=partes.slice(1);const ni=rest.findIndex(z=>/^(n[º°o]\.?\s*)?\d+/i.test(z));if(ni>=0){R.contratante.numero=rest[ni].replace(/^n[º°o]\.?\s*/i,'');rest.splice(ni,1);}
      const ult=rest.pop()||'';const cu=ult.split(/\s*[-\/]\s*/);R.contratante.cidade=(cu[0]||'').replace(/^(Munic[ií]pio de)\s*/i,'');if(cu[1]&&/^[A-Z]{2}$/.test(cu[1].trim()))R.contratante.uf=cu[1].trim();
      R.contratante.bairro=rest.join(', ').replace(/^(Bairro)\s*/i,'');}
    if(x=s.match(/(neste ato representad[oa].+?),\s*doravante/i))R.contratante.rep=x[1];
    R.contratante.tipo=/condom[ií]nio/i.test(R.contratante.nome||s)?'condomínio':'empresa';}
  if(x=m(/Proposta Comercial\s+n[º°o]\.?\s*(\d{4}-\d{2,3}(?:-R\d+)?)/i))R.proposta=x[1];
  if(x=m(/vig[êe]ncia\s+(?:determinada\s+)?de\s+(\d{1,3})/i)||m(/pelo prazo de\s+(\d{1,3})\s*(?:\([^)]*\)\s*)?meses/i))R.condicoes.vigencia=x[1];
  if(x=m(/previst[oa] para\s+(?:o dia\s+)?(\d{1,2})\s*(?:º)?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i)){const mi=MESES.indexOf(x[2].toLowerCase());if(mi>=0)R.condicoes.inicio=x[3]+'-'+String(mi+1).padStart(2,'0')+'-'+String(x[1]).padStart(2,'0');}
  else if(x=m(/a partir de\s+(\d{2})\/(\d{2})\/(\d{4})/i))R.condicoes.inicio=x[3]+'-'+x[2]+'-'+x[1];
  if(x=m(/vencimento\s+(?:at[ée]\s+)?(?:o\s+)?dia\s+(\d{1,2})/i))R.condicoes.vencimento=x[1];
  if(x=m(/anteced[êe]ncia m[ií]nima de\s+(\d{1,3})\s*(?:\([^)]*\)\s*)?dias/i))R.condicoes.aviso=x[1];
  if(x=m(/Foro da Comarca de\s+([A-ZÀ-Úa-zà-ú' ]+?)(?:,|\.|\s+Estado|\s+-|\s+SP)/))R.condicoes.foro=x[1].trim();
  R.condicoes.multa=/multa\s+(compensat|rescis)/i.test(texto)||/rescis[ãa]o antecipada.{0,200}(pagar|equivalente a)/i.test(texto);
  if(x=m(/remunera[çc][ãa]o mensal.{0,40}?R\$\s*([\d.]+,\d{2})/i))R.totalTexto=parseBRL(x[1]);
  /* tabelas (Word) */
  par.filter(p=>p.k==='tab').forEach(tb=>{const cab=(tb.linhas[0]||[]).join(' ').toLowerCase();
    if(/valor/.test(cab)&&tb.linhas.some(l=>l.join(' ').includes('R$')))tb.linhas.slice(1).forEach(l=>{if(/total/i.test(l[0])||!l.join(' ').includes('R$'))return;
      const vals=l.filter(c=>/R\$/.test(c)).map(parseBRL);const esc_=l.find((c,i)=>i>0&&/^\d+x\d+|12x36|segunda|diurn|noturn/i.test(c))||'';const q=l.find((c,i)=>i>0&&/^\d{1,3}$/.test(c.trim()))||'1';
      R.investimento.push({servico:l[0],escala:esc_.replace(/\s*\(.*$/,''),qtd:String(parseInt(q)),unit:vals.length?String(vals[0]).replace('.',','):''});});});
  /* linhas de tabela no PDF */
  if(!R.investimento.length)so.forEach(p=>{const re=/(.+?)\s+(\d+x\d+|12x36)\s+(\d{1,3})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/g;let y;
    while((y=re.exec(p.t))){const nome=y[1].replace(/^.*?(Servi[çc]o\s+Escala\s+Qtd\.?\s+Valor unit[áa]rio\s+Valor mensal\s*)/i,'').trim();if(/total/i.test(nome))continue;R.investimento.push({servico:nome,escala:y[2],qtd:String(parseInt(y[3])),unit:y[4]});}});
  R.investimento.forEach((v,i)=>{if(i&&/^[a-zà-ú]/.test(v.servico)){const z=v.servico.match(/^(.*?\))\s*(.*)$/);if(z){R.investimento[i-1].servico+=' '+z[1];v.servico=z[2];}}});
  /* cláusulas, preâmbulo, atividades por posto */
  let atual=null,dentroRomano=false,romano=null,qn=0,acabou=false;
  const tabPreco=par.findIndex(p=>p.k==='tab'&&/valor/i.test((p.linhas[0]||[]).join(' ')));
  par.forEach((p,i)=>{
    if(acabou)return;
    if(p.k==='tab'){if(atual&&i===tabPreco)atual.p.push('[[VALORES]]');return}
    const t=p.t;
    if(/por estarem (assim )?justas e contratadas/i.test(t)){R.fecho=t;acabou=true;return}
    if(!atual){
      if(p.k==='h'&&(/^CL[ÁA]USULA|^\d+(\.\d+)*\.\s/i.test(t))){atual={t,p:[],h:/^\d+\.\s/.test(t)&&!/^\d+\.\d/.test(t)?1:0};R.clausulas.push(atual);return}
      if(/^(Considerando|As partes|Pelo presente|E, de outro lado|CONTRATADA\s*:|CONTRATANTE\s*:)/i.test(t)){if(/^(Considerando|As partes)/i.test(t))R.preambulo.push(t);return}
      return;}
    if(p.k==='h'&&!/^[IVX]+\s*[–-]/.test(t)){dentroRomano=false;atual={t,p:[],h:/^\d+\.\s/.test(t)&&!/^\d+\.\d/.test(t)?1:0};R.clausulas.push(atual);qn=0;return}
    const rm=t.match(/^([IVX]+)\s*[–-]\s*(.+?):?$/);
    if(rm&&t.length<160){romano={titulo:rm[2].replace(/\s*\((.*)\)\s*$/,''),subtitulo:(rm[2].match(/\((.*)\)\s*$/)||[,''])[1]?'('+(rm[2].match(/\((.*)\)\s*$/)[1])+')':'',itens:''};R.atribuicoes.push(romano);
      if(!dentroRomano){atual.p.push('[[ESCOPO]]');dentroRomano=true;}return}
    if(dentroRomano&&(p.k==='li'||/^[a-z]\)\s/.test(t))){romano.itens+=(romano.itens?'\n':'')+t.replace(/^[a-z]\)\s*/,'').replace(/;$|\.$/,'');return}
    dentroRomano=false;
    if(p.k==='q'){atual.p.push('> '+t);qn=0;return}
    if(p.k==='li'){const prev=atual.p[atual.p.length-1]||'';if(/^> /.test(prev)){qn++;atual.p.push('> '+qn+'. '+t)}else atual.p.push('- '+t);return}
    atual.p.push(t);});
  /* troca dos valores fixos por chaves que o gerador preenche */
  const sub=s=>s.replace(/(remunera[çc][ãa]o mensal(?: bruta)? de )R\$\s*[\d.,]+\s*\([^)]*\)/i,'$1{VALOR_MENSAL} ({VALOR_EXTENSO})')
    .replace(/(Proposta Comercial\s+n[º°o]\.?\s*)\d{4}-\d{2,3}(?:-R\d+)?(,\s*de\s+[a-zç]+\s+de\s+\d{4})?/i,'$1{PROPOSTA}')
    .replace(/(vencimento\s+at[ée]\s+o\s+dia\s+)\d{1,2}(\s*\([^)]*\))?/i,'$1{VENCIMENTO}')
    .replace(/(Foro da Comarca de\s+)[A-ZÀ-Úa-zà-ú' ]+?(,|\.|\s+Estado)/,'$1{FORO}$2')
    .replace(/(previst[oa] para\s+)\d{1,2}\s*(?:º)?\s+de\s+[a-zç]+\s+de\s+\d{4}/i,'$1{INICIO}');
  R.clausulas.forEach(c=>c.p=c.p.map(sub));R.preambulo=R.preambulo.map(sub);
  R.numeracao=R.clausulas.some(c=>/^\d+\.\d/.test(c.t)||/^CL[ÁA]USULA/i.test(c.t))?'livre':'auto';
  R.qualificacao=/de um lado/i.test(texto)?'narrativa':'quadro';
  if(R.investimento.length&&R.totalTexto){const s=R.investimento.reduce((t,v)=>t+parseBRL(v.unit)*(parseInt(v.qtd)||0),0);if(Math.abs(s-R.totalTexto)>1)R.avisos.push('A soma dos postos ('+brl(s)+') não bate com o valor mensal escrito no texto ('+brl(R.totalTexto)+'). Confira o escopo.');}
  if(R.clausulas.some(c=>c.p.some(p=>/\b\d{2}\s+(postos?|colaboradores?)\b/i.test(p))))R.avisos.push('O texto das cláusulas cita quantidades de postos ou colaboradores por extenso. Se o escopo mudar, revise esses trechos.');
  return R;
}
let IMPORT=null;
async function importarArquivo(f){
  if(!f)return;toast('Lendo '+f.name+'…');
  try{const buf=await f.arrayBuffer();const par=/\.docx$/i.test(f.name)?await lerDocx(buf):await lerPdf(buf);const R=extrair(par);IMPORT={R,f};
    const lin=(rot,val)=>'<tr><td style="color:#8a8578;width:170px">'+rot+'</td><td>'+(val?esc(val):'<span style="color:#c0392b">não encontrado</span>')+'</td></tr>';
    const c=R.contratante,end=[c.endereco,c.numero,c.bairro,c.cidade,c.uf,c.cep].filter(Boolean).join(', ');
    let h='<h2>Importar: '+esc(f.name)+'</h2><table class="hist" style="margin-bottom:10px">'+
      lin('Contratante',c.nome)+lin('CNPJ',c.cnpj)+lin('Endereço',end)+lin('Representação',c.rep)+lin('Nº do contrato no arquivo',R.numero)+lin('Proposta',R.proposta)+
      lin('Postos com valor',R.investimento.length?R.investimento.map(v=>v.servico+' · '+v.escala+' · '+v.qtd+' × '+brl(parseBRL(v.unit))).join(' | '):'')+
      lin('Atividades por posto',R.atribuicoes.length?R.atribuicoes.map(a=>a.titulo).join(' | '):'')+
      lin('Vigência / vencimento / aviso',[R.condicoes.vigencia&&R.condicoes.vigencia+' meses',R.condicoes.vencimento&&'dia '+R.condicoes.vencimento,R.condicoes.aviso&&R.condicoes.aviso+' dias'].filter(Boolean).join(' · '))+
      lin('Início',R.condicoes.inicio?dataBR(R.condicoes.inicio):'')+lin('Foro',R.condicoes.foro)+lin('Cláusulas encontradas',R.clausulas.length?R.clausulas.length+' ('+R.clausulas.filter(c=>!c.h).length+' com texto)':'')+'</table>';
    if(R.avisos.length)h+='<div class="aviso">'+R.avisos.map(esc).join('<br>')+'</div>';
    h+='<div class="opts" style="display:flex;flex-direction:column;gap:6px;margin:6px 0 12px;font-size:13px">'+
      '<label class="opt"><input type="checkbox" id="im_cli" checked> Dados do contratante</label>'+
      '<label class="opt"><input type="checkbox" id="im_esc" '+(R.investimento.length||R.atribuicoes.length?'checked':'')+'> Escopo, postos e valores</label>'+
      '<label class="opt"><input type="checkbox" id="im_cond" checked> Condições (vigência, vencimento, aviso, foro, início)</label>'+
      '<label class="opt"><input type="checkbox" id="im_cl" '+(R.clausulas.length?'checked':'')+'> Cláusulas do arquivo (substitui as cláusulas atuais)</label>'+
      '<label class="opt"><input type="checkbox" id="im_mod"> Salvar as cláusulas também como modelo novo</label>'+
      '<label class="opt"><input type="checkbox" id="im_base" checked> Guardar o arquivo como documento-base</label></div>'+
      '<div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" style="background:#f3efe4" onclick="fechar()">Cancelar</button><button class="btn btn-gold" onclick="aplicarImport()">Preencher o contrato</button></div>';
    modal(h);
  }catch(e){toast('Não foi possível ler o arquivo: '+(e.message||e),1);}
}
async function aplicarImport(){
  if(!IMPORT)return;const {R,f}=IMPORT,on=id=>document.getElementById(id).checked;
  const cli=on('im_cli'),esc_=on('im_esc'),cond=on('im_cond'),cl=on('im_cl'),mod=on('im_mod'),base=on('im_base');fechar();
  if(cli){Object.keys(R.contratante).forEach(k=>{if(R.contratante[k])C.contratante[k]=R.contratante[k];});C.empresa=R.empresa;}
  if(esc_){if(R.investimento.length)C.proposta.investimento=R.investimento;if(R.atribuicoes.length)C.proposta.atribuicoes=R.atribuicoes;
    if(R.proposta&&!C.proposta.numero)C.proposta.numero=R.proposta;if(!C.propostaOrig)C.propostaOrig=JSON.parse(JSON.stringify({investimento:C.proposta.investimento,atribuicoes:C.proposta.atribuicoes}));}
  if(cond){const k=R.condicoes;['vigencia','vencimento','aviso','foro','inicio'].forEach(z=>{if(k[z])C[z]=k[z];});if(R.clausulas.length)C.multa=!!k.multa;}
  if(cl&&R.clausulas.length){C.clausulas=R.clausulas.map(c=>({t:c.t,p:c.p.slice(),on:true,h:c.h}));C.preambulo=R.preambulo;if(R.fecho)C.fecho=R.fecho;
    if(R.titulo)C.titulo=R.titulo;C.numeracao=R.numeracao;C.qualificacao=R.qualificacao;C.modeloId='importado';}
  render();sujo();editor();
  if(mod&&cl)await salvarComoModelo();
  if(base)await anexarBase(f,true);
  const p=pendencias();toast('Contrato preenchido com o arquivo.'+(p.length?' Veja as '+p.length+' pendências no topo.':''));
}
