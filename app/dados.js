/* =====================================================================
   C&S — camada de dados compartilhada (app do posto + painel)
   Dados ficam no Supabase; este arquivo mantém uma cópia local para
   abrir rápido e funcionar sem internet, e envia o que ficou pendente
   assim que a conexão volta.
   ===================================================================== */

// ---------- ARMAZENAMENTO LOCAL (cópia e fila) ----------
// App do posto e painel guardam separado (podem estar abertos no mesmo aparelho)
const PREFIXO = 'cs_' + (window.CS_APP || 'app') + '_';
const Store = {
  get(k, def) { try { const v = localStorage.getItem(PREFIXO + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(PREFIXO + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(PREFIXO + k); } catch (e) {} }
};

// ---------- MÓDULOS POR CONDOMÍNIO ----------
const MODULOS = [
  { id: 'ocorrencias', nome: 'Ocorrências' },
  { id: 'livro',       nome: 'Livro Ata' },
  { id: 'materiais',   nome: 'Materiais' },
  { id: 'checklist',   nome: 'Checklist' },
  { id: 'encomendas',  nome: 'Encomendas' },
  { id: 'denuncia',    nome: 'Canal de Denúncia' },
  { id: 'ronda',       nome: 'Ronda (tags NFC)', bloqueado: true }
];
const PARAM_PADRAO = { ocorrencias: true, livro: true, materiais: true, checklist: true, encomendas: true, denuncia: true, ronda: false };

// Modos de encomenda. O controle interno (fotos + data/hora) vale SEMPRE.
const MODOS_ENCOMENDA = {
  interno:  { letra: 'C', nome: 'Controle interno da portaria', desc: 'Foto na chegada, foto na retirada e data/hora. Sem contato com morador. (Padrão)' },
  parceria: { letra: 'B', nome: 'Parceria com a administradora', desc: 'Controle interno + base de moradores enviada pela administradora para avisar a chegada.' },
  api:      { letra: 'A', nome: 'Integração por API', desc: 'Controle interno + moradores vindos do sistema da administradora. Sem integração ativa, funciona como o modo C.' }
};

const FUNCOES = ['Porteiro', 'Aux. Limpeza', 'Zelador', 'A definir'];

// ---------- CONVERSÃO banco (snake_case) <-> tela (camelCase) ----------
const paraTela = r => { const o = {}; for (const k in r) o[k === 'posto_id' ? 'posto' : k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = r[k]; return o; };
const paraBanco = r => { const o = {}; for (const k in r) { if (k.startsWith('_')) continue; o[k === 'posto' ? 'posto_id' : k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = r[k]; } return o; };
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

// Tabelas: chave primária, ordenação, limite e quem carrega
const TABELAS = {
  postos:         { pk: ['id'], ordem: 'nome', asc: true },
  colaboradores:  { pk: ['id'], ordem: 'nome', asc: true },
  confirmacoes:   { pk: ['id'], dias: 3 },
  ocorrencias:    { pk: ['id'], dias: 90, limite: 500 },
  livro:          { pk: ['id'], limite: 300 },
  checklists:     { pk: ['id'], limite: 200 },
  estoque:        { pk: ['posto_id', 'material_id'], ordem: 'posto_id', asc: true },
  solicitacoes:   { pk: ['id'], limite: 300 },
  encomendas:     { pk: ['id'], limite: 600 },
  moradores:      { pk: ['id'], ordem: 'unidade', asc: true },
  alertas:        { pk: ['id'], dias: 7 },
  avisos:         { pk: ['id'], dias: 60 },
  avisos_leitura: { pk: ['aviso_id', 'posto_id'], ordem: 'lido_em', limite: 2000 },
  coberturas:     { pk: ['id'], limite: 200, papeis: ['adm', 'rh', 'sup', 'cond'] },
  denuncias:      { pk: ['id'], limite: 200, papeis: ['adm', 'rh'] },
  freelancers:    { pk: ['id'], ordem: 'nome', asc: true, papeis: ['adm', 'rh', 'sup'], semTempoReal: true },
  acionamentos:   { pk: ['id'], limite: 100, papeis: ['adm', 'rh', 'sup'], semTempoReal: true },
  acessos:        { pk: ['user_id'], ordem: 'email', asc: true, papeis: ['adm', 'rh'], semTempoReal: true },
  integracoes:    { pk: ['posto_id'], ordem: 'posto_id', asc: true, papeis: ['adm'], semTempoReal: true }
};
const chaveDe = (tab, rowBanco) => TABELAS[tab].pk.map(k => rowBanco[k]).join('|');

// ---------- FOTOS PENDENTES (IndexedDB) ----------
const FotosLocais = {
  _db: null,
  abrir() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, erro) => {
      const r = indexedDB.open(PREFIXO + 'fotos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('pendentes');
      r.onsuccess = () => { this._db = r.result; ok(this._db); };
      r.onerror = () => erro(r.error);
    });
  },
  async guardar(path, blob) { const db = await this.abrir(); return new Promise(ok => { const t = db.transaction('pendentes', 'readwrite'); t.objectStore('pendentes').put(blob, path); t.oncomplete = ok; t.onerror = ok; }); },
  async listar() { const db = await this.abrir(); return new Promise(ok => { const out = []; const c = db.transaction('pendentes').objectStore('pendentes').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else ok(out); }; c.onerror = () => ok(out); }); },
  async apagar(path) { const db = await this.abrir(); return new Promise(ok => { const t = db.transaction('pendentes', 'readwrite'); t.objectStore('pendentes').delete(path); t.oncomplete = ok; t.onerror = ok; }); }
};

// Reduz a foto para ~1280px JPEG (economiza dados do celular do posto)
function comprimirFoto(file, max = 1280, q = 0.72) {
  return new Promise((ok, erro) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : erro(new Error('foto')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('Não foi possível ler a foto')); };
    img.src = url;
  });
}

