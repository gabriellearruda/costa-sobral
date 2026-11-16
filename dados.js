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
  { id: 'materiais',   nome: 'Materiais', dica: 'Desligue quando o material é do próprio condomínio (não é da C&S)' },
  { id: 'checklist',   nome: 'Checklist' },
  { id: 'encomendas',  nome: 'Encomendas' },
  { id: 'denuncia',    nome: 'Canal de Denúncia' },
  { id: 'cronograma',  nome: 'Cronograma de limpeza' },
  { id: 'ronda',       nome: 'Ronda (tags NFC)', bloqueado: true }
];
// ocnova: ocorrências na versão nova (planta, prioridade, histórico e alertas). Desligado = tela clássica.
const PARAM_PADRAO = { ocorrencias: true, ocnova: false, livro: true, materiais: true, checklist: true, encomendas: true, denuncia: true, cronograma: true, ronda: false };

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
  cronogramas:          { pk: ['id'], ordem: 'nome', asc: true },
  cronograma_tarefas:   { pk: ['id'], ordem: 'ordem', asc: true },
  cronograma_equipes:   { pk: ['id'], ordem: 'ordem', asc: true },
  cronograma_execucoes: { pk: ['id'], dias: 35, campoData: 'data', ordem: 'data' },
  ocorrencias_historico: { pk: ['id'], dias: 90, limite: 3000 },
  condominio_mapa:      { pk: ['posto_id'], ordem: 'posto_id', asc: true },
  areas:                { pk: ['id'], ordem: 'ordem', asc: true },
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
    if (this.aoAuth) this.sb.auth.onAuthStateChange((ev, s) => setTimeout(() => this.aoAuth(ev, s), 0));
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
      if (c.dias) q = q.gte(c.campoData || (t === 'confirmacoes' ? 'data_turno' : 'criado_em'), isoDia(new Date(Date.now() - c.dias * 86400000)));
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
    if (this._tentando) { this._denovo = true; return; } // ocupado (ex.: enviando foto): roda de novo ao terminar
    if (!this.sb || !navigator.onLine) return;
    this._tentando = true; this._denovo = false;
    try {
      let f = this._fila(), adiadas = 0;
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
          if (/column|relation|schema cache|does not exist/i.test(msg) && /ocorrencias|areas|mapa|historico/.test(op.tabela)) {
            // banco ainda sem a atualização (SQL 07): guarda no fim da fila e segue com o resto
            f = this._fila(); if (adiadas >= f.length) break; // só restam as que esperam
            f.push(f.shift()); Store.set('fila', f); adiadas++; continue;
          }
          if (res.error.code === '23505') { /* já existe (ex.: confirmação repetida) */ }
          else { console.warn('gravar', op, res.error); this.aoErro(op, res.error); }
        }
        f = this._fila(); f.shift(); Store.set('fila', f);
        this.aoStatus();
      }
      await this._enviarFotos();
    } finally { this._tentando = false; this.aoStatus(); if (this._denovo) { this._denovo = false; setTimeout(() => this.tentar(), 50); } }
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

  // ---------- SENHA ----------
  async trocarSenha(atual, nova) {
    const email = (this.acesso && this.acesso.email) || ((await this.sb.auth.getUser()).data.user || {}).email;
    if (atual !== null) { // confirma a senha atual antes de trocar
      const r = await this.sb.auth.signInWithPassword({ email, password: atual });
      if (r.error) throw new Error('Senha atual incorreta');
    }
    const { error } = await this.sb.auth.updateUser({ password: nova });
    if (error) throw new Error(/different/i.test(error.message) ? 'A nova senha precisa ser diferente da atual' : /weak|least|short/i.test(error.message) ? 'Senha fraca: use pelo menos 8 caracteres, com letras e números' : error.message);
  },
  async esqueciSenha(email, voltarPara) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: voltarPara });
    if (error && /rate|seconds/i.test(error.message)) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
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

  cronograma(postoId) { return linhas('cronogramas').find(c => c.posto === postoId && c.ativo !== false); },
  // atividades em ordem de horário; dist: só as da distribuição informada (as sem equipe valem em todas)
  tarefas(cronId, dist) {
    return linhas('cronograma_tarefas').filter(t => t.cronogramaId === cronId && t.ativo !== false && (dist === undefined || !t.equipeId || ((this.equipe(t.equipeId) || {}).distribuicao === dist && (this.equipe(t.equipeId) || {}).ativo !== false)))
      .sort((a, b) => String(a.horaIni || '99').localeCompare(String(b.horaIni || '99')) || (a.ordem || 0) - (b.ordem || 0));
  },
  equipe(id) { return linhas('cronograma_equipes').find(e => e.id === id); },
  equipes(cronId, dist) { return linhas('cronograma_equipes').filter(e => e.cronogramaId === cronId && e.ativo !== false && (dist === undefined || e.distribuicao === dist)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome)); },
  distribuicoes(cronId) { return [...new Set(this.equipes(cronId).map(e => e.distribuicao))].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })); },
  // atividade só conta a partir do dia em que foi criada (não gera "atraso" retroativo)
  tarefasDoDia(cronId, dataIso) { const wd = new Date(dataIso + 'T12:00:00').getDay(), c = linhas('cronogramas').find(x => x.id === cronId) || {}; return this.tarefas(cronId, c.distribuicao || null).filter(t => (t.dias || []).includes(wd) && (!t.criadoEm || isoDia(new Date(t.criadoEm)) <= dataIso)); },
  execucao(tarefaId, dataIso) { return linhas('cronograma_execucoes').find(e => e.tarefaId === tarefaId && e.data === dataIso); },
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


