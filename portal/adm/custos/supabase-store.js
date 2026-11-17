/* =====================================================================
   C&S · Custos Gerais — camada de dados no Supabase
   Substitui o Apps Script mantendo o mesmo formato de dados que a tela usa
   (ID, Posto, Cliente, Empresa...). A tela não precisa saber que mudou.
   ===================================================================== */
(function () {
  'use strict';
  const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const mes = d => (d ? String(d).slice(0, 7) : '');
  const dia = d => (d ? String(d).slice(0, 10) : '');
  const vazio = v => (v === '' || v === undefined ? null : v);
  const num = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const slug = s => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || ('posto-' + Date.now());

  let sb = null, cache = { postos: [], empresas: [] };
  // a tela usa números como ID de cliente e colaborador; aqui guardamos o ID real de cada um
  let numPosto = [], numColab = [];
  const realPosto = n => numPosto[Number(n)] || n;
  const realColab = n => numColab[Number(n)] || n;

  const empresaNome = id => (cache.empresas.find(e => e.id === id) || {}).nome || 'GERAL';
  function empresaId(nome) {
    const n = norm(nome);
    if (!n || n === 'GERAL') return null;
    if (n === 'COSTA') return 'costa';
    const e = cache.empresas.find(e => norm(e.nome) === n || norm(e.id) === n);
    return e ? e.id : null;
  }
  const postoNome = id => (id ? ((cache.postos.find(p => p.id === id) || {}).nome || id) : 'GERAL');
  function postoId(nome) {
    const n = norm(nome);
    if (!n || n === 'GERAL') return null;
    const p = cache.postos.find(p => norm(p.nome) === n || norm(p.id) === n || (p.apelidos || []).some(a => norm(a) === n));
    return p ? p.id : null;
  }
  async function ok(q) { const r = await q; if (r.error) throw new Error(traduz(r.error)); return r.data; }
  function traduz(e) {
    const m = String(e.message || e);
    if (/row-level security|permission denied/i.test(m)) return 'Seu usuário não tem permissão para esta alteração.';
    if (/JWT|expired/i.test(m)) return 'Sua sessão expirou. Recarregue a página e entre de novo.';
    return m;
  }

  /* ----------- leitura: monta o mesmo objeto que o Apps Script devolvia ----------- */
  async function carregar() {
    const [postos, empresas, listas, config, lanc, free, fts, base, colab] = await Promise.all([
      ok(sb.from('postos').select('id,nome,apelidos,ativo,obs,tipo,criado_em').order('criado_em').order('id')),
      ok(sb.from('empresas').select('id,nome').order('id')),
      ok(sb.from('listas').select('campo,valor,ordem,ativo').eq('modulo', 'adm').order('ordem')),
      ok(sb.from('config').select('chave,valor').eq('modulo', 'adm')),
      ok(sb.from('adm_lancamentos').select('*').is('cancelado_em', null).order('id')),
      ok(sb.from('adm_freelances').select('*').is('cancelado_em', null).order('id')),
      ok(sb.from('adm_fts').select('*').is('cancelado_em', null).order('id')),
      ok(sb.from('adm_baseline').select('*')),
      ok(sb.from('colaboradores').select('id,posto_id,nome,funcao,admissao,status,ativo,criado_em').neq('status', 'desligado').order('criado_em').order('id'))
    ]);
    cache = { postos, empresas };
    numPosto = [null].concat(postos.map(p => p.id));
    numColab = [null].concat(colab.map(c => c.id));
    // salários: só quem tem permissão (RH, Diretoria, Admin) recebe linhas
    let rem = [];
    try { rem = await ok(sb.from('rh_remuneracao').select('colaborador_id,salario_base,vt_mes,vr_mes,va_mes')); } catch (e) { rem = []; }
    const remDe = Object.fromEntries(rem.map(r => [r.colaborador_id, r]));

    const cadastros = { TipoCusto: [], Categoria: [], Empresa: [], Status: [], Setor: [] };
    listas.filter(l => l.ativo).forEach(l => { (cadastros[l.campo] = cadastros[l.campo] || []).push(l.valor); });
    if (!cadastros.Empresa.length) cadastros.Empresa = empresas.map(e => e.nome).concat('GERAL');

    const cfg = {};
    config.forEach(c => { cfg[c.chave] = typeof c.valor === 'string' ? c.valor : (c.valor == null ? '' : String(c.valor)); });
    cfg.MIGRACAO_V2 = 'OK';

    const hoje = new Date();
    return {
      ok: true, versao: 3, hoje: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
      config: cfg, cadastros,
      clientes: postos.map((p, i) => ({ ID: i + 1, Posto: p.nome, Ativo: p.ativo ? 'SIM' : 'NÃO', Observacao: p.obs || '' })),
      colaboradores: colab.map((c, i) => {
        const r = remDe[c.id] || {};
        return { ID: i + 1, Posto: postoNome(c.posto_id), Nome: c.nome, Cargo: c.funcao, Admissao: dia(c.admissao),
                 Salario: num(r.salario_base), VT: num(r.vt_mes), VR: num(r.vr_mes), VA: num(r.va_mes) };
      }),
      lancamentos: lanc.map(r => ({
        ID: r.id, Competencia: mes(r.competencia), DataLanc: dia(r.data_lanc), Fornecedor: r.fornecedor || '', Descricao: r.descricao || '',
        TipoCusto: r.tipo_custo || '', Categoria: r.categoria || '', Empresa: empresaNome(r.empresa_id), Cliente: postoNome(r.posto_id),
        Valor: num(r.valor), Vencimento: dia(r.vencimento), Status: r.status, DataPagamento: dia(r.data_pagamento), Origem: r.origem || ''
      })),
      freelances: free.map(r => ({
        ID: r.id, Competencia: mes(r.competencia), Nome: r.nome, DataCobertura: dia(r.data_cobertura), Diarias: num(r.diarias),
        Setor: r.setor || '', Valor: num(r.valor), Posto: postoNome(r.posto_id), Status: r.status, DataPagamento: dia(r.data_pagamento),
        Empresa: r.empresa_id ? empresaNome(r.empresa_id) : ''
      })),
      fts: fts.map(r => ({
        ID: r.id, Competencia: mes(r.competencia), Nome: r.nome, DataCobertura: dia(r.data_cobertura), DataPagamento: dia(r.data_pagamento),
        Setor: r.setor || '', Valor: num(r.valor), Posto: postoNome(r.posto_id), Status: r.status,
        Empresa: r.empresa_id ? empresaNome(r.empresa_id) : ''
      })),
      baseline: base.map(b => ({ Mes: mes(b.mes), Categoria: b.categoria, Valor: num(b.valor) }))
    };
  }

  /* ----------- escrita: converte do formato da tela para as tabelas ----------- */
  const TAB = { lancamento: 'adm_lancamentos', freelance: 'adm_freelances', ft: 'adm_fts' };
  function paraLinha(entity, d) {
    const o = {};
    const set = (k, v) => { if (v !== undefined) o[k] = v; };
    if (entity === 'lancamento') {
      set('data_lanc', 'DataLanc' in d ? vazio(dia(d.DataLanc)) : undefined);
      set('fornecedor', d.Fornecedor); set('descricao', d.Descricao); set('tipo_custo', d.TipoCusto); set('categoria', d.Categoria);
      if ('Empresa' in d) o.empresa_id = empresaId(d.Empresa);
      if ('Cliente' in d) o.posto_id = postoId(d.Cliente);
      if ('Valor' in d) o.valor = num(d.Valor);
      if ('Vencimento' in d) o.vencimento = vazio(dia(d.Vencimento));
      set('status', d.Status);
      if ('DataPagamento' in d) o.data_pagamento = vazio(dia(d.DataPagamento));
      if ('Competencia' in d && !o.vencimento && !d.Vencimento) o.competencia = (d.Competencia || '').slice(0, 7) + '-01';
      if (!('competencia' in o)) o.competencia = new Date().toISOString().slice(0, 8) + '01'; // recalculada pelo banco
    } else if (entity === 'freelance' || entity === 'ft') {
      set('nome', d.Nome);
      if ('DataCobertura' in d) o.data_cobertura = vazio(dia(d.DataCobertura));
      if ('DataPagamento' in d) o.data_pagamento = vazio(dia(d.DataPagamento));
      if (entity === 'freelance' && 'Diarias' in d) o.diarias = num(d.Diarias) || 1;
      set('setor', d.Setor);
      if ('Valor' in d) o.valor = num(d.Valor);
      if ('Posto' in d) o.posto_id = postoId(d.Posto);
      set('status', d.Status);
      if ('Empresa' in d) o.empresa_id = empresaId(d.Empresa);
      o.competencia = ((d.Competencia || new Date().toISOString()).slice(0, 7)) + '-01';  // recalculada pelo banco
    }
    return o;
  }

  async function add(entity, data) {
    if (TAB[entity]) {
      const r = await ok(sb.from(TAB[entity]).insert(paraLinha(entity, data)).select('id').single());
      return { ID: r.id };
    }
    if (entity === 'cliente') {
      const nome = String(data.Posto || '').trim();
      if (postoId(nome)) throw new Error('Já existe um posto com esse nome.');
      let id = slug(nome); if (cache.postos.some(p => p.id === id)) id += '-' + Date.now().toString(36);
      await ok(sb.from('postos').insert({ id, nome, tipo: 'cliente', ativo: !/^N/i.test(String(data.Ativo || 'SIM')), obs: data.Observacao || null }));
      return { ID: id };
    }
    if (entity === 'colaborador') {
      const id = 'cs-' + Date.now().toString(36);
      const pid = postoId(data.Posto);
      if (!pid) throw new Error('Escolha um posto cadastrado para o colaborador.');
      await ok(sb.from('colaboradores').insert({ id, posto_id: pid, nome: String(data.Nome || '').trim(), funcao: data.Cargo || 'A definir',
                                                 admissao: vazio(dia(data.Admissao)), status: 'ativo' }));
      await ok(sb.from('rh_remuneracao').insert({ colaborador_id: id, salario_base: num(data.Salario), vt_mes: num(data.VT), vr_mes: num(data.VR), va_mes: num(data.VA) }));
      return { ID: id };
    }
    throw new Error('Tipo de registro desconhecido: ' + entity);
  }

  async function update(entity, id, data) {
    if (entity === 'cliente') id = realPosto(id);
    if (entity === 'colaborador') id = realColab(id);
    if (TAB[entity]) {
      const linha = paraLinha(entity, data);
      if (!('Competencia' in data)) delete linha.competencia;
      await ok(sb.from(TAB[entity]).update(linha).eq('id', id).select('id'));
      return { ID: id };
    }
    if (entity === 'cliente') {
      const o = {};
      if ('Ativo' in data) o.ativo = !/^N/i.test(String(data.Ativo));
      if ('Observacao' in data) o.obs = data.Observacao || null;
      if ('Posto' in data) o.nome = String(data.Posto).trim();
      await ok(sb.from('postos').update(o).eq('id', id).select('id'));
      return { ID: id };
    }
    if (entity === 'colaborador') {
      const c = {}, r = {};
      if ('Nome' in data) c.nome = String(data.Nome).trim();
      if ('Cargo' in data) c.funcao = data.Cargo || 'A definir';
      if ('Admissao' in data) c.admissao = vazio(dia(data.Admissao));
      if ('Posto' in data) { const pid = postoId(data.Posto); if (pid) c.posto_id = pid; }
      if ('Salario' in data) r.salario_base = num(data.Salario);
      if ('VT' in data) r.vt_mes = num(data.VT);
      if ('VR' in data) r.vr_mes = num(data.VR);
      if ('VA' in data) r.va_mes = num(data.VA);
      if (Object.keys(c).length) await ok(sb.from('colaboradores').update(c).eq('id', id).select('id'));
      if (Object.keys(r).length) await ok(sb.from('rh_remuneracao').upsert({ colaborador_id: id, ...r }).select('colaborador_id'));
      return { ID: id };
    }
    throw new Error('Tipo de registro desconhecido: ' + entity);
  }

  // Excluir não apaga: marca como cancelado (fica no histórico com quem e quando)
  async function del(entity, id) {
    if (entity === 'cliente') id = realPosto(id);
    if (entity === 'colaborador') id = realColab(id);
    const quem = (window.CSAuth && CSAuth.usuario && CSAuth.usuario.id) || null;
    if (TAB[entity]) {
      await ok(sb.from(TAB[entity]).update({ cancelado_em: new Date().toISOString(), cancelado_por: quem }).eq('id', id).select('id'));
      return true;
    }
    if (entity === 'colaborador') {
      await ok(sb.from('colaboradores').update({ status: 'desligado', ativo: false, demissao: new Date().toISOString().slice(0, 10) }).eq('id', id).select('id'));
      return true;
    }
    if (entity === 'cliente') {
      await ok(sb.from('postos').update({ ativo: false }).eq('id', id).select('id'));
      return true;
    }
    throw new Error('Tipo de registro desconhecido: ' + entity);
  }

  async function setConfig(obj) {
    const linhas = Object.entries(obj).map(([chave, v]) => ({ modulo: 'adm', chave, valor: v == null ? null : String(v), atualizado_em: new Date().toISOString() }));
    await ok(sb.from('config').upsert(linhas).select('chave'));
  }
  async function setList(campo, valores) {
    await ok(sb.from('listas').update({ ativo: false }).eq('modulo', 'adm').eq('campo', campo).select('valor'));
    const linhas = valores.map((valor, ordem) => ({ modulo: 'adm', campo, valor, ordem, ativo: true }));
    if (linhas.length) await ok(sb.from('listas').upsert(linhas).select('valor'));
  }
  async function setBaseline(m, valor) {
    const mesIso = m + '-01';
    await ok(sb.from('adm_baseline').delete().eq('mes', mesIso).select('mes'));
    if (valor !== null) await ok(sb.from('adm_baseline').insert({ mes: mesIso, categoria: 'TOTAL', valor: num(valor) }).select('mes'));
  }
  async function renameCliente(id, nome) {
    id = realPosto(id);
    const p = cache.postos.find(x => x.id === id);
    const apelidos = Array.from(new Set([...(p && p.apelidos) || [], p && p.nome].filter(Boolean)));
    await ok(sb.from('postos').update({ nome: String(nome).trim(), apelidos }).eq('id', id).select('id'));
  }

  window.CSCustosStore = {
    instalar(store, cliente) {
      sb = cliente;
      store.demo = false;
      store.boot = async function () { this.data = await carregar(); this.normalize(); return this.data; };
      const depois = fn => async function (...a) { const r = await fn(...a); await this.boot(); return r; };
      store.add = async function (entity, data) {
        const r = await add(entity, data); await this.boot();
        if (entity === 'cliente' && r) r.ID = numPosto.indexOf(r.ID);
        if (entity === 'colaborador' && r) r.ID = numColab.indexOf(r.ID);
        return r;
      };
      store.update = depois(update); store.del = depois(del);
      store.setConfig = depois(setConfig); store.setList = depois(setList);
      store.setBaseline = depois(setBaseline); store.renameCliente = depois(renameCliente);
    }
  };
})();