// =====================================================================
//  NUVEM — conexão com o Supabase
// =====================================================================
const Nuvem = {
  sb: null, acesso: null, cache: {}, canal: null,
  conectado: false, aoMudar: () => {}, aoErro: () => {}, aoStatus: () => {},
  configurado() { return !!(window.CS_CONFIG && CS_CONFIG.url && CS_CONFIG.chave && !/COLE_AQUI/.test(CS_CONFIG.url + CS_CONFIG.chave)); },

  async iniciar(opts) {
    Object.assign(this, opts || {});
    if (!this.configurado()) return null;
    this.sb = supabase.createClient(CS_CONFIG.url, CS_CONFIG.chave, { auth: { persistSession: true, autoRefreshToken: true, storageKey: PREFIXO + 'auth' } });
    this.cache = Store.get('cache', {});
    this.acesso = Store.get('acesso', null);
    const { data } = await this.sb.auth.getSession().catch(() => ({ data: {} }));
    if (!data || !data.session) { this.acesso = null; return null; }
    if (navigator.onLine) { try { await this._lerAcesso(data.session.user); } catch (e) { if (!this.acesso) return null; } }
    if (!this.acesso) return null;
    this._ligarEventos();
    this.carregar().then(() => this.assinar());
    this.tentar();
    return this.acesso;
  },

  async _lerAcesso(user) {
    const { data, error } = await this.sb.from('acessos').select('papel, posto_id, email, nome').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    this.acesso = data ? paraTela(data) : null;
    Store.set('acesso', this.acesso);
  },

  async entrar(email, senha) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) throw new Error(/Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos' : error.message);
    await this._lerAcesso(data.user);
    if (!this.acesso) { await this.sb.auth.signOut(); throw new Error('Este login ainda não foi liberado pela administração'); }
    this.cache = {}; Store.set('cache', {});
    this._ligarEventos();
    await this.carregar(); this.assinar(); this.tentar();
    return this.acesso;
  },

  async sair() {
    try { if (this.canal) await this.sb.removeChannel(this.canal); } catch (e) {}
    try { await this.sb.auth.signOut(); } catch (e) {}
    ['cache', 'acesso', 'fila', 'device_posto'].forEach(k => Store.del(k));
    this.acesso = null; this.cache = {};
  },

  tabelasDoPapel() {
    return Object.keys(TABELAS).filter(t => !TABELAS[t].papeis || TABELAS[t].papeis.includes(this.acesso.papel));
  },

  async carregar() {
    if (!navigator.onLine) return;
    const tabs = this.tabelasDoPapel();
    const resultados = await Promise.all(tabs.map(async t => {
      const c = TABELAS[t];
      let q = this.sb.from(t).select('*');
      if (c.dias) q = q.gte(t === 'confirmacoes' ? 'data_turno' : 'criado_em', isoDia(new Date(Date.now() - c.dias * 86400000)));
      q = q.order(c.ordem || 'criado_em', { ascending: !!c.asc });
      q = q.limit(c.limite || 5000);
      const { data, error } = await q;
      return [t, data, error];
    }));
    resultados.forEach(([t, data, error]) => {
      if (error) { console.warn('carregar', t, error.message); return; }
      // mantém o que ainda está na fila (feito sem internet)
      const pend = this._fila().filter(op => op.tabela === t && op.tipo !== 'update').map(op => op.dados);
      const mapa = new Map(data.map(r => [chaveDe(t, r), r]));
      pend.forEach(r => { const k = chaveDe(t, r); if (!mapa.has(k)) mapa.set(k, r); });
      this.cache[t] = [...mapa.values()];
    });
    this._salvarCache();
    this.aoMudar('*');
  },

  assinar() {
    if (!this.sb || !this.acesso) return;
    if (this.canal) { try { this.sb.removeChannel(this.canal); } catch (e) {} }
    let ch = this.sb.channel('cs-' + Math.random().toString(36).slice(2));
    this.tabelasDoPapel().filter(t => !TABELAS[t].semTempoReal).forEach(t => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => this._aplicar(t, p));
    });
    this.canal = ch.subscribe(st => {
      const antes = this.conectado;
      this.conectado = st === 'SUBSCRIBED';
      this.aoStatus();
      if (this.conectado && !antes && this._jaConectou) this.carregar(); // reconectou: sincroniza o que perdeu
      if (this.conectado) this._jaConectou = true;
    });
  },

  _aplicar(t, p) {
    const lista = this.cache[t] || (this.cache[t] = []);
    if (p.eventType === 'DELETE') {
      const k = chaveDe(t, p.old || {});
      this.cache[t] = lista.filter(r => chaveDe(t, r) !== k);
    } else {
      const k = chaveDe(t, p.new);
      const i = lista.findIndex(r => chaveDe(t, r) === k);
      if (i >= 0) lista[i] = p.new; else lista.push(p.new);
    }
    this._salvarCache();
    this.aoMudar(t, p);
  },

  _salvarCache() { clearTimeout(this._tSalvar); this._tSalvar = setTimeout(() => Store.set('cache', this.cache), 400); },

  _ligarEventos() {
    if (this._eventos) return; this._eventos = true;
    window.addEventListener('online', () => { this.tentar(); this.carregar(); this.aoStatus(); setTimeout(() => this.assinar(), 1500); });
    window.addEventListener('offline', () => { this.conectado = false; this.aoStatus(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.tentar(); this.carregar(); } });
    setInterval(() => this.tentar(), 20000);
  },

  // ---------- GRAVAÇÃO COM FILA ----------
  _fila() { return Store.get('fila', []); },
  pendentes() { return this._fila().length; },
  gravar(op) {
    const f = this._fila(); f.push(op); Store.set('fila', f);
    this.aoStatus(); this.tentar();
  },
  async tentar() {
    if (this._tentando || !this.sb || !navigator.onLine) return;
    this._tentando = true;
    try {
      let f = this._fila();
      while (f.length) {
        const op = f[0];
        let res;
        if (op.tipo === 'insert') res = await this.sb.from(op.tabela).insert(op.dados);
        else if (op.tipo === 'upsert') res = await this.sb.from(op.tabela).upsert(op.dados, { onConflict: op.conflito, ignoreDuplicates: !!op.ignorar });
        else if (op.tipo === 'update') { let q = this.sb.from(op.tabela).update(op.dados); for (const k in op.onde) q = q.eq(k, op.onde[k]); res = await q; }
        else if (op.tipo === 'delete') { let q = this.sb.from(op.tabela).delete(); for (const k in op.onde) q = q.eq(k, op.onde[k]); res = await q; }
        else if (op.tipo === 'rpc') res = await this.sb.rpc(op.nome, op.args);
        if (res && res.error) {
          const msg = res.error.message || '';
          if (/fetch|network|Failed|timeout|Load failed/i.test(msg) || !navigator.onLine) break; // sem internet: tenta depois
          if (res.error.code === '23505') { /* já existe (ex.: confirmação repetida) */ }
          else { console.warn('gravar', op, res.error); this.aoErro(op, res.error); }
        }
        f = this._fila(); f.shift(); Store.set('fila', f);
        this.aoStatus();
      }
      await this._enviarFotos();
    } finally { this._tentando = false; this.aoStatus(); }
  },

  // ---------- FOTOS ----------
  async guardarFoto(path, blob) { await FotosLocais.guardar(path, blob); this._fotosPend = (this._fotosPend || 0) + 1; this.aoStatus(); this.tentar(); },
  async _enviarFotos() {
    let itens = [];
    try { itens = await FotosLocais.listar(); } catch (e) { return; }
    this._fotosPend = itens.length;
    for (const [path, blob] of itens) {
      const { error } = await this.sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error && !/exists|Duplicate/i.test(error.message)) {
        if (/fetch|network|Failed/i.test(error.message)) break;
        console.warn('foto', path, error.message);
      }
      await FotosLocais.apagar(path); this._fotosPend--;
    }
  },
  _urls: {},
  async urlFoto(path) {
    if (!path) return null;
    const c = this._urls[path]; if (c && c.ate > Date.now()) return c.url;
    const { data, error } = await this.sb.storage.from('fotos').createSignedUrl(path, 3600);
    if (error) return null;
    this._urls[path] = { url: data.signedUrl, ate: Date.now() + 50 * 60000 };
    return data.signedUrl;
  },

  async rpc(nome, args) { const { data, error } = await this.sb.rpc(nome, args); if (error) throw new Error(error.message); return data; }
};