// ---------- CRONOGRAMA ----------
const ATIVIDADES_CATALOGO = [
  'Limpeza da portaria e catação na área externa',
  'Lavagem da lixeira',
  'Conservação dos blocos (varrer, corrimão e extintores)',
  'Lavagem semi-seca dos blocos',
  'Conservação dos térreos dos blocos',
  'Limpeza das janelas e vidros dos blocos e salão',
  'Limpeza do salão',
  'Limpeza dos elevadores',
  'Limpeza das escadas',
  'Limpeza do hall de entrada',
  'Limpeza da garagem',
  'Lavagem das calçadas',
  'Limpeza da academia',
  'Limpeza da área da piscina',
  'Limpeza do playground',
  'Limpeza dos banheiros das áreas comuns',
  'Retirada do lixo e coleta seletiva',
  'Rega do jardim',
  'Limpeza da churrasqueira',
  'Limpeza dos vidros da portaria'
];
const DIAS_ORDEM = [1, 2, 3, 4, 5, 6, 0];
const DIAS_NOME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
function compactarBlocos(lista) {
  const nums = lista.map(Number);
  if (!lista.length || nums.some(isNaN)) return lista.join(', ');
  const s = [...new Set(nums)].sort((a, b) => a - b), out = []; let ini = s[0], ant = s[0];
  for (let i = 1; i <= s.length; i++) { if (s[i] === ant + 1) { ant = s[i]; continue; } out.push(ini === ant ? '' + ini : ini + ' a ' + ant); ini = ant = s[i]; }
  return out.join(', ');
}
// torres com letra: "Torres A, B e C"; blocos numerados: "Blocos 1 a 8"
function descreverBlocos(bl) {
  bl = bl || [];
  if (!bl.length) return 'sem torres';
  if (bl.every(b => /^[A-Z]$/i.test(b))) return (bl.length === 1 ? 'Torre ' : 'Torres ') + (bl.length > 1 ? bl.slice(0, -1).join(', ') + ' e ' + bl[bl.length - 1] : bl[0]);
  return bl.some(b => isNaN(Number(b))) ? bl.join(', ') : (bl.length === 1 ? 'Bloco ' : 'Blocos ') + compactarBlocos(bl);
}
function descreverOnde(t) {
  const eq = t.equipeId && DB.equipe(t.equipeId);
  if (eq) return eq.nome + ' · ' + descreverBlocos(eq.blocos);
  if (t.abrangencia === 'todos') return 'Todos os blocos';
  if (t.abrangencia === 'alguns') return descreverBlocos(t.blocos);
  return 'Área comum';
}
const hm = v => v ? String(v).slice(0, 5) : '';
const horarioTarefa = t => t.horaIni ? hm(t.horaIni) + (t.horaFim ? '–' + hm(t.horaFim) : '') : '';
function inicioSemana(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); const wd = x.getDay(); x.setDate(x.getDate() - (wd === 0 ? 6 : wd - 1)); return x; }
function diasDaSemana(seg) { return DIAS_ORDEM.map((_, i) => { const x = new Date(seg); x.setDate(x.getDate() + i); return isoDia(x); }); }
const fmtDiaMes = iso => iso.split('-').reverse().slice(0, 2).join('/');

