/* =====================================================================
   C&S · Requisição de Uniformes — camada de dados no Supabase
   Responde às mesmas ações que o Apps Script (list, create, status,
   delete, boleto), no mesmo formato, para a tela continuar igual.
   ===================================================================== */
(function () {
  'use strict';
  const BUCKET = 'adm';
  const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const vazio = v => (v === '' || v === undefined ? null : v);
  let sb = null, postos = [];

  async function ok(q) {
    const r = await q;
    if (r.error) {
      const m = String(r.error.message || r.error);
      throw new Error(/row-level security|permission/i.test(m) ? 'Seu usuário não tem permissão para esta ação.' : m);
    }
    return r.data;
  }
  const postoNome = id => (postos.find(p => p.id === id) || {}).nome || '';
  function postoId(txt) {
    const n = norm(txt);
    if (!n) return null;
    const p = postos.find(p => norm(p.nome) === n || norm(p.id) === n || (p.apelidos || []).some(a => norm(a) === n));
    return p ? p.id : null;
  }

  async function carregarPostos() {
    postos = await ok(sb.from('postos').select('id,nome,apelidos,ativo').order('nome'));
    const dl = document.getElementById('postosLista');
    if (dl) dl.innerHTML = postos.filter(p => p.ativo).map(p => `<option value="${p.nome.replace(/"/g, '&quot;')}">`).join('');
  }

  async function list() {
    if (!postos.length) await carregarPostos();
    const reqs = await ok(sb.from('adm_uniforme_requisicoes')
      .select('*, adm_uniforme_itens(*), adm_uniforme_historico(status,em)')
      .is('cancelado_em', null).order('numero', { ascending: false }));
    const caminhos = reqs.map(r => r.boleto_path).filter(Boolean);
    let urls = {};
    if (caminhos.length) {
      const assinadas = await ok(sb.storage.from(BUCKET).createSignedUrls(caminhos, 3600));
      assinadas.forEach(a => { if (a.signedUrl) urls[a.path] = a.signedUrl; });
    }
    return {
      ok: true,
      records: reqs.map(r => ({
        id: r.id, numero: r.numero, data: r.data, tipo: 'uniforme',
        colaborador: { nome: r.colaborador_nome, funcao: r.colaborador_funcao || '', rg: r.colaborador_rg || '', admissao: r.colaborador_admissao },
        posto: r.posto_id ? postoNome(r.posto_id) : (r.posto_texto || ''), setor: r.setor || '',
        itens: (r.adm_uniforme_itens || []).sort((a, b) => a.ordem - b.ordem)
          .map(i => ({ qtde: i.qtde, modelo: i.modelo, cor: i.cor || '', tamanho: i.tamanho || '', bordado: i.bordado || '', obs: i.obs || '' })),
        validade: r.validade || '', pedido: r.pedido || '', status: r.status,
        boleto: (r.boleto_valor != null || r.boleto_vencimento || r.boleto_path)
          ? { vencimento: r.boleto_vencimento, valor: r.boleto_valor, url: r.boleto_path ? (urls[r.boleto_path] || null) : null,
              fileName: r.boleto_path ? r.boleto_path.split('/').pop() : null }
          : null,
        historico: (r.adm_uniforme_historico || []).sort((a, b) => String(a.em).localeCompare(String(b.em))).map(h => ({ status: h.status, at: h.em })),
        createdAt: r.criado_em, updatedAt: r.atualizado_em
      }))
    };
  }

  async function create(rec) {
    if (!postos.length) await carregarPostos();
    const c = rec.colaborador || {};
    const pid = postoId(rec.posto);
    // número gerado no banco; se duas pessoas salvarem juntas, tenta o seguinte
    for (let tent = 0; tent < 3; tent++) {
      const numero = await ok(sb.rpc('adm_proximo_numero_req'));
      const r = await sb.from('adm_uniforme_requisicoes').insert({
        numero, data: vazio(rec.data), colaborador_nome: (c.nome || '').trim(), colaborador_funcao: vazio(c.funcao),
        colaborador_rg: vazio(c.rg), colaborador_admissao: vazio(c.admissao), posto_id: pid, posto_texto: pid ? null : vazio(rec.posto),
        setor: vazio(rec.setor), validade: vazio(rec.validade), pedido: vazio(rec.pedido), status: 'enviado_aprovacao'
      }).select('id').single();
      if (r.error && /duplicate key|unique/i.test(r.error.message) && tent < 2) continue;
      if (r.error) throw new Error(/row-level security/i.test(r.error.message) ? 'Seu usuário não tem permissão para criar requisições.' : r.error.message);
      const itens = (rec.itens || []).map((i, ordem) => ({
        requisicao_id: r.data.id, ordem, qtde: parseInt(i.qtde, 10) || 1, modelo: i.modelo || '-',
        cor: vazio(i.cor), tamanho: vazio(i.tamanho), bordado: vazio(i.bordado), obs: vazio(i.obs)
      }));
      if (itens.length) await ok(sb.from('adm_uniforme_itens').insert(itens));
      await ok(sb.from('adm_uniforme_historico').insert({ requisicao_id: r.data.id, status: 'enviado_aprovacao' }));
      return { ok: true, numero, id: r.data.id };
    }
  }

  async function status(id, st) {
    const d = await ok(sb.from('adm_uniforme_requisicoes').update({ status: st }).eq('id', id).select('id'));
    if (!d.length) throw new Error('Seu usuário não tem permissão para mudar o status.');
    return { ok: true };
  }

  async function del(id) {
    const quem = (window.CSAuth && CSAuth.usuario && CSAuth.usuario.id) || null;
    const d = await ok(sb.from('adm_uniforme_requisicoes').update({ cancelado_em: new Date().toISOString(), cancelado_por: quem }).eq('id', id).select('id'));
    if (!d.length) throw new Error('Seu usuário não tem permissão para excluir.');
    return { ok: true };
  }

  async function boleto(id, b, file) {
    const atual = await ok(sb.from('adm_uniforme_requisicoes').select('numero,boleto_path').eq('id', id).single());
    const o = { boleto_vencimento: vazio(b.vencimento), boleto_valor: b.valor == null || b.valor === '' ? null : Number(b.valor) };
    if (file) {
      const ext = (String(file.name).split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
      const caminho = `uniformes/${atual.numero}/boleto-${Date.now()}.${ext}`;
      const bin = Uint8Array.from(atob(file.b64), ch => ch.charCodeAt(0));
      await ok(sb.storage.from(BUCKET).upload(caminho, new Blob([bin], { type: file.type || 'application/pdf' }), { upsert: false }));
      o.boleto_path = caminho;
    } else if (b.clearFile) {
      o.boleto_path = null;   // o arquivo antigo fica guardado na pasta, só deixa de estar ligado
    }
    const d = await ok(sb.from('adm_uniforme_requisicoes').update(o).eq('id', id).select('id'));
    if (!d.length) throw new Error('Seu usuário não tem permissão para lançar boleto.');
    return { ok: true };
  }

  window.CSUniformesApi = {
    instalar(cliente) { sb = cliente; return carregarPostos(); },
    async get() { return list(); },
    async post(p) {
      switch (p.action) {
        case 'create': return create(p.record);
        case 'status': return status(p.id, p.status);
        case 'delete': return del(p.id);
        case 'boleto': return boleto(p.id, p.boleto, p.file);
        default: throw new Error('Ação desconhecida: ' + p.action);
      }
    }
  };
})();