// =====================================================================
//  DB — leitura imediata da cópia local; gravação vai para a nuvem
// =====================================================================
const linhas = t => (Nuvem.cache[t] || []).map(paraTela);
const porData = (a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));

const DB = {
  postos() { return linhas('postos').filter(p => p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)); },
  posto(id) { return this.postos().find(p => p.id === id); },
  colaboradores() { return linhas('colaboradores').sort((a, b) => a.nome.localeCompare(b.nome)); },
  doPosto(id) { return this.colaboradores().filter(c => c.posto === id && c.ativo !== false); },
  params(id) { const p = this.posto(id); return Object.assign({}, PARAM_PADRAO, (p && p.params) || {}); },
  modoEncomenda(id) { const p = this.posto(id); return (p && p.encomendaModo) || 'interno'; },
  setParam(id, k, v) { const p = this.posto(id); this.update('postos', id, { params: Object.assign({}, (p && p.params) || {}, { [k]: v }) }); },
  list(t) { return linhas(t).sort(porData); },

  _local(t, rowBanco) {
    const lista = Nuvem.cache[t] || (Nuvem.cache[t] = []);
    const k = chaveDe(t, rowBanco), i = lista.findIndex(r => chaveDe(t, r) === k);
    if (i >= 0) lista[i] = Object.assign({}, lista[i], rowBanco); else lista.push(rowBanco);
    Nuvem._salvarCache();
  },
  push(t, item) {
    const row = paraBanco(Object.assign({ id: novoId(), criadoEm: new Date().toISOString() }, item));
    this._local(t, row); Nuvem.gravar({ tabela: t, tipo: 'insert', dados: row });
    return paraTela(row);
  },
  update(t, id, patch) {
    const dados = paraBanco(patch); const onde = { [TABELAS[t].pk[0]]: id };
    const atual = (Nuvem.cache[t] || []).find(r => r[TABELAS[t].pk[0]] === id);
    if (atual) Object.assign(atual, dados), Nuvem._salvarCache();
    Nuvem.gravar({ tabela: t, tipo: 'update', dados, onde });
  },
  remove(t, id) {
    const k = TABELAS[t].pk[0];
    Nuvem.cache[t] = (Nuvem.cache[t] || []).filter(r => r[k] !== id); Nuvem._salvarCache();
    Nuvem.gravar({ tabela: t, tipo: 'delete', onde: { [k]: id } });
  },
  upsert(t, item, conflito, ignorar) {
    const row = paraBanco(item); this._local(t, row);
    Nuvem.gravar({ tabela: t, tipo: 'upsert', dados: row, conflito, ignorar });
  },

  estoque(postoId) { const m = {}; linhas('estoque').filter(r => r.posto === postoId).forEach(r => m[r.materialId] = r.qtd); return m; },
  minimo(postoId, matId) { const r = linhas('estoque').find(x => x.posto === postoId && x.materialId === matId); const cat = MATERIAIS_CATALOGO.find(x => x.id === matId); return r && r.minimo != null ? r.minimo : (cat ? cat.min : 0); },
  setEstoque(postoId, matId, qtd) { this.upsert('estoque', { posto: postoId, materialId: matId, qtd: Math.max(0, qtd), atualizadoEm: new Date().toISOString() }, 'posto_id,material_id'); },
  setMinimo(postoId, matId, minimo) { this.upsert('estoque', { posto: postoId, materialId: matId, minimo }, 'posto_id,material_id'); },

  confirmacoes() { const m = {}; linhas('confirmacoes').forEach(c => m[c.colaboradorId + '|' + c.dataTurno] = c); return m; },
  confirmar(colabId, dataTurno, extra) {
    const ja = this.confirmacoes()[colabId + '|' + dataTurno]; if (ja) return;
    const row = paraBanco(Object.assign({ id: novoId(), colaboradorId: colabId, dataTurno, hora: new Date().toISOString(), criadoEm: new Date().toISOString() }, extra || {}));
    this._local('confirmacoes', row);
    Nuvem.gravar({ tabela: 'confirmacoes', tipo: 'upsert', dados: row, conflito: 'colaborador_id,data_turno', ignorar: true });
  },

  avisosDoPosto(postoId) { return this.list('avisos').filter(a => !a.destino || a.destino.includes(postoId)); },
  leitura(avisoId, postoId) { return linhas('avisos_leitura').find(l => l.avisoId === avisoId && l.posto === postoId); }
};