// =====================================================================
//  OCORRÊNCIAS — categorias, prioridades e local na planta
// =====================================================================
const OC_CATEGORIAS = {
  'Emergência': ['Vidro quebrado', 'Vazamento de água', 'Cheiro de gás', 'Fumaça ou princípio de incêndio', 'Pessoa ferida', 'Elevador com pessoa presa', 'Queda de energia'],
  'Predial': ['Lâmpada queimada', 'Infiltração', 'Porta ou fechadura com defeito', 'Elevador parado', 'Interfone com defeito', 'Reboco solto ou rachadura'],
  'Área comum': ['Equipamento quebrado', 'Sujeira ou limpeza', 'Portão com defeito', 'Iluminação externa', 'Poda ou jardinagem'],
  'Convivência': ['Barulho', 'Uso indevido de área comum', 'Animal solto'],
  'Controle de acesso': ['Portão aberto', 'Pessoa não identificada', 'Veículo em vaga indevida'],
  'Outro': ['Outro (escrever)']
};
const OC_PRIORIDADES = {
  emergencia: { nome: 'Emergência', cor: '#e5484d', pill: 'red' },
  alta:       { nome: 'Alta',       cor: '#f08a3c', pill: 'orange' },
  media:      { nome: 'Média',      cor: '#f0c43c', pill: 'gold' },
  baixa:      { nome: 'Baixa',      cor: '#7fb0e8', pill: 'silver' }
};
const OC_STATUS = { aberta: ['Aberta', 'red'], andamento: ['Em atendimento', 'orange'], resolvida: ['Resolvida', 'green'] };
const OC_TELEFONES = [['Bombeiros', '193'], ['SAMU', '192'], ['Polícia', '190'], ['Defesa Civil', '199']];
const OC_RESPONSAVEIS = ['Zeladoria', 'Supervisão C&S', 'Portaria', 'Síndico', 'Empresa terceirizada'];
function prioridadeSugerida(grupo, item) {
  if (grupo === 'Emergência') return 'emergencia';
  if (['Lâmpada queimada', 'Sujeira ou limpeza', 'Poda ou jardinagem', 'Barulho'].includes(item)) return 'baixa';
  if (grupo === 'Controle de acesso') return 'alta';
  return 'media';
}
const andarNome = a => a === 0 ? 'Térreo' : a + 'º andar';
const ocTitulo = o => o.titulo || o.categoria || 'Ocorrência';
function ocLocal(o) {
  const partes = [];
  if (o.localNome) partes.push(o.localNome);
  else if (o.torre) partes.push('Torre ' + o.torre);
  if (o.andar != null && o.andar !== '') partes.push(andarNome(+o.andar));
  if (!partes.length && o.mapaX != null) partes.push('Ponto marcado na planta');
  return partes.join(' · ');
}
const ocPrioridade = o => OC_PRIORIDADES[o.prioridade] || OC_PRIORIDADES.media;
// ponto da ocorrência na planta: o marcado; senão o do local cadastrado; senão o da torre
function ocPontoPlanta(o) {
  if (o.mapaX != null && o.mapaY != null) return { x: +o.mapaX, y: +o.mapaY };
  const a = (o.areaId && DB.area(o.areaId)) || (o.torre && DB.areas(o.posto).find(x => x.tipo === 'torre' && torreDaArea(x) === String(o.torre)));
  return a && a.x != null ? { x: +a.x, y: +a.y } : null;
}
const torreDaArea = a => a && a.tipo === 'torre' ? (a.codigo || a.nome.replace(/^torre\s*/i, '')) : null;