// ---------- MATERIAIS ----------
const MATERIAIS_CATALOGO = [
  { id: 'saco100',   nome: 'Saco de lixo 100L', un: 'un',  min: 10 },
  { id: 'desinf',    nome: 'Desinfetante 5L',   un: 'gl',  min: 2 },
  { id: 'agua_sanit', nome: 'Água sanitária',   un: 'un',  min: 2 },
  { id: 'deterg',    nome: 'Detergente',        un: 'un',  min: 2 },
  { id: 'luvas',     nome: 'Luvas descartáveis', un: 'pares', min: 5 },
  { id: 'papel',     nome: 'Papel higiênico',   un: 'rolos', min: 12 },
  { id: 'pano',      nome: 'Pano de chão',      un: 'un',  min: 4 },
  { id: 'vassoura',  nome: 'Vassoura',          un: 'un',  min: 1 }
];

function statusEstoque(qtd, min) {
  if (qtd == null) return { id: 'none', label: 'Contar' };
  if (qtd <= 0) return { id: 'out', label: 'Esgotado' };
  if (qtd <= min) return { id: 'low', label: 'Baixo' };
  return { id: 'ok', label: 'OK' };
}

// ---------- CHECKLISTS POR POSTO ----------
const CHECKLISTS = {
  portaria: { nome: 'Portaria', funcao: 'Porteiro', itens: [
    'Portões (social e garagem) abrindo e fechando',
    'Interfone / telefone funcionando',
    'Câmeras aparecendo no monitor',
    'Controle de acesso (tags, controles, biometria) funcionando',
    'Iluminação da guarita e da entrada',
    'Cerca elétrica / alarme ativos',
    'Registro de visitantes em dia',
    'Chaves conferidas no claviculário',
    'Encomendas pendentes conferidas',
    'Celular do posto carregado'
  ]},
  limpeza: { nome: 'Limpeza', funcao: 'Aux. Limpeza', itens: [
    'Hall de entrada e portaria limpos',
    'Elevadores limpos (piso, espelho, painel)',
    'Escadas e corredores varridos',
    'Banheiros de áreas comuns limpos e abastecidos',
    'Lixeiras esvaziadas e com saco',
    'Lixo separado (reciclável / orgânico)',
    'Vidros e espelhos limpos',
    'Salão de festas / academia limpos',
    'Materiais de limpeza guardados',
    'EPI em uso (luvas, botas)'
  ]},
  zeladoria: { nome: 'Zeladoria', funcao: 'Zelador', itens: [
    'Bombas d\'água funcionando e caixa d\'água com nível normal',
    'Lâmpadas queimadas verificadas',
    'Extintores no lugar, lacrados e na validade',
    'Portas corta-fogo fechadas',
    'Sem vazamentos ou infiltrações aparentes',
    'Casa de máquinas / elevadores sem ruído anormal',
    'Piscina limpa (cloro e pH) — se houver',
    'Jardim e irrigação em ordem',
    'Quadro de energia / gerador sem alerta',
    'Lixo colocado para a coleta no horário'
  ]}
};

// ---------- DATAS ----------
const pad = n => String(n).padStart(2, '0');
const isoDia = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const horaMin = s => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmtHora = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const TOLERANCIA_MIN = 15;

function diasEntre(aIso, bIso) {
  const a = new Date(aIso + 'T12:00:00'), b = new Date(bIso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

// Turno da pessoa em um determinado dia
//  -> null (não trabalha) | { ini, fim, label, certeza: 'sim'|'talvez', nota }
function turnoNoDia(colab, dataIso) {
  const e = colab.escala;
  if (!e) return { ini: null, fim: null, label: 'Escala a definir', certeza: 'talvez', nota: 'Sem horário na escala' };
  const dt = new Date(dataIso + 'T12:00:00');
  if (e.tipo === '12x36') {
    const label = '12x36 ' + (e.periodo === 'noturno' ? 'Noturno' : 'Diurno');
    if (e.ref) {
      const d = diasEntre(e.ref, dataIso);
      if (Math.abs(d) % 2 !== 0) return null;
      return { ini: e.ini, fim: e.fim, label, certeza: 'sim' };
    }
    return { ini: e.ini, fim: e.fim, label, certeza: 'talvez', nota: 'Dia do plantão não definido' };
  }
  if (e.tipo === 'semanal') {
    const wd = dt.getDay();
    const h = e.dias && e.dias[wd];
    if (h) return { ini: h[0], fim: h[1], label: 'Escala semanal', certeza: 'sim' };
    if (e.fds && (wd === 0 || wd === 6)) {
      return { ini: e.fds.ini, fim: e.fds.fim, label: 'Sábado ou domingo', certeza: 'talvez', nota: 'Fim de semana alternado' };
    }
    return null;
  }
  return null;
}

// Situação da pessoa AGORA (considera plantão noturno que começou ontem)
function situacaoAgora(colab, agora) {
  agora = agora || new Date();
  const hoje = isoDia(agora);
  const ontemD = new Date(agora); ontemD.setDate(ontemD.getDate() - 1);
  const ontem = isoDia(ontemD);
  const min = agora.getHours() * 60 + agora.getMinutes();
  const conf = DB.confirmacoes();

  const candidatos = [];
  const tOntem = turnoNoDia(colab, ontem);
  if (tOntem && tOntem.ini && horaMin(tOntem.fim) < horaMin(tOntem.ini) && min < horaMin(tOntem.fim)) {
    candidatos.push(Object.assign({ data: ontem, inicioMin: horaMin(tOntem.ini) - 1440, fimMin: horaMin(tOntem.fim) }, tOntem));
  }
  const tHoje = turnoNoDia(colab, hoje);
  if (tHoje) {
    if (tHoje.ini) {
      let fimMin = horaMin(tHoje.fim);
      if (fimMin <= horaMin(tHoje.ini)) fimMin += 1440;
      candidatos.push(Object.assign({ data: hoje, inicioMin: horaMin(tHoje.ini), fimMin }, tHoje));
    } else {
      candidatos.push(Object.assign({ data: hoje, inicioMin: null, fimMin: null }, tHoje));
    }
  }

  // Escolhe o turno em andamento, ou o próximo de hoje
  let t = candidatos.find(c => c.inicioMin != null && min >= c.inicioMin - 60 && min < c.fimMin) ||
          candidatos.find(c => c.inicioMin == null) || null;
  if (!t) {
    const proximo = candidatos.find(c => c.inicioMin != null && min < c.inicioMin);
    const encerrado = candidatos.find(c => c.inicioMin != null && min >= c.fimMin);
    return { status: 'folga', turno: proximo || encerrado || null, emTurno: false,
      texto: proximo ? 'Entra às ' + proximo.ini : (encerrado ? 'Turno encerrado' : 'Folga hoje') };
  }

  const c = conf[colab.id + '|' + t.data];
  if (c) return { status: 'confirmado', turno: t, emTurno: true, horaConf: fmtHora(new Date(c.hora)), cobertura: c.cobertura };
  if (t.inicioMin == null) return { status: 'indefinido', turno: t, emTurno: true, texto: 'Horário a definir' };
  if (min < t.inicioMin) return { status: 'aguardando', turno: t, emTurno: true, texto: 'Entra às ' + t.ini };
  if (min <= t.inicioMin + TOLERANCIA_MIN) return { status: 'pendente', turno: t, emTurno: true, texto: 'Aguardando confirmação' };
  if (t.certeza === 'talvez') return { status: 'verificar', turno: t, emTurno: true, texto: 'Sem confirmação — ' + (t.nota || 'verificar escala') };
  return { status: 'ausente', turno: t, emTurno: true, texto: 'Sem confirmação após ' + TOLERANCIA_MIN + ' min' };
}

// Situação de todos do posto, resolvendo duplas/grupos de 12x36 sem dia definido:
// se metade do grupo (mesmo período e função) já confirmou, os demais ficam como folga provável.
function situacoesPosto(postoId, agora) {
  agora = agora || new Date();
  const lista = DB.doPosto(postoId).map(c => ({ colab: c, sit: situacaoAgora(c, agora) }));
  const grupos = {};
  lista.forEach(x => {
    const e = x.colab.escala;
    if (e && e.tipo === '12x36' && !e.ref && x.sit.turno) {
      const k = e.periodo + '|' + x.colab.funcao + '|' + x.sit.turno.data;
      (grupos[k] = grupos[k] || []).push(x);
    }
  });
  const k_ = x => x.colab.posto + '|' + x.colab.escala.periodo + '|' + x.colab.funcao;
  Object.values(grupos).forEach(g => {
    if (g.length < 2) return;
    const vagas = Math.ceil(g.length / 2);
    const confs = g.filter(x => x.sit.status === 'confirmado');
    if (confs.length >= vagas) {
      g.filter(x => x.sit.status !== 'confirmado').forEach(x => {
        x.sit = Object.assign({}, x.sit, { status: 'folga', emTurno: false, texto: 'Folga (plantão coberto)' });
      });
    } else {
      const nomes = g.map(x => x.colab.nome);
      g.forEach(x => { if (x.sit.status === 'ausente') x.sit.status = 'verificar';
        x.sit = Object.assign({}, x.sit, { grupoKey: k_(x), grupoNomes: nomes, vagas }); });
    }
  });
  return lista;
}

const STATUS_INFO = {
  confirmado: { label: 'Confirmado', cor: 'green' },
  pendente:   { label: 'Pendente',   cor: 'orange' },
  aguardando: { label: 'Aguardando', cor: 'silver' },
  verificar:  { label: 'Verificar',  cor: 'orange' },
  ausente:    { label: 'Ausente',    cor: 'red' },
  indefinido: { label: 'Escala a definir', cor: 'silver' },
  folga:      { label: 'Fora do turno', cor: 'silver' }
};

function descreverEscala(e) {
  if (!e) return 'A definir';
  if (e.tipo === '12x36') return '12x36 ' + (e.periodo === 'noturno' ? 'noturno' : 'diurno') + ' · ' + e.ini + '–' + e.fim + (e.ref ? ' · ref. ' + e.ref.split('-').reverse().join('/') : ' · dia do plantão a definir');
  const partes = [];
  const grupos = {};
  Object.keys(e.dias || {}).forEach(d => { const k = e.dias[d].join('–'); (grupos[k] = grupos[k] || []).push(+d); });
  Object.keys(grupos).forEach(k => partes.push(grupos[k].map(d => DIAS_SEMANA[d]).join(', ') + ' ' + k));
  if (e.fds) partes.push('sáb ou dom' + (e.fds.ini ? ' ' + e.fds.ini + '–' + e.fds.fim : ' (horário a definir)'));
  return partes.join(' · ');
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const soDigitos = s => String(s || '').replace(/\D/g, '');
function linkWhats(tel, msg) {
  let n = soDigitos(tel); if (n.length <= 11) n = '55' + n;
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg);
}