Object.assign(DB, {
  mapa(postoId) { return linhas('condominio_mapa').find(m => m.posto === postoId) || null; },
  areas(postoId) { return linhas('areas').filter(a => a.posto === postoId && a.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome)); },
  area(id) { return linhas('areas').find(a => a.id === id); },
  historico(ocId) { return linhas('ocorrencias_historico').filter(h => h.ocorrenciaId === ocId).sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm))); },
  // registra a ocorrência e a primeira linha do histórico
  novaOcorrencia(dados, textoHist) {
    const o = this.push('ocorrencias', Object.assign({ status: 'aberta', prioridade: 'media' }, dados));
    this.push('ocorrencias_historico', { ocorrenciaId: o.id, posto: o.posto, texto: textoHist || 'Registrada', autor: dados.autor || null });
    return o;
  },
  // muda status / prioridade / responsável e anota no histórico
  tratarOcorrencia(o, patch, texto, autor) {
    if (patch && Object.keys(patch).length) {
      if (patch.status === 'resolvida') patch.resolvidaEm = new Date().toISOString();
      if (patch.status && patch.status !== 'resolvida') patch.resolvidaEm = null;
      this.update('ocorrencias', o.id, patch);
    }
    this.push('ocorrencias_historico', { ocorrenciaId: o.id, posto: o.posto, texto, autor: autor || null, status: (patch && patch.status) || null });
  }
});

// local cadastrado mais perto de um ponto tocado na planta (x, y em % da imagem)
function localMaisProximo(postoId, x, y, proporcao) {
  const k = proporcao || 1; let melhor = null, dist = Infinity;
  DB.areas(postoId).forEach(a => {
    if (a.x == null || a.y == null) return;
    const d = Math.hypot(x - a.x, (y - a.y) * k);
    if (d < dist) { dist = d; melhor = a; }
  });
  return dist <= (melhor && melhor.tipo === 'torre' ? 12 : 9) ? melhor : null;
}

// =====================================================================
//  PLANTA — imagem do condomínio com pinos (app do posto e painel)
// =====================================================================
const Planta = {
  _urls: {}, _mem: {},  // _mem: zoom, rolagem e foco por elemento (sobrevive ao redesenho da tela)
  _css: `
.planta{position:relative;border:1px solid #2e2e2e;border-radius:12px;background:#111;overflow:auto;max-height:62vh;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y}
.planta.alta{max-height:72vh}
.planta-in{position:relative;width:100%;margin:0 auto;line-height:0}
.planta-in img{width:100%;display:block;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.planta.marcar .planta-in{cursor:crosshair}
.planta-msg{padding:28px 16px;text-align:center;color:#888;font-size:13px;line-height:1.5}
.pino{position:absolute;width:30px;height:40px;transform:translate(-50%,-100%);border:0;background:none;padding:0;cursor:pointer;z-index:2;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
.pino svg{width:100%;height:100%;display:block}
.pino.pisca{animation:pinoPisca 1s infinite}
.pino.novo{z-index:3}
.pino.novo::after{content:'';position:absolute;left:50%;bottom:-6px;width:22px;height:22px;margin-left:-11px;border-radius:50%;border:2px solid #D4AF37;animation:pinoOnda 1.4s infinite}
.pino-area{position:absolute;width:12px;height:12px;border-radius:50%;transform:translate(-50%,-50%);background:#D4AF37;border:2px solid #111;z-index:1;cursor:pointer;padding:0}
.pino-area.torre{width:16px;height:16px;background:#F5F5F0}
.pino-area.sel{box-shadow:0 0 0 4px rgba(212,175,55,.5)}
.pino-area span{position:absolute;left:14px;top:-4px;white-space:nowrap;font-size:11px;font-weight:700;color:#F5F5F0;background:rgba(0,0,0,.7);padding:1px 5px;border-radius:5px;line-height:1.5;pointer-events:none}
.planta-box{position:relative}
.planta-zoom{position:absolute;top:8px;right:8px;z-index:5;display:flex;flex-direction:column;gap:6px;line-height:1}
.planta-zoom button{width:36px;height:36px;border-radius:9px;border:1px solid #B8860B;background:rgba(13,13,13,.9);color:#D4AF37;font-size:20px;font-weight:700;cursor:pointer}
@keyframes pinoPisca{50%{opacity:.25}}
@keyframes pinoOnda{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.8);opacity:0}}`,
  _estilo() { if (this._ok) return; this._ok = true; const st = document.createElement('style'); st.textContent = this._css; document.head.appendChild(st); },
  pinoSvg(cor) { return '<svg viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="' + cor + '" stroke="#111" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#111"/></svg>'; },

  // imagem da planta: baixa do Storage e guarda no aparelho (funciona sem internet depois)
  async url(mapa) {
    if (!mapa || !mapa.plantaPath) return null;
    const path = mapa.plantaPath;
    if (this._urls[path]) return this._urls[path];
    const chave = 'https://planta.cs.local/' + encodeURIComponent(path);
    let cache = null; try { cache = await caches.open('cs-plantas'); } catch (e) {}
    if (cache) { try { const r = await cache.match(chave); if (r) return this._urls[path] = URL.createObjectURL(await r.blob()); } catch (e) {} }
    if (!navigator.onLine) return null;
    const assinada = await Nuvem.urlFoto(path); if (!assinada) return null;
    try {
      const r = await fetch(assinada); if (!r.ok) return assinada;
      const blob = await r.blob();
      if (cache) { try { await cache.put(chave, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } })); } catch (e) {} }
      return this._urls[path] = URL.createObjectURL(blob);
    } catch (e) { return assinada; }
  },

  // el: elemento; o: { postoId, pinos:[{id,x,y,cor,pisca,titulo,novo}], areas:true|false, areaSel, aoTocar(x,y,prop), aoPino(id), aoArea(id), alta, foco:{x,y} }
  async montar(el, o) {
    this._estilo();
    const mapa = DB.mapa(o.postoId);
    if (!mapa || !mapa.plantaPath) { el.innerHTML = '<div class="planta"><div class="planta-msg">Este condomínio ainda não tem planta cadastrada.' + (o.semPlantaMsg ? '<br>' + o.semPlantaMsg : '') + '</div></div>'; return false; }
    const mem = this._mem[el.id || '_'] || (this._mem[el.id || '_'] = {}), z = mem.zoom || 1, rolagem = mem.rol || null;
    // planta comprida (ex.: Flex) não estica na tela larga: largura base de até 520px
    const alongada = mapa.largura && mapa.altura && mapa.altura / mapa.largura > 1.3, maxL = zz => alongada ? (520 * zz) + 'px' : 'none';
    el.innerHTML = '<div class="planta-box"><div class="planta-zoom"><button type="button" data-z="1" aria-label="Aproximar">+</button><button type="button" data-z="-1" aria-label="Afastar">−</button></div><div class="planta' + (o.alta ? ' alta' : '') + (o.aoTocar ? ' marcar' : '') + '"' + (o.maxAltura ? ' style="max-height:' + o.maxAltura + '"' : '') + '><div class="planta-in" style="width:' + (z * 100) + '%;max-width:' + maxL(z) + '"><div class="planta-msg">Carregando a planta...</div></div></div></div>';
    const caixa = el.querySelector('.planta'), dentro = caixa.querySelector('.planta-in');
    const url = await this.url(mapa);
    if (!url) { dentro.innerHTML = '<div class="planta-msg">A planta abre quando houver internet pela primeira vez neste aparelho.</div>'; return false; }
    const img = new Image(); img.alt = 'Planta do condomínio'; img.draggable = false;
    const prop = () => (img.naturalHeight || mapa.altura || 1) / (img.naturalWidth || mapa.largura || 1);
    img.onload = () => {
      const chave = o.foco ? o.foco.x + ',' + o.foco.y : null;
      if (chave && mem.focou !== chave) { mem.focou = chave; const r = dentro.getBoundingClientRect(); caixa.scrollTop = Math.max(0, r.height * o.foco.y / 100 - caixa.clientHeight / 2); caixa.scrollLeft = Math.max(0, r.width * o.foco.x / 100 - caixa.clientWidth / 2); }
      else if (rolagem) { caixa.scrollLeft = rolagem[0]; caixa.scrollTop = rolagem[1]; }
    };
    img.src = url;
    let h = '';
    if (o.areas) DB.areas(o.postoId).filter(a => a.x != null).forEach(a => {
      h += '<button type="button" class="pino-area' + (a.tipo === 'torre' ? ' torre' : '') + (o.areaSel === a.id ? ' sel' : '') + '" data-area="' + a.id + '" style="left:' + a.x + '%;top:' + a.y + '%" title="' + esc(a.nome) + '">' + (o.rotulos ? '<span>' + esc(a.nome) + '</span>' : '') + '</button>';
    });
    (o.pinos || []).forEach(p => {
      if (p.x == null || p.y == null) return;
      h += '<button type="button" class="pino' + (p.pisca ? ' pisca' : '') + (p.novo ? ' novo' : '') + '" data-pino="' + (p.id || '') + '" style="left:' + p.x + '%;top:' + p.y + '%" title="' + esc(p.titulo || '') + '" aria-label="' + esc(p.titulo || 'Local marcado') + '">' + this.pinoSvg(p.cor || '#D4AF37') + '</button>';
    });
    dentro.innerHTML = ''; dentro.appendChild(img); dentro.insertAdjacentHTML('beforeend', h);
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = ev => {
      ev.stopPropagation(); const zs = [1, 1.6, 2.4, 3.5]; const i = Math.max(0, Math.min(zs.length - 1, zs.indexOf(mem.zoom || 1) + +b.dataset.z));
      const cx = (caixa.scrollLeft + caixa.clientWidth / 2) / dentro.offsetWidth, cy = (caixa.scrollTop + caixa.clientHeight / 2) / dentro.offsetHeight;
      mem.zoom = zs[i]; dentro.style.width = (zs[i] * 100) + '%'; dentro.style.maxWidth = maxL(zs[i]);
      caixa.scrollLeft = cx * dentro.offsetWidth - caixa.clientWidth / 2; caixa.scrollTop = cy * dentro.offsetHeight - caixa.clientHeight / 2;
    });
    caixa.onscroll = () => { mem.rol = [caixa.scrollLeft, caixa.scrollTop]; };
    dentro.onclick = ev => {
      const pino = ev.target.closest('[data-pino]'); if (pino && pino.dataset.pino && o.aoPino) { o.aoPino(pino.dataset.pino); return; }
      const ar = ev.target.closest('[data-area]'); if (ar && o.aoArea) { o.aoArea(ar.dataset.area); return; }
      if (!o.aoTocar) return;
      const r = img.getBoundingClientRect(); if (!r.width) return;
      const x = Math.round(Math.min(100, Math.max(0, (ev.clientX - r.left) / r.width * 100)) * 100) / 100;
      const y = Math.round(Math.min(100, Math.max(0, (ev.clientY - r.top) / r.height * 100)) * 100) / 100;
      o.aoTocar(x, y, prop());
    };
    return true;
  }
};

// Lê largura e altura de uma imagem
function dimensoesImagem(blob) {
  return new Promise(ok => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { ok({ largura: i.naturalWidth, altura: i.naturalHeight }); URL.revokeObjectURL(u); }; i.onerror = () => ok({}); i.src = u; });
}
