/* =====================================================================
   C&S · Gestão de Projetos (módulo pm_)
   As regras (cascata em dias úteis, SLA, permissões, fluxo de status)
   ficam no banco. Esta tela só lê as views, chama as RPCs e mostra as
   mensagens que o banco devolve.
   ===================================================================== */
'use strict';
let sb = null, EU = null, PAPEL = 'sem_acesso';
const S = { pessoas: [], pmap: {}, feriados: [], ferSet: new Set(), sla: [], proj: null, ondas: [], tarefas: [], deps: [], reprog: [],
  aba: 'painel', filtro: { minhas: false, atrasadas: false, resp: '', area: '', status: '', q: '' }, zoom: 'semana', notifs: [], gaveta: null };

/* ---------------------------------------------------------- utilidades */
const $ = id => document.getElementById(id);
const esc = s => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STATUS = { nao_iniciado: 'Não iniciado', em_andamento: 'Em andamento', bloqueado: 'Bloqueado', em_validacao: 'Em validação', concluido: 'Concluído', nao_se_aplica: 'Não se aplica', cancelado: 'Cancelado' };
const PRIO = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const PSTATUS = { planejamento: 'Planejamento', em_execucao: 'Em execução', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Cancelado' };
const SAUDE = { vermelho: 'Atrasada / fora do SLA', amarelo: 'Atenção', verde: 'No prazo', concluida: 'Concluída', na: 'Não se aplica' };
const FECHADOS = ['concluido', 'nao_se_aplica', 'cancelado'];
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const pD = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fd = s => { const d = pD(s); return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : '—'; };
const fdy = s => { const d = pD(s); return d ? fd(s) + '/' + d.getFullYear() : '—'; };
const fdt = s => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const ehUtil = d => d.getDay() > 0 && d.getDay() < 6 && !S.ferSet.has(iso(d));
const proxUtil = d => { let x = new Date(d); while (!ehUtil(x)) x = addD(x, 1); return x; };
const pill = st => `<span class="pill s-${st}">${STATUS[st] || st}</span>`;
const prio = p => `<span class="pr p-${p}">${PRIO[p] || p}</span>`;
const dotS = s => `<span class="dot h-${s}" title="${esc(SAUDE[s] || '')}"></span>`;
const nomeP = id => (S.pmap[id] && S.pmap[id].nome) || (id ? 'Usuário' : '—');
function av(id, tam) {
  const p = S.pmap[id]; const z = tam ? `style="width:${tam}px;height:${tam}px;font-size:${Math.round(tam / 2.4)}px"` : '';
  if (!id) return `<span class="av v" ${z} title="Sem responsável">?</span>`;
  if (p && p.foto_url) return `<span class="av" ${z} title="${esc(p.nome)}"><img src="${esc(p.foto_url)}" alt=""></span>`;
  const ini = (p ? p.nome : '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="av" ${z} title="${esc(p ? p.nome : '')}">${esc(ini)}</span>`;
}
function toast(m, err) { const t = $('toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', err ? 6500 : 3200); }
function msgErro(e) {
  let m = (e && (e.message || e.error_description || e.details)) || String(e || 'Erro');
  if (/row-level security|permission denied|violates row-level/i.test(m)) m = 'Você não tem permissão para esta ação.';
  if (/Failed to fetch|NetworkError/i.test(m)) m = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return m;
}
const falha = e => { console.error(e); toast(msgErro(e), true); };
async function q(p) { const r = await p; if (r.error) throw r.error; return r.data; }
const rpc = (fn, args) => q(sb.rpc(fn, args || {}));
const podeGerir = p => p && (PAPEL === 'admin' || PAPEL === 'diretoria' || p.gestor_id === EU.id);
const ehResp = t => t && t.responsavel_id === EU.id;
function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--val)">$1</a>'); }

/* modal genérico */
function modal(titulo, corpo, botoes, opts) {
  opts = opts || {};
  const o = document.createElement('div'); o.className = 'ovl';
  o.innerHTML = `<div class="mdl ${opts.larga ? 'larga' : ''}"><button class="x" data-x>&times;</button><h2>${titulo}</h2><div class="mb">${corpo}</div><div class="rod"></div></div>`;
  const rod = o.querySelector('.rod');
  (botoes || []).forEach(b => { const e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.t; e.onclick = () => b.fn(o, e); rod.appendChild(e); });
  const fechar = () => { o.remove(); if (opts.aoFechar) opts.aoFechar(); };
  o.querySelector('[data-x]').onclick = fechar; o.addEventListener('mousedown', e => { if (e.target === o) fechar(); });
  o.fechar = fechar; document.body.appendChild(o); return o;
}
function perguntar(titulo, texto, label, obrig, botao) {
  return new Promise(res => {
    const m = modal(titulo, `<p class="small" style="line-height:1.5;margin-bottom:10px">${texto || ''}</p>${label ? `<div class="fld"><label>${label}</label><textarea id="pg-tx" rows="3"></textarea></div>` : ''}`,
      [{ t: 'Cancelar', fn: o => { o.remove(); res(null); } },
       { t: botao || 'Confirmar', cls: 'btn-gold', fn: o => { const v = label ? o.querySelector('#pg-tx').value.trim() : true; if (label && obrig && !v) return toast('Preencha o campo para continuar.', true); o.remove(); res(v); } }],
      { aoFechar: () => res(null) });
    const tx = m.querySelector('#pg-tx'); if (tx) tx.focus();
  });
}

/* ---------------------------------------------------------- início */
CSAuth.iniciar({ sistema: 'a Gestão de Projetos', papeis: [] }).then(async r => {
  sb = r.sb; EU = r.usuario;
  try {
    PAPEL = await rpc('pm_papel');
    if (PAPEL === 'sem_acesso') { $('main').innerHTML = `<div class="card vazio" style="max-width:560px;margin:40px auto"><h1 class="t" style="margin-bottom:8px">Sem acesso ao módulo</h1>Seu usuário ainda não participa da Gestão de Projetos. Peça ao administrador do portal para liberar em Configurações &gt; Acessos.</div>`; return; }
    $('nav-config').hidden = !(PAPEL === 'admin' || PAPEL === 'diretoria');
    const [pes, fer, sla] = await Promise.all([rpc('pm_pessoas'), q(sb.from('pm_feriados').select('*').order('data')), q(sb.from('pm_sla_regras').select('*'))]);
    S.pessoas = pes || []; S.pessoas.forEach(p => S.pmap[p.id] = p);
    S.feriados = fer || []; S.ferSet = new Set(S.feriados.filter(f => f.considerar).map(f => f.data)); S.sla = sla || [];
    $('sino').onclick = abrirNotifs; carregarNotifs(); setInterval(carregarNotifs, 90000);
    addEventListener('hashchange', rota); rota();
  } catch (e) { falha(e); $('main').innerHTML = `<div class="vazio">${esc(msgErro(e))}</div>`; }
}).catch(() => {});

/* ---------------------------------------------------------- rotas
   #/                      lista de projetos
   #/p/<id>/<aba>[/t/<id>] projeto (painel, tabela, kanban, gantt, reprog)
   #/minhas                minhas tarefas
   #/config[/<aba>]        configurações                                   */
async function rota() {
  const h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.n === (h[0] === 'minhas' ? 'minhas' : h[0] === 'config' ? 'config' : 'proj')));
  fecharGaveta(true);
  try {
    S.tela = h[0] === 'p' ? 'projeto' : h[0] === 'minhas' ? 'minhas' : h[0] === 'config' ? 'config' : 'lista';
    if (h[0] === 'p' && h[1]) {
      S.aba = h[2] || 'painel';
      if (!S.proj || S.proj.id !== h[1]) { $('main').innerHTML = '<div class="spin"></div>'; await carregarProjeto(h[1]); }
      else if (Date.now() - (S.carregadoEm || 0) > 1500) await carregarProjeto(h[1]);   // sempre fresco: outra pessoa pode ter mexido
      telaProjeto();
      if (h[3] === 't' && h[4]) abrirTarefa(h[4]);
    } else if (h[0] === 'minhas') { await telaMinhas(); if (h[1] === 't' && h[2]) abrirTarefa(h[2]); }
    else if (h[0] === 'config') await telaConfig(h[1] || 'feriados');
    else await telaLista();
  } catch (e) { falha(e); }
}
const irPara = h => { if (location.hash === h) rota(); else location.hash = h; };

/* ---------------------------------------------------------- dados */
async function carregarProjeto(id) {
  const [p, ondas, tar] = await Promise.all([
    q(sb.from('pm_vw_projetos').select('*').eq('id', id).maybeSingle()),
    q(sb.from('pm_vw_ondas').select('*').eq('projeto_id', id).order('ordem')),
    q(sb.from('pm_vw_tarefas').select('*').eq('projeto_id', id).order('codigo'))]);
  if (!p) throw new Error('Projeto não encontrado.');
  S.proj = p; S.ondas = ondas || []; S.tarefas = tar || []; S.carregadoEm = Date.now();
  const ids = S.tarefas.map(t => t.id);
  if (ids.length) {
    const [deps, rep] = await Promise.all([q(sb.from('pm_dependencias').select('*').in('tarefa_id', ids)), q(sb.from('pm_reprogramacoes').select('*').in('tarefa_id', ids).order('criado_em', { ascending: false }))]);
    S.deps = deps || []; S.reprog = rep || [];
  } else { S.deps = []; S.reprog = []; }
}
async function recarregar() {
  const g = S.gaveta;
  if (S.tela === 'minhas') { await telaMinhas(); }
  else { if (!S.proj) return; await carregarProjeto(S.proj.id); telaProjeto(); }
  if (g) abrirTarefa(g, true);
}
const tPorId = id => S.tarefas.find(t => t.id === id);
const tPorCod = c => S.tarefas.find(t => t.codigo === c);
const ondaDe = t => S.ondas.find(o => o.onda_id === t.onda_id) || {};

/* ---------------------------------------------------------- notificações */
async function carregarNotifs() {
  try {
    S.notifs = await q(sb.from('pm_notificacoes').select('*').order('criado_em', { ascending: false }).limit(40));
    const n = S.notifs.filter(x => !x.lida).length; const e = $('sino-q'); e.hidden = !n; e.textContent = n > 9 ? '9+' : n;
  } catch (e) {}
}
function abrirNotifs(ev) {
  ev.stopPropagation(); const ja = document.querySelector('.notifs'); if (ja) { ja.remove(); return; }
  const d = document.createElement('div'); d.className = 'notifs';
  const ic = { critico: '🔴', alerta: '🟡', info: '🔵' };
  d.innerHTML = `<div class="hd"><b>Notificações</b><button class="btn btn-sm" id="nt-lidas">Marcar como lidas</button></div><div class="lst">${S.notifs.length ? S.notifs.map(n => `<div class="it ${n.lida ? '' : 'un'}" data-n="${n.id}" data-p="${n.projeto_id || ''}" data-t="${n.tarefa_id || ''}"><span>${ic[n.nivel] || '•'}</span><div><div>${esc(n.mensagem)}</div><div class="tiny muted">${fdt(n.criado_em)}</div></div></div>`).join('') : '<div class="vazio">Nenhuma notificação.</div>'}</div>`;
  document.body.appendChild(d);
  const fora = e => { if (!d.contains(e.target)) { d.remove(); removeEventListener('mousedown', fora); } }; addEventListener('mousedown', fora);
  d.querySelector('#nt-lidas').onclick = async () => { try { await q(sb.from('pm_notificacoes').update({ lida: true }).eq('usuario_id', EU.id).eq('lida', false)); await carregarNotifs(); d.remove(); } catch (e) { falha(e); } };
  d.querySelector('.lst').onclick = async e => {
    const it = e.target.closest('[data-n]'); if (!it) return; d.remove();
    sb.from('pm_notificacoes').update({ lida: true }).eq('id', it.dataset.n).then(carregarNotifs);
    if (it.dataset.p) irPara(`#/p/${it.dataset.p}/tabela${it.dataset.t ? '/t/' + it.dataset.t : ''}`);
  };
}

/* ========================================================== LISTA DE PROJETOS */
async function telaLista() {
  S.proj = null;
  const projs = await q(sb.from('pm_vw_projetos').select('*').eq('eh_modelo', false).order('criado_em', { ascending: false }));
  const f = S.filtroLista || (S.filtroLista = { area: '', status: '', gestor: '' });
  const areas = [...new Set(projs.map(p => p.area).filter(Boolean))].sort();
  const gestores = [...new Set(projs.map(p => p.gestor_id).filter(Boolean))];
  const lst = projs.filter(p => (!f.area || p.area === f.area) && (!f.status || p.status === f.status) && (!f.gestor || p.gestor_id === f.gestor));
  const cria = PAPEL === 'admin' || PAPEL === 'diretoria';
  $('main').innerHTML = `
  <div class="ph"><div><h1 class="t">Projetos</h1><div class="sub">Projetos da C&amp;S em ondas, com prazos em dias úteis, SLA e evidências.</div></div><span class="grow"></span>
    ${cria ? `<button class="btn" id="bt-modelo">Novo a partir de modelo</button><button class="btn btn-gold" id="bt-novo">+ Novo projeto</button>` : ''}</div>
  <div class="filtros">
    <select id="f-area"><option value="">Todas as áreas</option>${areas.map(a => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    <select id="f-status"><option value="">Todos os status</option>${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="f-gestor"><option value="">Todos os gestores</option>${gestores.map(g => `<option value="${g}" ${f.gestor === g ? 'selected' : ''}>${esc(nomeP(g))}</option>`).join('')}</select>
  </div>
  <div class="projs">${lst.length ? lst.map(cardProjeto).join('') : `<div class="card vazio">Nenhum projeto ${projs.length ? 'com esses filtros' : 'cadastrado ainda'}.</div>`}</div>`;
  ['area', 'status', 'gestor'].forEach(k => $('f-' + k).onchange = e => { f[k] = e.target.value; telaLista(); });
  if (cria) { $('bt-novo').onclick = () => editarProjeto(null); $('bt-modelo').onclick = novoDeModelo; }
}
function cardProjeto(p) {
  const desv = p.fim_baseline && p.fim_previsto && p.fim_previsto > p.fim_baseline;
  return `<a class="pc" href="#/p/${p.id}/painel">
    <div class="hd">${dotS(p.saude)}<div style="flex:1;min-width:0"><div class="nm">${esc(p.nome)}</div><div class="cd">${esc(p.codigo)} · ${esc(p.area || 'Sem área')} · ${PSTATUS[p.status] || p.status}</div></div>${av(p.gestor_id, 28)}</div>
    <div><div class="small" style="display:flex;justify-content:space-between;margin-bottom:4px"><span>${Number(p.pct || 0).toLocaleString('pt-BR')}% concluído</span><span class="muted">${p.concluidas}/${p.total_tarefas} tarefas</span></div><div class="bar"><i style="width:${p.pct || 0}%"></i></div></div>
    <div class="small">Fim previsto <b>${fdy(p.fim_previsto)}</b> ${p.fim_baseline ? `· baseline ${fdy(p.fim_baseline)} ${desv ? '<span class="dp-neg">(atrasou)</span>' : ''}` : ''}</div>
    <div class="kv"><div><b class="${p.atrasadas ? 'dp-neg' : ''}">${p.atrasadas}</b><span>atrasadas</span></div><div><b class="${p.vencem_5du ? 'dp-am' : ''}">${p.vencem_5du}</b><span>vencem em 5 du</span></div><div><b>${p.sem_responsavel}</b><span>sem responsável</span></div></div>
  </a>`;
}
function editarProjeto(p) {
  const pes = S.pessoas.filter(x => x.papel !== 'sem_acesso');
  const m = modal(p ? 'Editar projeto' : 'Novo projeto', `
    <div class="campos">
      <div class="fld"><label>Código</label><input id="pj-cod" value="${esc(p ? p.codigo : '')}" placeholder="Ex.: POSTO-FLEX-2027"></div>
      <div class="fld"><label>Status</label><select id="pj-st">${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}" ${(p ? p.status : 'planejamento') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="fld full"><label>Nome</label><input id="pj-nome" value="${esc(p ? p.nome : '')}"></div>
      <div class="fld full"><label>Descrição</label><textarea id="pj-desc" rows="3">${esc(p ? p.descricao : '')}</textarea></div>
      <div class="fld"><label>Área</label><input id="pj-area" value="${esc(p ? p.area : '')}" placeholder="Ex.: SST / RH"></div>
      <div class="fld"><label>Empresa</label><input id="pj-emp" value="${esc(p ? p.empresa : 'Costa & Sobral + C&S')}"></div>
      <div class="fld"><label>Gestor do projeto</label><select id="pj-gest"><option value="">—</option>${pes.map(x => `<option value="${x.id}" ${(p ? p.gestor_id : EU.id) === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
      ${p ? '' : `<div class="fld"><label>Data de início</label><input type="date" id="pj-ini" value="${hojeISO()}"></div>`}
    </div>${p ? `<p class="tiny muted" style="margin-top:10px">Para mudar a data de início use "Mudar início" no painel: ela desloca as tarefas não iniciadas em dias úteis.</p>` : ''}`,
    [{ t: 'Cancelar', fn: o => o.remove() }, ...(p && PAPEL === 'admin' ? [{ t: 'Excluir projeto', cls: 'btn-err', fn: async o => {
        if (!await perguntar('Excluir projeto', `Isto apaga o projeto <b>${esc(p.nome)}</b> com todas as tarefas, evidências registradas, comentários e histórico. Não dá para desfazer.`, null, false, 'Excluir')) return;
        try { await q(sb.from('pm_projetos').delete().eq('id', p.id)); o.remove(); toast('Projeto excluído.'); S.proj = null; irPara('#/'); } catch (e) { falha(e); } } }] : []),
     { t: 'Salvar', cls: 'btn-gold', fn: async o => {
        const row = { codigo: o.querySelector('#pj-cod').value.trim(), nome: o.querySelector('#pj-nome').value.trim(), descricao: o.querySelector('#pj-desc').value.trim() || null,
          area: o.querySelector('#pj-area').value.trim() || null, empresa: o.querySelector('#pj-emp').value.trim() || null, gestor_id: o.querySelector('#pj-gest').value || null, status: o.querySelector('#pj-st').value };
        if (!row.codigo || !row.nome) return toast('Informe código e nome.', true);
        try {
          if (p) { await q(sb.from('pm_projetos').update(row).eq('id', p.id)); o.remove(); toast('Projeto atualizado.'); await recarregar(); }
          else { row.data_inicio = o.querySelector('#pj-ini').value; const n = await q(sb.from('pm_projetos').insert(row).select().single()); o.remove(); toast('Projeto criado. Agora inclua as ondas e as tarefas.'); irPara(`#/p/${n.id}/painel`); }
        } catch (e) { falha(e); }
      } }]);
}
async function novoDeModelo() {
  const mods = await q(sb.from('pm_projetos').select('id,codigo,nome').eq('eh_modelo', true).order('nome'));
  if (!mods.length) return toast('Ainda não há modelos. Crie em Configurações > Modelos.', true);
  const pes = S.pessoas.filter(x => x.papel !== 'sem_acesso');
  modal('Novo projeto a partir de modelo', `<div class="campos">
    <div class="fld full"><label>Modelo</label><select id="nm-mod">${mods.map(m => `<option value="${m.id}">${esc(m.nome)} (${esc(m.codigo)})</option>`).join('')}</select></div>
    <div class="fld"><label>Código</label><input id="nm-cod"></div><div class="fld"><label>Data de início</label><input type="date" id="nm-ini" value="${hojeISO()}"></div>
    <div class="fld full"><label>Nome</label><input id="nm-nome"></div>
    <div class="fld full"><label>Gestor</label><select id="nm-gest">${pes.map(x => `<option value="${x.id}" ${x.id === EU.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div></div>
    <p class="tiny muted" style="margin-top:10px">As ondas, tarefas e dependências são copiadas e as datas recalculadas a partir do início, em dias úteis.</p>`,
    [{ t: 'Cancelar', fn: o => o.remove() }, { t: 'Criar projeto', cls: 'btn-gold', fn: async o => {
      const a = { p_modelo: o.querySelector('#nm-mod').value, p_codigo: o.querySelector('#nm-cod').value.trim(), p_nome: o.querySelector('#nm-nome').value.trim(), p_data_inicio: o.querySelector('#nm-ini').value, p_gestor: o.querySelector('#nm-gest').value || null };
      if (!a.p_codigo || !a.p_nome || !a.p_data_inicio) return toast('Preencha código, nome e data.', true);
      try { const id = await rpc('pm_criar_de_modelo', a); o.remove(); toast('Projeto criado a partir do modelo.'); irPara(`#/p/${id}/painel`); } catch (e) { falha(e); } } }]);
}

/* ========================================================== PROJETO (abas) */
function telaProjeto() {
  const p = S.proj, g = podeGerir(p);
  const pend = S.reprog.filter(r => r.status === 'pendente').length;
  const abas = [['painel', 'Painel'], ['tabela', 'Tarefas'], ['gantt', 'Cronograma'], ['kanban', 'Kanban'], ['reprog', 'Reprogramações']];
  $('main').innerHTML = `
  <div class="ph"><div><div class="tiny muted" style="letter-spacing:.06em"><a href="#/" style="text-decoration:none">PROJETOS</a> › ${esc(p.codigo)}</div>
    <h1 class="t">${esc(p.nome)}</h1><div class="sub">${esc(p.area || '')}${p.empresa ? ' · ' + esc(p.empresa) : ''} · Gestor: ${esc(nomeP(p.gestor_id))} · ${PSTATUS[p.status] || p.status}</div></div><span class="grow"></span>
    <div class="acoes noprint"><button class="btn" id="bt-xls">Exportar Excel</button>${g ? `<button class="btn" id="bt-edit">Editar projeto</button>` : ''}</div></div>
  <div class="tabs noprint">${abas.map(([k, v]) => `<button class="tab ${S.aba === k ? 'on' : ''}" data-a="${k}">${v}${k === 'reprog' && pend ? `<span class="q">${pend}</span>` : ''}</button>`).join('')}</div>
  <div id="aba"></div>`;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => irPara(`#/p/${p.id}/${b.dataset.a}`));
  $('bt-xls').onclick = exportarExcel; if (g) $('bt-edit').onclick = () => editarProjeto(p);
  ({ painel: abaPainel, tabela: abaTabela, gantt: abaGantt, kanban: abaKanban, reprog: abaReprog }[S.aba] || abaPainel)();
}

/* ---------------------------------------------------------- painel */
function abaPainel() {
  const p = S.proj, g = podeGerir(p), hj = hojeISO();
  const ab = S.tarefas.filter(t => !FECHADOS.includes(t.status));
  const atras = ab.filter(t => t.du_para_prazo < 0 || t.sla_inicio_violado);
  const venc = ab.filter(t => t.du_para_prazo >= 0 && t.du_para_prazo <= 5 && !atras.includes(t));
  const bloq = ab.filter(t => t.status === 'bloqueado');
  const valid = ab.filter(t => t.status === 'em_validacao');
  const semR = ab.filter(t => !t.responsavel_id);
  const pend = S.reprog.filter(r => r.status === 'pendente');
  const conf = ab.filter(t => t.conflito);
  const desvio = p.fim_baseline && p.fim_previsto ? (p.fim_previsto > p.fim_baseline ? 'atrás da baseline' : p.fim_previsto < p.fim_baseline ? 'adiantado' : 'igual à baseline') : 'sem baseline';
  const li = (t, x) => `<div class="li" data-t="${t.id}"><span class="cd">${t.codigo}</span>${dotS(t.saude)}<span class="tt">${esc(t.titulo)}</span>${av(t.responsavel_id)}<span class="tiny muted nowrap">${x || fd(t.fim_previsto)}</span></div>`;
  const bloco = (tit, arr, fn, ic) => `<div class="card"><h3>${ic || ''} ${tit} <span class="muted">(${arr.length})</span></h3>${arr.length ? arr.slice(0, 12).map(fn).join('') : '<div class="tiny muted">Nada aqui. 👍</div>'}</div>`;
  $('aba').innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="l">Concluído</div><div class="v">${Number(p.pct || 0).toLocaleString('pt-BR')}%</div><div class="x">ponderado pela duração · ${p.concluidas}/${p.total_tarefas}</div></div>
    <div class="kpi"><div class="l">Saúde</div><div class="v" style="display:flex;gap:8px;align-items:center">${dotS(p.saude)}<span style="font-size:17px">${{ vermelho: 'Crítica', amarelo: 'Atenção', verde: 'Boa' }[p.saude] || '—'}</span></div><div class="x">${conf.length ? conf.length + ' conflito(s) de data' : ' '}</div></div>
    <div class="kpi"><div class="l">Fim previsto</div><div class="v" style="font-size:20px">${fdy(p.fim_previsto)}</div><div class="x">Baseline ${fdy(p.fim_baseline)} · ${desvio}</div></div>
    <div class="kpi ${p.atrasadas ? 'alerta' : ''}"><div class="l">Atrasadas</div><div class="v">${p.atrasadas}</div><div class="x">${venc.length} vencem em até 5 du</div></div>
    <div class="kpi ${p.bloqueadas ? 'alerta' : ''}"><div class="l">Bloqueadas</div><div class="v">${p.bloqueadas}</div><div class="x">${p.em_validacao} em validação</div></div>
    <div class="kpi"><div class="l">Sem responsável</div><div class="v">${p.sem_responsavel}</div><div class="x">SLA cumprido: ${p.sla_cumprido_pct == null ? '—' : Number(p.sla_cumprido_pct).toLocaleString('pt-BR') + '%'}</div></div>
  </div>
  ${g ? `<div class="acoes noprint" style="margin-bottom:14px">
    <button class="btn btn-gold" id="pn-nova">+ Nova tarefa</button><button class="btn" id="pn-ondas">Ondas</button>
    <button class="btn" id="pn-recalc">Recalcular cronograma</button><button class="btn" id="pn-base">${p.baseline_definida_em ? 'Redefinir baseline' : 'Aprovar plano / definir baseline'}</button>
    <button class="btn" id="pn-ini">Mudar início do projeto</button></div>` : ''}
  <h3 style="font-size:13px;margin:4px 0 10px">Progresso por onda</h3>
  <div class="ondas">${S.ondas.map(o => `<div class="onda" style="--oc:${esc(o.cor || '#C79A3B')}">
      <div class="top"><div class="nm">${esc(o.nome)}</div>
        ${o.encerrada_em ? `<span class="pill s-concluido">Encerrada em ${fdy(o.encerrada_em.slice(0, 10))}</span>${g ? `<button class="btn btn-sm" data-reabrir="${o.onda_id}">Reabrir</button>` : ''}`
          : `<span class="pill s-${o.status === 'concluida' ? 'concluido' : o.status === 'em_andamento' ? 'em_andamento' : 'nao_iniciado'}">${{ concluida: 'Concluída', em_andamento: 'Em andamento', nao_iniciada: 'Não iniciada' }[o.status] || ''}</span>
             ${g && o.pode_encerrar ? `<button class="btn btn-sm btn-ok" data-encerrar="${o.onda_id}">Encerrar onda</button>` : ''}`}
        <span class="small muted nowrap">${fd(o.inicio)} → ${fdy(o.fim)}${o.fim_baseline && o.fim > o.fim_baseline ? ` <span class="dp-neg">(baseline ${fd(o.fim_baseline)})</span>` : ''}</span></div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px"><div class="bar" style="flex:1"><i style="width:${o.pct || 0}%"></i></div><span class="small b">${Number(o.pct || 0).toLocaleString('pt-BR')}%</span><span class="small muted">${o.concluidas}/${o.total} concluídas${o.atrasadas ? ` · <span class="dp-neg">${o.atrasadas} atrasada(s)</span>` : ''}</span></div>
      ${o.criterio_saida ? `<div class="crit"><b>Critério de saída:</b> ${esc(o.criterio_saida)}</div>` : ''}</div>`).join('') || '<div class="card vazio">Nenhuma onda. Use "Ondas" para criar as fases do projeto.</div>'}</div>
  <h3 style="font-size:13px;margin:20px 0 10px">Atenção hoje · ${fdy(hj)}</h3>
  <div class="atn">
    ${bloco('Atrasadas', atras, t => li(t, t.du_para_prazo < 0 ? `<span class="dp-neg">${-t.du_para_prazo} du</span>` : 'não iniciou'), '🔴')}
    ${bloco('Vencem em até 5 dias úteis', venc, t => li(t, `${t.du_para_prazo} du`), '🟡')}
    ${bloco('Bloqueadas', bloq, t => li(t, 'desde ' + fd(t.status_desde)), '⛔')}
    ${bloco('Aguardando validação', valid, t => li(t, 'entregue ' + fd(t.entregue_em)), '✅')}
    ${bloco('Pedidos de reprogramação', pend, r => { const t = tPorId(r.tarefa_id) || {}; return `<div class="li" data-rp="1"><span class="cd">${t.codigo || ''}</span><span class="tt">${esc(t.titulo || '')} — ${esc(nomeP(r.solicitante_id))}</span><span class="tiny muted">${r.novo_fim ? 'prazo ' + fd(r.novo_fim) : ''}</span></div>`; }, '🗓️')}
    ${bloco('Sem responsável', semR, t => li(t, 'início ' + fd(t.inicio_previsto)), '👤')}
  </div>`;
  $('aba').onclick = e => {
    const l = e.target.closest('[data-t]'); if (l) return abrirTarefa(l.dataset.t);
    if (e.target.closest('[data-rp]')) return irPara(`#/p/${p.id}/reprog`);
    const enc = e.target.closest('[data-encerrar]'); if (enc) return encerrarOnda(enc.dataset.encerrar, false);
    const rea = e.target.closest('[data-reabrir]'); if (rea) return encerrarOnda(rea.dataset.reabrir, true);
  };
  if (g) {
    $('pn-nova').onclick = () => novaTarefa(); $('pn-ondas').onclick = editarOndas;
    $('pn-recalc').onclick = async () => { const mot = await perguntar('Recalcular cronograma', 'O motor refaz as datas previstas de todas as tarefas pelas dependências, durações e feriados.', 'Motivo (vai para o histórico)', false, 'Recalcular'); if (mot === null) return;
      try { const n = await rpc('pm_recalcular', { p_projeto: p.id, p_motivo: mot || 'Recálculo manual' }); toast(n ? `${n} tarefa(s) mudaram de data.` : 'Nenhuma data mudou.'); await recarregar(); } catch (e) { falha(e); } };
    $('pn-base').onclick = async () => { if (!await perguntar('Definir baseline', `A baseline é a fotografia do planejado de hoje. O desvio de cada tarefa passa a ser medido contra ela.${p.baseline_definida_em ? ` A atual é de ${fdt(p.baseline_definida_em)} e será substituída (fica no histórico).` : ''}`, null, false, 'Definir baseline')) return;
      try { await rpc('pm_definir_baseline', { p_projeto: p.id }); toast('Baseline definida.'); await recarregar(); } catch (e) { falha(e); } };
    $('pn-ini').onclick = () => { const m = modal('Mudar início do projeto', `<p class="small" style="line-height:1.5">Hoje o projeto começa em <b>${fdy(p.data_inicio)}</b>. As tarefas ainda não iniciadas andam junto, em dias úteis.</p><div class="campos" style="margin-top:10px"><div class="fld"><label>Nova data</label><input type="date" id="mi-d" value="${p.data_inicio}"></div><div class="fld full"><label>Motivo</label><textarea id="mi-m" rows="2"></textarea></div></div>`,
      [{ t: 'Cancelar', fn: o => o.remove() }, { t: 'Aplicar', cls: 'btn-gold', fn: async o => { const d = o.querySelector('#mi-d').value, mo = o.querySelector('#mi-m').value.trim(); if (!d || !mo) return toast('Informe a data e o motivo.', true);
        try { await rpc('pm_rebasear_projeto', { p_projeto: p.id, p_nova_data: d, p_motivo: mo }); o.remove(); toast('Início alterado e cronograma recalculado.'); await recarregar(); } catch (e) { falha(e); } } }]); };
  }
}
async function encerrarOnda(id, reabrir) {
  const o = S.ondas.find(x => x.onda_id === id);
  if (!await perguntar(reabrir ? 'Reabrir onda' : 'Encerrar onda', reabrir ? `Reabrir <b>${esc(o.nome)}</b>?` : `Todas as tarefas obrigatórias de <b>${esc(o.nome)}</b> estão concluídas ou não se aplicam.<br><br><b>Critério de saída:</b> ${esc(o.criterio_saida || '—')}`, null, false, reabrir ? 'Reabrir' : 'Encerrar onda')) return;
  try { await rpc('pm_encerrar_onda', { p_onda: id, p_reabrir: reabrir }); toast(reabrir ? 'Onda reaberta.' : 'Onda encerrada.'); await recarregar(); } catch (e) { falha(e); }
}
function editarOndas() {
  const p = S.proj;
  const linha = o => `<tr data-id="${o ? o.onda_id : ''}"><td style="width:54px"><input type="number" class="o-ord" value="${o ? o.ordem : S.ondas.length + 1}"></td><td><input class="o-nome" value="${esc(o ? o.nome : '')}" placeholder="Ex.: Onda 4 — ..."></td><td style="width:70px"><input type="color" class="o-cor" value="${esc(o ? o.cor || '#C79A3B' : '#C79A3B')}" style="padding:1px;height:30px"></td></tr><tr data-crit><td></td><td colspan="2"><input class="o-crit" value="${esc(o ? o.criterio_saida || '' : '')}" placeholder="Critério de saída (o que precisa estar pronto para encerrar)"></td></tr>`;
  const m = modal('Ondas do projeto', `<table class="cfg-t"><tr><th>Ordem</th><th>Nome</th><th>Cor</th></tr><tbody id="ond-tb">${S.ondas.map(linha).join('')}</tbody></table><button class="btn btn-sm" id="ond-add" style="margin-top:8px">+ Onda</button>`,
    [{ t: 'Cancelar', fn: o => o.remove() }, { t: 'Salvar ondas', cls: 'btn-gold', fn: async o => {
      const rows = [...o.querySelectorAll('#ond-tb tr[data-id]')];
      try {
        for (const r of rows) {
          const crit = r.nextElementSibling.querySelector('.o-crit').value.trim();
          const row = { projeto_id: p.id, ordem: +r.querySelector('.o-ord').value, nome: r.querySelector('.o-nome').value.trim(), cor: r.querySelector('.o-cor').value, criterio_saida: crit || null };
          if (!row.nome) continue;
          if (r.dataset.id) await q(sb.from('pm_ondas').update(row).eq('id', r.dataset.id)); else await q(sb.from('pm_ondas').insert(row));
        }
        o.remove(); toast('Ondas salvas.'); await recarregar();
      } catch (e) { falha(e); } } }], { larga: true });
  m.querySelector('#ond-add').onclick = () => m.querySelector('#ond-tb').insertAdjacentHTML('beforeend', linha(null));
}
function novaTarefa() {
  const p = S.proj, prox = Math.max(0, ...S.tarefas.map(t => t.codigo)) + 1;
  if (!S.ondas.length) return toast('Crie pelo menos uma onda antes das tarefas.', true);
  modal('Nova tarefa', `<div class="campos">
    <div class="fld full"><label>Título</label><input id="nt-tit"></div>
    <div class="fld"><label>Onda</label><select id="nt-onda">${S.ondas.map(o => `<option value="${o.onda_id}">${esc(o.nome)}</option>`).join('')}</select></div>
    <div class="fld"><label>Prioridade</label><select id="nt-prio">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${k === 'media' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="fld"><label>Não começar antes de</label><input type="date" id="nt-ini" value="${p.data_inicio > hojeISO() ? p.data_inicio : hojeISO()}"></div>
    <div class="fld"><label>Duração (dias úteis)</label><input type="number" min="1" id="nt-dur" value="5"></div>
    <div class="fld"><label>Tipo</label><select id="nt-tipo"><option value="tarefa">Tarefa</option><option value="decisao">Decisão (sim/não)</option><option value="marco">Marco</option></select></div>
    <div class="fld"><label>Obrigatoriedade</label><select id="nt-obr"><option value="obrigatorio">Obrigatória</option><option value="condicional">Condicional</option></select></div>
    <div class="fld"><label>Referência</label><input id="nt-ref" placeholder="Ex.: NR-1"></div><div class="fld"><label>Área sugerida</label><input id="nt-area" placeholder="RH, Supervisão, ADM..."></div>
    <div class="fld full"><label>Entregável</label><input id="nt-ent"></div></div>
    <p class="tiny muted" style="margin-top:8px">Tarefa nº ${prox}. As dependências se ligam no detalhe da tarefa.</p>`,
    [{ t: 'Cancelar', fn: o => o.remove() }, { t: 'Criar tarefa', cls: 'btn-gold', fn: async o => {
      const v = id => o.querySelector(id).value.trim();
      const row = { projeto_id: p.id, onda_id: v('#nt-onda'), codigo: prox, titulo: v('#nt-tit'), prioridade: v('#nt-prio'), inicio_restricao: v('#nt-ini') || null, duracao_du: Math.max(1, +v('#nt-dur') || 1),
        tipo: v('#nt-tipo'), obrigatoriedade: v('#nt-obr'), referencia: v('#nt-ref') || null, area: v('#nt-area') || null, entregavel: v('#nt-ent') || null, exige_evidencia: v('#nt-tipo') !== 'decisao' };
      if (!row.titulo) return toast('Informe o título.', true);
      try { const n = await q(sb.from('pm_tarefas').insert(row).select().single()); await rpc('pm_recalcular', { p_projeto: p.id, p_motivo: 'Nova tarefa ' + prox }); o.remove(); toast('Tarefa criada.'); await recarregar(); abrirTarefa(n.id); } catch (e) { falha(e); } } }]);
}

/* ---------------------------------------------------------- tabela */
function filtrar(lst) {
  const f = S.filtro, qq = f.q.toLowerCase();
  return lst.filter(t => (!f.minhas || t.responsavel_id === EU.id) && (!f.atrasadas || (!FECHADOS.includes(t.status) && (t.du_para_prazo < 0 || t.sla_inicio_violado)))
    && (!f.resp || (f.resp === '-' ? !t.responsavel_id : t.responsavel_id === f.resp)) && (!f.area || t.area === f.area) && (!f.status || t.status === f.status)
    && (!qq || (t.titulo + ' ' + (t.referencia || '') + ' ' + t.codigo).toLowerCase().includes(qq)));
}
function barraFiltros() {
  const f = S.filtro, areas = [...new Set(S.tarefas.map(t => t.area).filter(Boolean))].sort();
  return `<div class="filtros noprint"><button class="chip ${f.minhas ? 'on' : ''}" data-fc="minhas">Minhas</button><button class="chip ${f.atrasadas ? 'on' : ''}" data-fc="atrasadas">Atrasadas</button>
    <select data-fs="resp"><option value="">Todos os responsáveis</option><option value="-" ${f.resp === '-' ? 'selected' : ''}>Sem responsável</option>${S.pessoas.map(p => `<option value="${p.id}" ${f.resp === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
    <select data-fs="area"><option value="">Todas as áreas</option>${areas.map(a => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    <select data-fs="status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <input data-fs="q" placeholder="Buscar tarefa..." value="${esc(f.q)}" style="min-width:180px"></div>`;
}
function ligarFiltros(redesenha) {
  document.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => { S.filtro[b.dataset.fc] = !S.filtro[b.dataset.fc]; redesenha(); });
  document.querySelectorAll('[data-fs]').forEach(s => s[s.tagName === 'INPUT' ? 'oninput' : 'onchange'] = e => { S.filtro[s.dataset.fs] = e.target.value; if (s.tagName === 'INPUT') { clearTimeout(s._h); s._h = setTimeout(() => { redesenha(); const n = document.querySelector('[data-fs=q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); } else redesenha(); });
}
function abaTabela() {
  const g = podeGerir(S.proj), lst = filtrar(S.tarefas);
  const dp = t => FECHADOS.includes(t.status) ? (t.status === 'concluido' ? '<span class="dp-ok">✓</span>' : '—') : `<span class="${t.du_para_prazo < 0 ? 'dp-neg' : t.du_para_prazo <= 5 ? 'dp-am' : 'dp-ok'}">${t.du_para_prazo}</span>`;
  const desv = t => t.desvio_baseline_du == null ? '' : t.desvio_baseline_du > 0 ? `<span class="dp-neg">+${t.desvio_baseline_du}</span>` : t.desvio_baseline_du < 0 ? `<span class="dp-ok">${t.desvio_baseline_du}</span>` : '0';
  let html = '';
  S.ondas.concat([{ onda_id: null, nome: 'Sem onda', cor: '#ddd' }]).forEach(o => {
    const ts = lst.filter(t => (t.onda_id || null) === o.onda_id); if (!ts.length) return;
    const claro = /^#(F|E)/i.test(o.cor || '');
    html += `<tr class="og ${claro ? 'claro' : ''}" style="--oc:${esc(o.cor || '#C79A3B')}"><td colspan="12">${esc(o.nome)} <span style="font-weight:500">· ${ts.length} tarefa(s)</span></td></tr>`;
    html += ts.map(t => `<tr class="row" data-t="${t.id}">
      <td class="c b">${t.codigo}</td><td>${dotS(t.saude)}</td>
      <td style="min-width:260px"><div class="tt">${esc(t.titulo)}${t.tipo === 'decisao' ? ' <span class="tiny muted">(decisão)</span>' : ''}${t.obrigatoriedade === 'condicional' ? ' <span class="tiny muted">(condicional)</span>' : ''}</div><div class="rf">${esc(t.referencia || '')}${t.entregavel ? ' · ' + esc(t.entregavel) : ''}${t.conflito ? ' · <span class="dp-neg">⚠ conflito</span>' : ''}</div></td>
      <td>${g ? `<select data-inl="responsavel_id" style="max-width:140px"><option value="">— ${esc(t.area || '')}</option>${S.pessoas.filter(p => p.papel !== 'sem_acesso').map(p => `<option value="${p.id}" ${t.responsavel_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>` : `<span class="nowrap">${av(t.responsavel_id)} ${t.responsavel_id ? esc(nomeP(t.responsavel_id)) : `<span class="muted">${esc(t.area || '—')}</span>`}</span>`}</td>
      <td>${g ? `<select data-inl="prioridade">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${t.prioridade === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : prio(t.prioridade)}</td>
      <td>${(g || ehResp(t)) ? `<select data-inl="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : pill(t.status)}</td>
      <td class="nowrap">${fd(t.inicio_previsto)}</td><td class="nowrap b">${fd(t.fim_previsto)}</td><td class="c">${dp(t)}</td>
      <td class="c tiny">${esc(t.depende_de || '—')}</td><td class="c">${desv(t)}</td><td class="c">${t.exige_evidencia ? (t.qtd_evidencias ? `📎${t.qtd_evidencias}` : '<span class="muted">0</span>') : '<span class="muted">—</span>'}</td></tr>`).join('');
  });
  $('aba').innerHTML = barraFiltros() + `<div class="tbl-wrap"><table class="tb"><thead><tr><th>ID</th><th></th><th>Tarefa</th><th>Responsável</th><th>Prioridade</th><th>Status</th><th>Início</th><th>Prazo</th><th title="Dias úteis até o prazo">Dias p/ prazo</th><th>Depende de</th><th title="Desvio do prazo em relação à baseline (dias úteis)">Desvio</th><th>Evid.</th></tr></thead><tbody>${html || '<tr><td colspan="12" class="vazio">Nenhuma tarefa com esses filtros.</td></tr>'}</tbody></table></div>
    <p class="tiny muted" style="margin-top:8px">Dias úteis (seg–sex, sem os feriados do calendário). Clique na linha para abrir o detalhe. ${g ? 'Datas mudam pelo detalhe ou arrastando no Cronograma, sempre com o impacto antes de salvar.' : ''}</p>`;
  ligarFiltros(abaTabela);
  $('aba').onclick = e => { if (e.target.closest('select')) return; const r = e.target.closest('tr.row'); if (r) abrirTarefa(r.dataset.t); };
  $('aba').onchange = async e => {
    const s = e.target.closest('select[data-inl]'); if (!s) return; const t = tPorId(s.closest('tr').dataset.t), campo = s.dataset.inl;
    if (campo === 'status') { const ok = await mudarStatus(t, s.value); if (!ok) s.value = t.status; return; }
    try { await q(sb.from('pm_tarefas').update({ [campo]: s.value || null }).eq('id', t.id)); toast(campo === 'responsavel_id' ? (s.value ? `Responsável: ${nomeP(s.value)}` : 'Responsável removido.') : 'Prioridade alterada.'); await recarregar(); } catch (er) { falha(er); s.value = t[campo] || ''; }
  };
}

/* ---------------------------------------------------------- status (as regras estão no banco) */
async function mudarStatus(t, novo) {
  if (novo === t.status) return false;
  const g = podeGerir(S.proj), patch = { status: novo };
  if (novo === 'concluido' && !g) { toast('Envie a tarefa para validação; a conclusão é aprovada pelo gestor do projeto.', true); return false; }
  if (['bloqueado', 'nao_se_aplica', 'cancelado'].includes(novo)) {
    const j = await perguntar(STATUS[novo], novo === 'bloqueado' ? 'O que está impedindo o andamento?' : novo === 'nao_se_aplica' ? 'Por que esta tarefa não se aplica?' : 'Por que a tarefa será cancelada?', 'Justificativa', true, STATUS[novo]);
    if (!j) return false; patch.justificativa = j;
  }
  if (['em_validacao', 'concluido'].includes(novo) && t.tipo === 'decisao' && !t.decisao_resultado) {
    const r = await escolherDecisao(t); if (!r) return false; patch.decisao_resultado = r; t.decisao_resultado = r;
  }
  if (novo === 'concluido' && t.tipo === 'decisao' && (patch.decisao_resultado || t.decisao_resultado) === 'nao') {
    const afet = S.deps.filter(d => d.predecessora_id === t.id).map(d => tPorId(d.tarefa_id)).filter(x => x && x.obrigatoriedade === 'condicional' && x.status === 'nao_iniciado');
    if (!await perguntar('Decisão = Não', `Ao concluir a decisão ${t.codigo} com <b>Não</b>, ${afet.length ? 'estas tarefas condicionais passam para <b>Não se aplica</b>:<br>' + afet.map(x => `• ${x.codigo} — ${esc(x.titulo)}`).join('<br>') : 'nenhuma tarefa condicional é afetada.'}`, null, false, 'Concluir com Não')) return false;
  }
  if (novo === 'em_andamento' && t.status === 'em_validacao') { const c = await perguntar('Reprovar entrega', 'A tarefa volta para Em andamento. Explique o que falta (vai como comentário).', 'Comentário', true, 'Reprovar'); if (!c) return false; await sb.from('pm_comentarios').insert({ tarefa_id: t.id, texto: 'Reprovada na validação: ' + c }); }
  try { await q(sb.from('pm_tarefas').update(patch).eq('id', t.id)); toast(`Tarefa ${t.codigo}: ${STATUS[novo]}.`); await recarregar(); return true; }
  catch (e) { falha(e); return false; }
}
function escolherDecisao(t) {
  return new Promise(res => modal('Resultado da decisão', `<p class="small" style="margin-bottom:10px">${esc(t.titulo)}</p><div class="acoes"><label class="chip"><input type="radio" name="dc" value="sim"> Sim</label><label class="chip"><input type="radio" name="dc" value="nao"> Não</label></div>`,
    [{ t: 'Cancelar', fn: o => { o.remove(); res(null); } }, { t: 'Confirmar', cls: 'btn-gold', fn: o => { const v = o.querySelector('input[name=dc]:checked'); if (!v) return toast('Escolha Sim ou Não.', true); o.remove(); res(v.value); } }], { aoFechar: () => res(null) }));
}

/* ---------------------------------------------------------- kanban */
function abaKanban() {
  const g = podeGerir(S.proj), lst = filtrar(S.tarefas);
  const cols = [['nao_iniciado', 'Não iniciado'], ['em_andamento', 'Em andamento'], ['bloqueado', 'Bloqueado'], ['em_validacao', 'Em validação'], ['concluido', 'Concluído'], ['fora', 'Não se aplica / cancelado']];
  const da = (k, t) => k === 'fora' ? ['nao_se_aplica', 'cancelado'].includes(t.status) : t.status === k;
  $('aba').innerHTML = barraFiltros() + `<div class="kb">${cols.map(([k, v]) => { const ts = lst.filter(t => da(k, t)); return `<div class="kc" data-col="${k}"><h3>${v}<span>${ts.length}</span></h3>${ts.map(t => `<div class="kcard" draggable="${(g || ehResp(t)) ? 'true' : 'false'}" data-t="${t.id}" style="--oc:${esc(ondaDe(t).cor || '#C79A3B')}">
      <div style="display:flex;gap:6px;align-items:center"><b class="tiny">${t.codigo}</b>${dotS(t.saude)}${prio(t.prioridade)}</div><div class="tt">${esc(t.titulo)}</div>
      <div class="ft">${av(t.responsavel_id, 20)}<span>${fd(t.fim_previsto)}</span>${t.qtd_evidencias ? `<span>📎${t.qtd_evidencias}</span>` : ''}${!FECHADOS.includes(t.status) && t.du_para_prazo < 0 ? `<span class="dp-neg">${-t.du_para_prazo} du atraso</span>` : ''}</div></div>`).join('')}</div>`; }).join('')}</div>
    <p class="tiny muted">Arraste os cartões entre as colunas. ${g ? '' : 'Você move só as tarefas em que é responsável; a conclusão é do gestor (envie para Em validação).'}</p>`;
  ligarFiltros(abaKanban);
  let arr = null;
  $('aba').addEventListener('dragstart', e => { const c = e.target.closest('.kcard'); if (!c) return; arr = c.dataset.t; e.dataTransfer.setData('text/plain', arr); });
  document.querySelectorAll('.kc').forEach(c => {
    c.addEventListener('dragover', e => { e.preventDefault(); c.classList.add('over'); });
    c.addEventListener('dragleave', () => c.classList.remove('over'));
    c.addEventListener('drop', async e => { e.preventDefault(); c.classList.remove('over'); const t = tPorId(arr); if (!t) return; let novo = c.dataset.col;
      if (novo === 'fora') { novo = (g && t.obrigatoriedade !== 'condicional') ? 'cancelado' : 'nao_se_aplica'; }
      await mudarStatus(t, novo); });
  });
  $('aba').onclick = e => { const c = e.target.closest('.kcard'); if (c) abrirTarefa(c.dataset.t); };
}

/* ---------------------------------------------------------- reprogramações */
function abaReprog() {
  const g = podeGerir(S.proj);
  const pend = S.reprog.filter(r => r.status === 'pendente'), feitos = S.reprog.filter(r => r.status !== 'pendente');
  const tabImp = imp => { const a = (imp && imp.afetadas) || []; return a.length ? `<table class="imp"><tr><th>#</th><th>Tarefa</th><th>Início</th><th>Prazo</th></tr>${a.map(x => `<tr><td>${x.codigo}</td><td>${esc(x.titulo)}${x.conflito ? `<div class="dp-neg tiny">⚠ ${esc(x.conflito)}</div>` : ''}</td><td>${x.inicio_de !== x.inicio_para ? `<span class="de">${fd(x.inicio_de)}</span> → <span class="pa">${fd(x.inicio_para)}</span>` : fd(x.inicio_para)}</td><td>${x.fim_de !== x.fim_para ? `<span class="de">${fd(x.fim_de)}</span> → <span class="pa">${fd(x.fim_para)}</span>` : fd(x.fim_para)}</td></tr>`).join('')}</table>
      <div class="fimp"><span>Fim do projeto: <b>${fdy(imp.fim_projeto_atual)}</b> → <b>${fdy(imp.fim_projeto_novo)}</b></span></div>` : '<div class="tiny muted">Sem efeito em outras tarefas.</div>'; };
  const card = (r, ac) => { const t = tPorId(r.tarefa_id) || {}; return `<div class="card" style="margin-bottom:10px"><div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><div class="b">${t.codigo} — ${esc(t.titulo)}</div><div class="small muted">Pedido por ${esc(nomeP(r.solicitante_id))} em ${fdt(r.criado_em)}</div>
      <div class="small" style="margin-top:6px">${r.novo_inicio ? `Novo início: <b>${fdy(r.novo_inicio)}</b> · ` : ''}${r.novo_fim ? `Novo prazo: <b>${fdy(r.novo_fim)}</b>` : ''}${r.nova_duracao_du ? ` · Duração: <b>${r.nova_duracao_du} du</b>` : ''}</div>
      <div class="small" style="margin-top:4px"><b>Motivo:</b> ${esc(r.motivo)}</div>${r.status !== 'pendente' ? `<div class="small" style="margin-top:4px">${r.status === 'aprovada' ? '✅ Aprovada' : '❌ Rejeitada'} por ${esc(nomeP(r.decidido_por))} em ${fdt(r.decidido_em)}${r.comentario_decisao ? ' — ' + esc(r.comentario_decisao) : ''}</div>` : ''}</div>
      ${ac && g ? `<div class="acoes"><button class="btn btn-err" data-rj="${r.id}">Rejeitar</button><button class="btn btn-ok" data-ap="${r.id}">Aprovar</button></div>` : ''}</div>
      <details style="margin-top:8px" ${ac ? 'open' : ''}><summary class="small b" style="cursor:pointer">Impacto calculado no pedido</summary>${tabImp(r.impacto)}</details></div>`; };
  $('aba').innerHTML = `${g ? '<div class="aviso">Ao aprovar, o sistema recalcula a partir do estado atual da tarefa e o prazo pedido prevalece. O impacto abaixo é o do momento do pedido.</div>' : ''}
    <h3 style="font-size:13px;margin-bottom:10px">Pendentes (${pend.length})</h3>${pend.length ? pend.map(r => card(r, true)).join('') : '<div class="card vazio">Nenhum pedido pendente.</div>'}
    <h3 style="font-size:13px;margin:18px 0 10px">Decididos</h3>${feitos.length ? feitos.map(r => card(r, false)).join('') : '<div class="tiny muted">Nenhum ainda.</div>'}`;
  $('aba').onclick = async e => {
    const ap = e.target.closest('[data-ap]'), rj = e.target.closest('[data-rj]'); if (!ap && !rj) return;
    const id = (ap || rj).dataset[ap ? 'ap' : 'rj'];
    const c = await perguntar(ap ? 'Aprovar reprogramação' : 'Rejeitar reprogramação', ap ? 'As datas serão recalculadas e o solicitante é avisado.' : 'O solicitante é avisado.', 'Comentário' + (ap ? ' (opcional)' : ''), !ap, ap ? 'Aprovar' : 'Rejeitar');
    if (c === null) return;
    try { await rpc('pm_decidir_reprogramacao', { p_id: id, p_aprovar: !!ap, p_comentario: c || null }); toast(ap ? 'Reprogramação aprovada.' : 'Reprogramação rejeitada.'); await recarregar(); } catch (er) { falha(er); }
  };
}

/* ---------------------------------------------------------- impacto (toda mudança de data passa aqui) */
async function abrirImpacto(t, novo) {
  const g = podeGerir(S.proj);
  const args = { p_tarefa: t.id, p_novo_inicio: novo.inicio || null, p_novo_fim: novo.fim || null, p_nova_duracao: novo.duracao || null, p_travar: novo.travar == null ? null : novo.travar };
  let imp;
  try { imp = await rpc('pm_previsualizar', args); } catch (e) { falha(e); return false; }
  const a = imp.afetadas || [];
  return new Promise(res => {
    modal('Impacto da reprogramação', `
      <p class="small" style="line-height:1.5">Tarefa <b>${t.codigo} — ${esc(t.titulo)}</b>: ${novo.inicio ? `início a partir de <b>${fdy(novo.inicio)}</b> · ` : ''}${novo.fim ? `prazo <b>${fdy(novo.fim)}</b> · ` : ''}duração <b>${imp.nova_duracao_du} dias úteis</b>${novo.travar ? ' · data travada' : ''}.</p>
      ${a.length ? `<table class="imp"><tr><th>#</th><th>Tarefa afetada</th><th>Início (de → para)</th><th>Prazo (de → para)</th></tr>${a.map(x => `<tr class="${x.codigo === t.codigo ? 'alvo' : ''}"><td>${x.codigo}</td><td>${esc(x.titulo)}${x.conflito ? `<div class="dp-neg tiny">⚠ ${esc(x.conflito)}</div>` : ''}</td>
        <td class="nowrap">${x.inicio_de !== x.inicio_para ? `<span class="de">${fd(x.inicio_de)}</span> → <span class="pa">${fd(x.inicio_para)}</span>` : fd(x.inicio_para)}</td><td class="nowrap">${x.fim_de !== x.fim_para ? `<span class="de">${fd(x.fim_de)}</span> → <span class="pa">${fd(x.fim_para)}</span>` : fd(x.fim_para)}</td></tr>`).join('')}</table>` : '<div class="aviso" style="margin-top:8px">Nenhuma data muda com esta alteração.</div>'}
      <div class="fimp"><span>Fim do projeto: <b>${fdy(imp.fim_projeto_atual)}</b> → <b class="${imp.fim_projeto_novo > imp.fim_projeto_atual ? 'dp-neg' : ''}">${fdy(imp.fim_projeto_novo)}</b></span><span class="muted">${a.length} tarefa(s) afetada(s)</span></div>
      <div class="fld" style="margin-top:12px"><label>Motivo (obrigatório, vai para o histórico)</label><textarea id="im-mot" rows="2"></textarea></div>
      ${g ? '' : '<p class="tiny muted">Você não é o gestor: isto vira um pedido de reprogramação para o gestor aprovar.</p>'}`,
      [{ t: 'Cancelar', fn: o => { o.remove(); res(false); } },
       { t: g ? 'Aplicar reprogramação' : 'Enviar pedido ao gestor', cls: 'btn-gold', fn: async (o, b) => {
         const mot = o.querySelector('#im-mot').value.trim(); if (!mot) return toast('Informe o motivo.', true);
         b.disabled = true;
         try { const r = await rpc('pm_reprogramar', Object.assign({}, args, { p_motivo: mot })); o.remove(); toast(r.status === 'aplicada' ? 'Reprogramação aplicada. Cronograma recalculado.' : 'Pedido enviado ao gestor do projeto.'); res(true); await recarregar(); }
         catch (e) { b.disabled = false; falha(e); } } }], { larga: true, aoFechar: () => res(false) });
  });
}
function formReprogramar(t) {
  const g = podeGerir(S.proj);
  modal(g ? 'Reprogramar tarefa' : 'Solicitar reprogramação', `<p class="small" style="margin-bottom:10px">${t.codigo} — ${esc(t.titulo)}<br><span class="muted">Hoje: ${fdy(t.inicio_previsto)} → ${fdy(t.fim_previsto)} · ${t.duracao_du} dias úteis${t.data_travada ? ' · travada' : ''}</span></p>
    <div class="campos"><div class="fld"><label>Novo prazo</label><input type="date" id="rp-fim" value="${t.fim_previsto || ''}"></div>
    <div class="fld"><label>Não começar antes de (opcional)</label><input type="date" id="rp-ini" value=""></div>
    <div class="fld"><label>Ou nova duração (dias úteis)</label><input type="number" min="1" id="rp-dur" placeholder="${t.duracao_du}"></div>
    ${g ? `<div class="fld"><label>Data travada</label><select id="rp-trav"><option value="">Manter (${t.data_travada ? 'sim' : 'não'})</option><option value="1">Travar</option><option value="0">Destravar</option></select></div>` : ''}</div>
    <p class="tiny muted" style="margin-top:8px">Informar o prazo é o caso mais comum: a duração é recalculada sozinha. O próximo passo mostra o impacto antes de salvar.</p>`,
    [{ t: 'Cancelar', fn: o => o.remove() }, { t: 'Ver impacto', cls: 'btn-gold', fn: async o => {
      const fim = o.querySelector('#rp-fim').value, ini = o.querySelector('#rp-ini').value, dur = +o.querySelector('#rp-dur').value || null;
      const tv = g ? o.querySelector('#rp-trav').value : '';
      const novo = { inicio: ini || null, fim: dur ? null : (fim && fim !== t.fim_previsto ? fim : null), duracao: dur, travar: tv === '' ? null : tv === '1' };
      if (!novo.inicio && !novo.fim && !novo.duracao && novo.travar == null) return toast('Nada mudou.', true);
      o.remove(); await abrirImpacto(t, novo); } }]);
}

/* ---------------------------------------------------------- gaveta: detalhe da tarefa */
function fecharGaveta(semRota) { document.querySelectorAll('.gav,.gav-ovl').forEach(e => e.remove()); S.gaveta = null; }
async function abrirTarefa(id, manterScroll) {
  // sempre a versão atual do banco (outra pessoa pode ter mudado o status)
  let t = await q(sb.from('pm_vw_tarefas').select('*').eq('id', id).maybeSingle()); if (!t) return toast('Tarefa não encontrada.', true);
  if (!S.proj || S.proj.id !== t.projeto_id) await carregarProjeto(t.projeto_id);
  else { const i = S.tarefas.findIndex(x => x.id === id); if (i >= 0) S.tarefas[i] = t; }
  t = tPorId(id) || t;
  const antes = document.querySelector('.gav .gb'), sc = manterScroll && antes ? antes.scrollTop : 0;
  fecharGaveta(); S.gaveta = id;
  const p = S.proj, g = podeGerir(p), resp = ehResp(t), mexe = g || resp;
  const [ev, ck, cm, hs] = await Promise.all([
    q(sb.from('pm_evidencias').select('*').eq('tarefa_id', id).order('criado_em', { ascending: false })),
    q(sb.from('pm_checklist').select('*').eq('tarefa_id', id).order('ordem')),
    q(sb.from('pm_comentarios').select('*').eq('tarefa_id', id).order('criado_em')),
    q(sb.from('pm_historico').select('*').eq('tarefa_id', id).order('em', { ascending: false }).limit(80))]);
  const preds = S.deps.filter(d => d.tarefa_id === id), sucs = S.deps.filter(d => d.predecessora_id === id);
  const depTxt = d => `${d.tipo}${d.lag_du ? (d.lag_du > 0 ? '+' : '') + d.lag_du + ' du' : ''}`;
  const acoes = [];
  const A = (st, txt, cls) => acoes.push(`<button class="btn ${cls || ''}" data-st="${st}">${txt}</button>`);
  if (mexe) {
    if (t.status === 'nao_iniciado') A('em_andamento', '▶ Iniciar', 'btn-gold');
    if (t.status === 'em_andamento') { A('em_validacao', 'Enviar para validação', 'btn-gold'); A('bloqueado', 'Bloquear', 'btn-err'); }
    if (t.status === 'bloqueado') A('em_andamento', 'Desbloquear');
    if (t.status === 'em_validacao' && g) { A('concluido', '✓ Aprovar e concluir', 'btn-ok'); A('em_andamento', 'Reprovar', 'btn-err'); }
    if (g && ['nao_iniciado', 'em_andamento', 'bloqueado'].includes(t.status)) A('concluido', 'Concluir');
    if (t.status === 'concluido' && g) A('em_andamento', 'Reabrir');
    if (!FECHADOS.includes(t.status) && (g || t.obrigatoriedade === 'condicional')) A('nao_se_aplica', 'Não se aplica');
    if (!FECHADOS.includes(t.status) && g) A('cancelado', 'Cancelar tarefa');
    if (['nao_se_aplica', 'cancelado'].includes(t.status) && g) A('nao_iniciado', 'Reativar');
  }
  const pes = S.pessoas.filter(x => x.papel !== 'sem_acesso');
  const dis = g ? '' : 'disabled';
  const hsTxt = h => {
    const cp = { status: 'Status', responsavel_id: 'Responsável', inicio_previsto: 'Início previsto', fim_previsto: 'Prazo', percentual: '%', prioridade: 'Prioridade' }[h.campo];
    const val = v => h.campo === 'status' ? (STATUS[v] || v || '—') : h.campo === 'responsavel_id' ? nomeP(v) : /previsto/.test(h.campo || '') ? fdy(v) : (v == null ? '—' : v);
    const ac = { tarefa_criada: 'Tarefa criada', reprogramacao_aplicada: 'Reprogramação aplicada', checklist_gerado: 'Checklist atualizado' }[h.acao];
    return `<div class="hs"><b>${esc(h.usuario_id ? nomeP(h.usuario_id) : 'Sistema')}</b> · ${fdt(h.em)}<br>${cp ? `${cp}: ${esc(val(h.valor_antigo))} → <b>${esc(val(h.valor_novo))}</b>` : esc(ac || h.acao)}${h.motivo ? ` <span class="muted">— ${esc(h.motivo)}</span>` : ''}</div>`;
  };
  const ckFeito = ck.filter(c => c.concluido).length;
  const ov = document.createElement('div'); ov.className = 'gav-ovl'; ov.onclick = () => fecharGaveta();
  const gv = document.createElement('div'); gv.className = 'gav';
  gv.innerHTML = `<div class="gh" style="position:relative"><button class="x" data-x>&times;</button>
      <div class="tiny muted" style="letter-spacing:.05em">${esc(p.codigo)} · ${esc(ondaDe(t).nome || '')}</div>
      <h2>${t.codigo} — ${esc(t.titulo)}</h2>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px">${pill(t.status)}${prio(t.prioridade)}${dotS(t.saude)}<span class="small muted">${esc(SAUDE[t.saude] || '')}</span>${t.obrigatoriedade === 'condicional' ? '<span class="pill s-nao_iniciado">Condicional</span>' : ''}${t.tipo === 'decisao' ? `<span class="pill s-em_validacao">Decisão${t.decisao_resultado ? ': ' + (t.decisao_resultado === 'sim' ? 'Sim' : 'Não') : ''}</span>` : ''}</div>
      ${t.justificativa && ['bloqueado', 'nao_se_aplica', 'cancelado'].includes(t.status) ? `<div class="conf" style="background:#fff7e6;color:#7a5a12">${esc(t.justificativa)}</div>` : ''}
      ${t.conflito ? `<div class="conf">⚠ ${esc(t.conflito)}</div>` : ''}
      ${acoes.length ? `<div class="acoes" style="margin-top:10px">${acoes.join('')}</div>` : ''}</div>
    <div class="gb">
      <div class="sec"><h4>Prazos <span class="grow"></span>${mexe && !FECHADOS.includes(t.status) ? `<button class="btn btn-sm" id="gv-rep">${g ? 'Reprogramar' : 'Solicitar reprogramação'}</button>` : ''}</h4>
        <div class="datas"><div><span>Início previsto</span><b>${fdy(t.inicio_previsto)}</b></div><div><span>Prazo</span><b>${fdy(t.fim_previsto)}</b></div><div><span>Duração</span><b>${t.duracao_du} du</b></div><div><span>Dias p/ prazo</span><b class="${t.du_para_prazo < 0 ? 'dp-neg' : ''}">${t.du_para_prazo == null ? '—' : t.du_para_prazo}</b></div>
          <div><span>Baseline</span>${fd(t.inicio_baseline)} → ${fd(t.fim_baseline)}</div><div><span>Desvio</span>${t.desvio_baseline_du == null ? '—' : (t.desvio_baseline_du > 0 ? '+' : '') + t.desvio_baseline_du + ' du'}</div><div><span>Início real</span>${fdy(t.inicio_real)}</div><div><span>Entregue / fim real</span>${fdy(t.entregue_em)} / ${fdy(t.fim_real)}</div></div>
        <div class="small muted" style="margin-top:6px">${t.inicio_restricao ? 'Não começar antes de ' + fdy(t.inicio_restricao) : ''}${t.data_travada ? ' · 🔒 data travada' : ''}</div></div>
      <div class="sec"><h4>Dados</h4><div class="campos">
        <div class="fld full"><label>Título</label><input id="gv-tit" value="${esc(t.titulo)}" ${dis}></div>
        <div class="fld"><label>Responsável</label><select id="gv-resp" ${dis}><option value="">— sem responsável —</option>${pes.map(x => `<option value="${x.id}" ${t.responsavel_id === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
        <div class="fld"><label>Área sugerida</label><input id="gv-area" value="${esc(t.area || '')}" ${dis}></div>
        <div class="fld"><label>Executor externo</label><input id="gv-ext" value="${esc(t.executor_externo || '')}" ${dis}></div>
        <div class="fld"><label>Prioridade</label><select id="gv-prio" ${dis}>${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${t.prioridade === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="fld"><label>Referência</label><input id="gv-ref" value="${esc(t.referencia || '')}" ${dis}></div>
        <div class="fld"><label>Entregável</label><input id="gv-ent" value="${esc(t.entregavel || '')}" ${dis}></div>
        <div class="fld"><label>Obrigatoriedade</label><select id="gv-obr" ${dis}><option value="obrigatorio" ${t.obrigatoriedade === 'obrigatorio' ? 'selected' : ''}>Obrigatória</option><option value="condicional" ${t.obrigatoriedade === 'condicional' ? 'selected' : ''}>Condicional</option></select></div>
        <div class="fld"><label>Exige evidência</label><select id="gv-evd" ${dis}><option value="1" ${t.exige_evidencia ? 'selected' : ''}>Sim</option><option value="0" ${t.exige_evidencia ? '' : 'selected'}>Não</option></select></div>
        <div class="fld full"><label>Descrição</label>${g ? `<textarea id="gv-desc" rows="2">${esc(t.descricao || '')}</textarea>` : `<div class="ro">${t.descricao ? linkify(t.descricao) : '<span class="muted">—</span>'}</div>`}</div>
        ${g && t.descricao && /https?:\/\//.test(t.descricao) ? `<div class="fld full tiny">${linkify(t.descricao)}</div>` : ''}
        <div class="fld"><label>% concluído</label><input type="number" min="0" max="100" step="5" id="gv-pct" value="${t.percentual}" ${mexe ? '' : 'disabled'}></div>
        ${t.tipo === 'decisao' ? `<div class="fld"><label>Resultado da decisão</label><select id="gv-dec" ${mexe ? '' : 'disabled'}><option value="">—</option><option value="sim" ${t.decisao_resultado === 'sim' ? 'selected' : ''}>Sim</option><option value="nao" ${t.decisao_resultado === 'nao' ? 'selected' : ''}>Não</option></select></div>` : '<div></div>'}
        <div class="fld full"><label>Observações</label><textarea id="gv-obs" rows="3" ${mexe ? '' : 'disabled'}>${esc(t.observacoes || '')}</textarea></div>
      </div>${mexe ? `<div class="acoes" style="margin-top:10px"><button class="btn btn-gold" id="gv-salvar">Salvar alterações</button>${g ? '' : '<span class="tiny muted" style="align-self:center">Você altera %, decisão e observações. Os demais campos são do gestor.</span>'}</div>` : ''}</div>
      <div class="sec"><h4>Dependências</h4>
        <div class="small"><b>Depende de:</b> ${preds.length ? preds.map(d => { const x = tPorId(d.predecessora_id) || {}; return `<div class="li" data-t="${x.id}"><span class="cd">${x.codigo}</span><span class="tt">${esc(x.titulo)}</span><span class="tiny muted">${depTxt(d)}</span>${g ? `<button class="btn btn-sm" data-deldep="${d.id}">Remover</button>` : ''}</div>`; }).join('') : '<span class="muted">nenhuma</span>'}</div>
        <div class="small" style="margin-top:8px"><b>Libera:</b> ${sucs.length ? sucs.map(d => { const x = tPorId(d.tarefa_id) || {}; return `<div class="li" data-t="${x.id}"><span class="cd">${x.codigo}</span><span class="tt">${esc(x.titulo)}</span><span class="tiny muted">${depTxt(d)}</span></div>`; }).join('') : '<span class="muted">nenhuma</span>'}</div>
        ${g ? `<div class="campos" style="margin-top:10px;grid-template-columns:2fr 1fr 1fr auto;align-items:end"><div class="fld"><label>Nova predecessora</label><select id="dp-pred">${S.tarefas.filter(x => x.id !== id && !preds.some(d => d.predecessora_id === x.id)).map(x => `<option value="${x.id}">${x.codigo} — ${esc(x.titulo.slice(0, 50))}</option>`).join('')}</select></div>
          <div class="fld"><label>Tipo</label><select id="dp-tipo"><option value="FS">FS — começa após o fim</option><option value="SS">SS — começa com o início</option><option value="FF">FF — termina após o fim</option></select></div>
          <div class="fld"><label>Lag (du)</label><input type="number" id="dp-lag" value="0"></div><button class="btn" id="dp-add">Ligar</button></div>` : ''}</div>
      <div class="sec"><h4>Checklist <span class="muted" style="text-transform:none;letter-spacing:0">${ck.length ? `${ckFeito}/${ck.length}` : ''}</span><span class="grow"></span>${mexe && t.checklist_fonte ? `<button class="btn btn-sm" id="ck-gerar">Atualizar lista de ${t.checklist_fonte}</button>` : ''}</h4>
        ${ck.length > 12 ? `<input id="ck-q" placeholder="Filtrar..." style="width:100%;font:inherit;font-size:12.5px;border:1px solid var(--line);border-radius:7px;padding:6px 9px;margin-bottom:6px">` : ''}
        ${ck.length ? `<div class="bar" style="margin-bottom:8px"><i style="width:${Math.round(100 * ckFeito / ck.length)}%"></i></div>` : ''}
        <div id="ck-l">${ck.map(c => `<label class="chk ${c.concluido ? 'feito' : ''}" data-ck="${c.id}"><input type="checkbox" ${c.concluido ? 'checked' : ''} ${mexe ? '' : 'disabled'}><span>${esc(c.descricao)}${c.concluido && c.concluido_por ? ` <i class="tiny muted">· ${esc(nomeP(c.concluido_por))} ${fd(c.concluido_em && c.concluido_em.slice(0, 10))}</i>` : ''}</span>${g ? `<button class="del" data-delck="${c.id}" title="Remover">✕</button>` : ''}</label>`).join('') || '<div class="tiny muted">Sem itens.</div>'}</div>
        ${mexe ? `<div style="display:flex;gap:6px;margin-top:8px"><input id="ck-novo" placeholder="Novo item..." style="flex:1;font:inherit;font-size:12.5px;border:1px solid var(--line);border-radius:7px;padding:6px 9px"><button class="btn btn-sm" id="ck-add">Adicionar</button></div>` : ''}</div>
      <div class="sec"><h4>Evidências ${t.exige_evidencia ? '<span class="muted" style="text-transform:none;letter-spacing:0">(obrigatória para enviar à validação)</span>' : ''}<span class="grow"></span>${mexe ? `<label class="btn btn-sm" style="cursor:pointer">+ Anexar<input type="file" id="ev-arq" hidden multiple></label>` : ''}</h4>
        ${ev.length ? ev.map(x => `<div class="ev">📎 <a data-ev="${esc(x.arquivo_path)}">${esc(x.nome_arquivo)}</a><span class="tiny muted nowrap">${esc(nomeP(x.enviado_por))} · ${fdt(x.criado_em)}</span>${(g || x.enviado_por === EU.id) ? `<button class="btn btn-sm" data-delev="${x.id}" data-path="${esc(x.arquivo_path)}">✕</button>` : ''}</div>`).join('') : '<div class="tiny muted">Nenhuma evidência anexada.</div>'}</div>
      <div class="sec"><h4>Comentários</h4>${cm.map(c => `<div class="cm"><div class="m">${av(c.autor_id, 18)} <b>${esc(nomeP(c.autor_id))}</b> · ${fdt(c.criado_em)}</div><div class="tx">${linkify(c.texto)}</div></div>`).join('') || '<div class="tiny muted">Nenhum comentário.</div>'}
        <div style="display:flex;gap:6px;margin-top:8px"><textarea id="cm-tx" rows="2" placeholder="Escreva um comentário..." style="flex:1;font:inherit;font-size:12.5px;border:1px solid var(--line);border-radius:7px;padding:6px 9px"></textarea><button class="btn" id="cm-env">Enviar</button></div></div>
      <div class="sec"><h4>Histórico</h4>${hs.map(hsTxt).join('') || '<div class="tiny muted">Sem registros.</div>'}</div>
    </div>`;
  document.body.append(ov, gv);
  gv.querySelector('.gb').scrollTop = sc;
  gv.querySelector('[data-x]').onclick = () => fecharGaveta();
  gv.querySelectorAll('[data-st]').forEach(b => b.onclick = () => mudarStatus(t, b.dataset.st));
  const rep = gv.querySelector('#gv-rep'); if (rep) rep.onclick = () => formReprogramar(t);
  const sal = gv.querySelector('#gv-salvar');
  if (sal) sal.onclick = async () => {
    const v = s => gv.querySelector(s) ? gv.querySelector(s).value : undefined;
    const patch = { percentual: Math.max(0, Math.min(100, +v('#gv-pct') || 0)), observacoes: v('#gv-obs').trim() || null };
    if (t.tipo === 'decisao') patch.decisao_resultado = v('#gv-dec') || null;
    if (g) Object.assign(patch, { titulo: v('#gv-tit').trim(), responsavel_id: v('#gv-resp') || null, area: v('#gv-area').trim() || null, executor_externo: v('#gv-ext').trim() || null, prioridade: v('#gv-prio'),
      referencia: v('#gv-ref').trim() || null, entregavel: v('#gv-ent').trim() || null, obrigatoriedade: v('#gv-obr'), exige_evidencia: v('#gv-evd') === '1', descricao: v('#gv-desc').trim() || null });
    try { await q(sb.from('pm_tarefas').update(patch).eq('id', t.id)); toast('Tarefa salva.'); await recarregar(); } catch (e) { falha(e); }
  };
  gv.querySelectorAll('.li[data-t]').forEach(l => l.onclick = e => { if (e.target.closest('button')) return; abrirTarefa(l.dataset.t); });
  gv.querySelectorAll('[data-deldep]').forEach(b => b.onclick = async e => { e.stopPropagation(); try { await q(sb.from('pm_dependencias').delete().eq('id', b.dataset.deldep)); toast('Dependência removida. Cronograma recalculado.'); await recarregar(); } catch (er) { falha(er); } });
  const dpa = gv.querySelector('#dp-add');
  if (dpa) dpa.onclick = async () => { const pred = gv.querySelector('#dp-pred').value; if (!pred) return;
    try { await q(sb.from('pm_dependencias').insert({ tarefa_id: t.id, predecessora_id: pred, tipo: gv.querySelector('#dp-tipo').value, lag_du: +gv.querySelector('#dp-lag').value || 0 })); toast('Dependência ligada. Cronograma recalculado.'); await recarregar(); } catch (er) { falha(er); } };
  // checklist
  const ckl = gv.querySelector('#ck-l');
  ckl.addEventListener('change', async e => { const l = e.target.closest('[data-ck]'); if (!l) return;
    try { await q(sb.from('pm_checklist').update({ concluido: e.target.checked }).eq('id', l.dataset.ck)); l.classList.toggle('feito', e.target.checked); const tot = ckl.querySelectorAll('[data-ck]').length, f = ckl.querySelectorAll('input:checked').length; const h = gv.querySelector('.sec h4 .muted'); if (h) h.textContent = `${f}/${tot}`; const br = ckl.previousElementSibling; if (br && br.classList.contains('bar')) br.firstElementChild.style.width = Math.round(100 * f / tot) + '%'; }
    catch (er) { e.target.checked = !e.target.checked; falha(er); } });
  ckl.addEventListener('click', async e => { const d = e.target.closest('[data-delck]'); if (!d) return; e.preventDefault(); try { await q(sb.from('pm_checklist').delete().eq('id', d.dataset.delck)); abrirTarefa(id, true); } catch (er) { falha(er); } });
  const ckq = gv.querySelector('#ck-q'); if (ckq) ckq.oninput = () => { const s = ckq.value.toLowerCase(); ckl.querySelectorAll('[data-ck]').forEach(l => l.style.display = l.textContent.toLowerCase().includes(s) ? '' : 'none'); };
  const cka = gv.querySelector('#ck-add'); if (cka) cka.onclick = async () => { const tx = gv.querySelector('#ck-novo').value.trim(); if (!tx) return; try { await q(sb.from('pm_checklist').insert({ tarefa_id: t.id, descricao: tx, ordem: ck.length + 1 })); abrirTarefa(id, true); } catch (er) { falha(er); } };
  const ckg = gv.querySelector('#ck-gerar'); if (ckg) ckg.onclick = async () => { try { const n = await rpc('pm_gerar_checklist', { p_tarefa: t.id, p_fonte: t.checklist_fonte }); toast(n ? `${n} item(ns) novo(s) na lista.` : 'A lista já está em dia.'); abrirTarefa(id, true); } catch (er) { falha(er); } };
  // evidências
  const arq = gv.querySelector('#ev-arq');
  if (arq) arq.onchange = async () => {
    for (const f of arq.files) {
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name}: limite de 20 MB por arquivo.`, true); continue; }
      const nome = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
      const path = `${t.projeto_id}/${t.id}/${new Date().toISOString().replace(/[:.]/g, '-')}_${nome}`;
      try { await q(sb.storage.from('pm-evidencias').upload(path, f, { contentType: f.type || 'application/octet-stream' })); await q(sb.from('pm_evidencias').insert({ tarefa_id: t.id, arquivo_path: path, nome_arquivo: f.name })); toast('Evidência anexada: ' + f.name); }
      catch (er) { falha(er); }
    }
    await recarregar();
  };
  gv.querySelectorAll('[data-ev]').forEach(a => a.onclick = async () => { try { const r = await q(sb.storage.from('pm-evidencias').createSignedUrl(a.dataset.ev, 300)); window.open(r.signedUrl, '_blank'); } catch (er) { falha(er); } });
  gv.querySelectorAll('[data-delev]').forEach(b => b.onclick = async () => { if (!await perguntar('Remover evidência', 'O arquivo será apagado.', null, false, 'Remover')) return;
    try { await q(sb.from('pm_evidencias').delete().eq('id', b.dataset.delev)); await sb.storage.from('pm-evidencias').remove([b.dataset.path]); toast('Evidência removida.'); await recarregar(); } catch (er) { falha(er); } });
  // comentários
  gv.querySelector('#cm-env').onclick = async () => { const tx = gv.querySelector('#cm-tx').value.trim(); if (!tx) return; try { await q(sb.from('pm_comentarios').insert({ tarefa_id: t.id, texto: tx })); abrirTarefa(id, true); } catch (er) { falha(er); } };
}

/* ---------------------------------------------------------- Gantt */
function abaGantt() {
  const p = S.proj, g = podeGerir(p), lst = filtrar(S.tarefas);
  const PX = S.zoom === 'mes' ? 7 : 22, ROW = 30, LW = innerWidth < 760 ? 170 : 300, HH = 46;
  const datas = S.tarefas.flatMap(t => [t.inicio_previsto, t.fim_previsto, t.inicio_baseline, t.fim_baseline, t.inicio_real, t.fim_real]).filter(Boolean).map(pD);
  if (!datas.length) { $('aba').innerHTML = '<div class="card vazio">Sem tarefas com datas.</div>'; return; }
  let ini = new Date(Math.min(...datas, pD(hojeISO()))), fim = new Date(Math.max(...datas));
  ini = addD(ini, -((ini.getDay() + 6) % 7) - 7); fim = addD(fim, 14);
  const dias = Math.round((fim - ini) / 864e5) + 1, W = dias * PX;
  const x = s => Math.round((pD(s) - ini) / 864e5) * PX;
  const linhas = [];
  S.ondas.concat([{ onda_id: null, nome: 'Sem onda', cor: '#ddd' }]).forEach(o => { const ts = lst.filter(t => (t.onda_id || null) === o.onda_id); if (!ts.length) return; linhas.push({ onda: o }); ts.forEach(t => linhas.push({ t })); });
  const H = linhas.length * ROW;
  // fundo: fins de semana e feriados; cabeçalho de meses e semanas/dias
  let fundo = '', meses = '', subs = '';
  for (let i = 0; i < dias; i++) {
    const d = addD(ini, i), s = iso(d);
    if (!ehUtil(d)) fundo += `<div style="position:absolute;left:${i * PX}px;top:0;width:${PX}px;height:${H}px;background:${S.ferSet.has(s) ? 'rgba(212,175,55,.22)' : '#f6f4ee'}" ${S.ferSet.has(s) ? `title="${esc((S.feriados.find(f => f.data === s) || {}).descricao || 'Feriado')}"` : ''}></div>`;
    if (d.getDate() === 1 || i === 0) meses += `<div style="position:absolute;left:${i * PX}px;top:4px;font-size:11px;font-weight:700;white-space:nowrap;padding-left:4px;border-left:1px solid #444">${d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</div>`;
    if (S.zoom === 'mes') { if (d.getDay() === 1) subs += `<div style="position:absolute;left:${i * PX}px;top:24px;font-size:9.5px;color:#cfcabd">${d.getDate()}</div>`; }
    else subs += `<div style="position:absolute;left:${i * PX}px;top:24px;width:${PX}px;text-align:center;font-size:9.5px;color:${ehUtil(d) ? '#cfcabd' : '#777'}">${d.getDate()}</div>`;
    if (d.getDay() === 1) fundo += `<div style="position:absolute;left:${i * PX}px;top:0;width:1px;height:${H}px;background:#ebe7dc"></div>`;
  }
  const hj = hojeISO(), xHoje = x(hj);
  const cor = t => t.status === 'concluido' ? '#7fb98a' : ['nao_se_aplica', 'cancelado'].includes(t.status) ? '#cfcfcf' : t.saude === 'vermelho' ? '#d9665a' : t.status === 'em_validacao' ? '#8fb0d6' : t.status === 'bloqueado' ? '#e3a59c' : '#D4AF37';
  let rows = '', bars = '', setas = '';
  const pos = {};
  linhas.forEach((l, i) => {
    const y = i * ROW;
    if (l.onda) { rows += `<div style="position:absolute;top:${y}px;left:0;width:${LW}px;height:${ROW}px;background:${esc(l.onda.cor || '#C79A3B')};font-weight:700;font-size:11.5px;padding:8px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.onda.nome)}</div>`;
      bars += `<div style="position:absolute;top:${y}px;left:0;width:${W}px;height:${ROW}px;background:${esc(l.onda.cor || '#C79A3B')};opacity:.18"></div>`; return; }
    const t = l.t;
    rows += `<div class="grow-row" data-t="${t.id}" style="position:absolute;top:${y}px;left:0;width:${LW}px;height:${ROW}px;display:flex;gap:7px;align-items:center;padding:0 10px;border-bottom:1px solid #f3f1ea;cursor:pointer;font-size:12px"><b style="min-width:20px;color:var(--muted)">${t.codigo}</b>${dotS(t.saude)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(t.titulo)}</span>${av(t.responsavel_id, 18)}</div>`;
    if (t.inicio_baseline && t.fim_baseline) bars += `<div class="gbase" style="left:${x(t.inicio_baseline)}px;top:${y + 21}px;width:${x(t.fim_baseline) - x(t.inicio_baseline) + PX}px" title="Baseline ${fd(t.inicio_baseline)} → ${fd(t.fim_baseline)}"></div>`;
    if (t.inicio_previsto && t.fim_previsto) {
      const bx = x(t.inicio_previsto), bw = x(t.fim_previsto) - bx + PX, arr = (g || ehResp(t)) && !FECHADOS.includes(t.status);
      pos[t.id] = { x1: bx, x2: bx + bw, y: y + 11 };
      bars += `<div class="gbar ${arr ? '' : 'fix'}" data-t="${t.id}" style="left:${bx}px;top:${y + 4}px;width:${bw}px;background:${cor(t)}${t.conflito ? ';outline:2px solid #c0392b' : ''}" title="${t.codigo} — ${esc(t.titulo)}\n${fd(t.inicio_previsto)} → ${fd(t.fim_previsto)} · ${t.duracao_du} du${t.conflito ? '\n⚠ ' + esc(t.conflito) : ''}">${PX > 10 && bw > 60 ? `<span style="overflow:hidden;text-overflow:ellipsis">${esc(t.referencia || '')}</span>` : ''}${t.data_travada ? '🔒' : ''}${arr ? '<i class="rh"></i>' : ''}</div>`;
      bars += `<div style="position:absolute;left:${bx + bw + 4}px;top:${y + 6}px;font-size:10px;color:var(--muted);white-space:nowrap;pointer-events:none">${fd(t.fim_previsto)}</div>`;
    }
  });
  S.deps.forEach(d => { const a = pos[d.predecessora_id], b = pos[d.tarefa_id]; if (!a || !b) return;
    const sx = d.tipo === 'SS' ? a.x1 : a.x2, ex = d.tipo === 'FF' ? b.x2 : b.x1, sy = a.y, ey = b.y;
    const mx = d.tipo === 'FF' ? Math.max(sx, ex) + 8 : Math.min(sx + 8, ex - 8);
    setas += `<path d="M${sx},${sy} H${mx} V${ey} H${ex}" fill="none" stroke="#8a8578" stroke-width="1.1" marker-end="url(#seta)" opacity=".75"/>`; });
  $('aba').innerHTML = barraFiltros() + `
    <div class="gt-bar noprint"><button class="chip ${S.zoom === 'semana' ? 'on' : ''}" data-z="semana">Dias</button><button class="chip ${S.zoom === 'mes' ? 'on' : ''}" data-z="mes">Meses</button>
      <span class="tiny muted gt-dica" style="flex:1">Barra = previsto · faixa hachurada = baseline · linha vermelha = hoje · colunas douradas = feriados. ${g ? 'Arraste a barra para mudar o início ou a borda direita para mudar o prazo: o impacto aparece antes de salvar.' : 'Nas suas tarefas, arrastar gera um pedido de reprogramação.'}</span>
      <span style="flex:1"></span><button class="btn" id="gt-pdf">PDF do cronograma</button></div>
    <div class="printhead"><b style="font-family:'Playfair Display',serif;font-size:18px">${esc(p.nome)}</b> · cronograma em ${fdy(hojeISO())} · fim previsto ${fdy(p.fim_previsto)} · baseline ${fdy(p.fim_baseline)}</div>
    <div class="gantt" id="gt"><div class="gg" style="width:${LW + W}px;height:${HH + H}px">
      <div class="corner" id="gt-c" style="position:absolute;left:0;top:0;width:${LW}px;height:${HH}px">Tarefa</div>
      <div class="hdr" id="gt-h" style="position:absolute;left:${LW}px;top:0;width:${W}px;height:${HH}px">${meses}${subs}</div>
      <div class="lh" id="gt-l" style="position:absolute;left:0;top:${HH}px;width:${LW}px;height:${H}px">${rows}</div>
      <div id="gt-area" style="position:absolute;left:${LW}px;top:${HH}px;width:${W}px;height:${H}px">${fundo}
        <svg style="position:absolute;left:0;top:0;pointer-events:none;z-index:2" width="${W}" height="${H}"><defs><marker id="seta" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#8a8578"/></marker></defs>${setas}</svg>
        ${bars}<div style="position:absolute;left:${xHoje + PX / 2}px;top:0;width:2px;height:${H}px;background:#c0392b;z-index:4" title="Hoje"></div></div>
    </div></div>`;
  ligarFiltros(abaGantt);
  document.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { S.zoom = b.dataset.z; abaGantt(); });
  $('gt-pdf').onclick = () => { const z = S.zoom; S.zoom = 'mes'; abaGantt(); setTimeout(() => { window.print(); S.zoom = z; abaGantt(); }, 300); };
  const gt = $('gt');
  gt.onscroll = () => { const l = gt.scrollLeft, t = gt.scrollTop; $('gt-l').style.transform = `translateX(${l}px)`; $('gt-h').style.transform = `translateY(${t}px)`; $('gt-c').style.transform = `translate(${l}px,${t}px)`; };
  if (xHoje > 400) gt.scrollLeft = Math.max(0, xHoje - 300);
  gt.querySelectorAll('.grow-row').forEach(r => r.onclick = () => abrirTarefa(r.dataset.t));
  // arrastar
  gt.querySelectorAll('.gbar').forEach(b => {
    const t = tPorId(b.dataset.t);
    if (b.classList.contains('fix')) { b.onclick = () => abrirTarefa(t.id); return; }
    b.addEventListener('mousedown', e => {
      e.preventDefault(); const borda = e.target.classList.contains('rh'), x0 = e.clientX, l0 = b.offsetLeft, w0 = b.offsetWidth; let mov = 0;
      const move = ev => { mov = Math.round((ev.clientX - x0) / PX); if (borda) b.style.width = Math.max(PX, w0 + mov * PX) + 'px'; else b.style.left = (l0 + mov * PX) + 'px'; };
      const up = async () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        if (!mov) { abrirTarefa(t.id); return; }
        const novo = borda ? { fim: iso(proxUtil(addD(pD(t.fim_previsto), mov))) } : { inicio: iso(proxUtil(addD(pD(t.inicio_previsto), mov))) };
        const ok = await abrirImpacto(t, novo); if (!ok) abaGantt(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
  });
}

/* ========================================================== MINHAS TAREFAS */
async function telaMinhas() {
  S.proj = null;
  const [minhas, projs] = await Promise.all([
    q(sb.from('pm_vw_tarefas').select('*').eq('responsavel_id', EU.id).order('fim_previsto')),
    q(sb.from('pm_vw_projetos').select('id,nome,codigo,gestor_id,eh_modelo').eq('eh_modelo', false))]);
  const pm = {}; projs.forEach(p => pm[p.id] = p);
  const geridos = projs.filter(p => PAPEL === 'admin' || PAPEL === 'diretoria' || p.gestor_id === EU.id).map(p => p.id);
  let validar = [], pedidos = [];
  if (geridos.length) {
    validar = await q(sb.from('pm_vw_tarefas').select('*').in('projeto_id', geridos).eq('status', 'em_validacao').order('entregue_em'));
    pedidos = (await q(sb.from('pm_reprogramacoes').select('id,tarefa_id,criado_em, pm_tarefas(projeto_id,codigo,titulo)').eq('status', 'pendente').order('criado_em')))
      .filter(r => r.pm_tarefas && geridos.includes(r.pm_tarefas.projeto_id));
  }
  const mm = minhas.filter(t => pm[t.projeto_id]);
  const ab = mm.filter(t => !FECHADOS.includes(t.status) && t.status !== 'em_validacao');
  const grupos = [['🔴 Atrasadas', ab.filter(t => t.du_para_prazo < 0 || t.sla_inicio_violado)], ['🟡 Vencem em até 5 dias úteis', ab.filter(t => t.du_para_prazo >= 0 && t.du_para_prazo <= 5 && !t.sla_inicio_violado)],
    ['Próximas', ab.filter(t => t.du_para_prazo > 5 && !t.sla_inicio_violado)], ['✅ Enviadas para validação', mm.filter(t => t.status === 'em_validacao')]];
  const linha = t => `<div class="li" data-t="${t.id}"><span class="cd">${t.codigo}</span>${dotS(t.saude)}<span class="tt"><b>${esc(t.titulo)}</b> <span class="muted">· ${esc((pm[t.projeto_id] || {}).codigo || '')}</span></span>${pill(t.status)}<span class="small nowrap" style="min-width:90px;text-align:right">${fd(t.fim_previsto)} ${t.du_para_prazo != null && !FECHADOS.includes(t.status) ? `<span class="${t.du_para_prazo < 0 ? 'dp-neg' : t.du_para_prazo <= 5 ? 'dp-am' : 'muted'}">(${t.du_para_prazo} du)</span>` : ''}</span></div>`;
  $('main').innerHTML = `<div class="ph"><div><h1 class="t">Minhas tarefas</h1><div class="sub">Tudo em que você é responsável, em todos os projetos, por prazo.</div></div></div>
    ${validar.length || pedidos.length ? `<div class="atn" style="margin-bottom:14px">
      ${validar.length ? `<div class="card"><h3>Para você validar (${validar.length})</h3>${validar.map(t => `<div class="li" data-t="${t.id}"><span class="cd">${t.codigo}</span><span class="tt">${esc(t.titulo)} <span class="muted">· ${esc((pm[t.projeto_id] || {}).codigo || '')}</span></span>${av(t.responsavel_id)}<span class="tiny muted">entregue ${fd(t.entregue_em)}</span></div>`).join('')}</div>` : ''}
      ${pedidos.length ? `<div class="card"><h3>Pedidos de reprogramação (${pedidos.length})</h3>${pedidos.map(r => `<div class="li" data-rp="${r.pm_tarefas ? r.pm_tarefas.projeto_id : ''}"><span class="cd">${r.pm_tarefas ? r.pm_tarefas.codigo : ''}</span><span class="tt">${esc(r.pm_tarefas ? r.pm_tarefas.titulo : '')}</span><span class="tiny muted">${fdt(r.criado_em)}</span></div>`).join('')}</div>` : ''}</div>` : ''}
    ${grupos.map(([tit, arr]) => `<div class="card" style="margin-bottom:12px"><h3 style="font-size:13px;margin-bottom:6px">${tit} <span class="muted">(${arr.length})</span></h3>${arr.length ? arr.map(linha).join('') : '<div class="tiny muted">Nada aqui.</div>'}</div>`).join('')}
    ${!mm.length ? '<div class="card vazio">Você ainda não é responsável por nenhuma tarefa.</div>' : ''}`;
  $('main').onclick = e => { const l = e.target.closest('[data-t]'); if (l) return abrirTarefa(l.dataset.t); const r = e.target.closest('[data-rp]'); if (r && r.dataset.rp) irPara(`#/p/${r.dataset.rp}/reprog`); };
}

/* ========================================================== CONFIGURAÇÕES */
async function telaConfig(aba) {
  S.proj = null;
  if (!(PAPEL === 'admin' || PAPEL === 'diretoria')) { $('main').innerHTML = '<div class="card vazio">Configurações são do administrador e da diretoria.</div>'; return; }
  const abas = [['feriados', 'Feriados'], ['sla', 'SLA'], ['acessos', 'Acessos'], ['modelos', 'Modelos']];
  $('main').innerHTML = `<div class="ph"><div><h1 class="t">Configurações</h1><div class="sub">Calendário de dias úteis, regras de SLA, acessos ao módulo e modelos de projeto.</div></div></div>
    <div class="tabs">${abas.map(([k, v]) => `<button class="tab ${aba === k ? 'on' : ''}" data-c="${k}">${v}</button>`).join('')}</div><div id="cfg"></div>`;
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => irPara('#/config/' + b.dataset.c));
  const c = $('cfg');
  if (aba === 'feriados') {
    const fer = await q(sb.from('pm_feriados').select('*').order('data'));
    const ABR = ['nacional', 'estadual', 'municipal', 'ponto_facultativo', 'recesso'];
    c.innerHTML = `<div class="aviso">Datas com "Conta no prazo" marcado deixam de ser dia útil para o motor. Ao mudar o calendário, use "Recalcular projetos" para as datas acompanharem.</div>
      <div class="card"><table class="cfg-t"><tr><th>Data</th><th>Descrição</th><th>Abrangência</th><th>Conta no prazo</th><th></th></tr>
      ${fer.map(f => `<tr data-d="${f.data}"><td class="nowrap">${fdy(f.data)}</td><td><input value="${esc(f.descricao)}" data-k="descricao"></td><td><select data-k="abrangencia">${ABR.map(a => `<option ${f.abrangencia === a ? 'selected' : ''}>${a}</option>`).join('')}</select></td><td><input type="checkbox" data-k="considerar" ${f.considerar ? 'checked' : ''} style="width:auto"></td><td><button class="btn btn-sm btn-err" data-del="${f.data}">Remover</button></td></tr>`).join('')}
      <tr><td><input type="date" id="nf-d"></td><td><input id="nf-desc" placeholder="Descrição"></td><td><select id="nf-a">${ABR.map(a => `<option>${a}</option>`).join('')}</select></td><td><input type="checkbox" id="nf-c" checked style="width:auto"></td><td><button class="btn btn-sm btn-gold" id="nf-add">Incluir</button></td></tr></table></div>
      <div class="acoes" style="margin-top:12px"><button class="btn" id="cf-recalc">Recalcular projetos em execução</button></div>`;
    c.onchange = async e => { const tr = e.target.closest('tr[data-d]'); if (!tr) return; const k = e.target.dataset.k; const v = k === 'considerar' ? e.target.checked : e.target.value;
      try { await q(sb.from('pm_feriados').update({ [k]: v }).eq('data', tr.dataset.d)); toast('Calendário atualizado.'); } catch (er) { falha(er); } };
    c.onclick = async e => { const d = e.target.closest('[data-del]'); if (d) { try { await q(sb.from('pm_feriados').delete().eq('data', d.dataset.del)); telaConfig('feriados'); } catch (er) { falha(er); } } };
    $('nf-add').onclick = async () => { const row = { data: $('nf-d').value, descricao: $('nf-desc').value.trim(), abrangencia: $('nf-a').value, considerar: $('nf-c').checked };
      if (!row.data || !row.descricao) return toast('Informe data e descrição.', true); try { await q(sb.from('pm_feriados').insert(row)); telaConfig('feriados'); } catch (er) { falha(er); } };
    $('cf-recalc').onclick = async () => { try { const ps = await q(sb.from('pm_projetos').select('id,nome').eq('status', 'em_execucao').eq('eh_modelo', false)); let n = 0;
      for (const p of ps) n += await rpc('pm_recalcular', { p_projeto: p.id, p_motivo: 'Calendário de feriados alterado' }); toast(`${ps.length} projeto(s) recalculados · ${n} tarefa(s) mudaram de data.`); } catch (er) { falha(er); } };
  } else if (aba === 'sla') {
    const sla = await q(sb.from('pm_sla_regras').select('*'));
    const ord = ['critica', 'alta', 'media', 'baixa'];
    c.innerHTML = `<div class="card" style="overflow:auto"><table class="cfg-t" style="min-width:820px"><tr><th>Prioridade</th><th>Tolerância p/ iniciar (du)</th><th>Avisos antes do prazo (du)</th><th>Escala gestor (atraso du)</th><th>Escala diretoria (atraso du)</th><th>Validação parada (du)</th><th>Bloqueio longo (du)</th></tr>
      ${ord.map(k => { const r = sla.find(x => x.prioridade === k) || {}; return `<tr data-p="${k}"><td>${prio(k)}</td><td><input type="number" data-k="sla_inicio_du" value="${r.sla_inicio_du ?? ''}"></td><td><input data-k="alertas_antes_du" value="${(r.alertas_antes_du || []).join(', ')}"></td><td><input type="number" data-k="escala_gestor_du" value="${r.escala_gestor_du ?? ''}"></td><td><input type="number" data-k="escala_diretoria_du" value="${r.escala_diretoria_du ?? ''}"></td><td><input type="number" data-k="sla_validacao_du" value="${r.sla_validacao_du ?? ''}"></td><td><input type="number" data-k="sla_bloqueio_du" value="${r.sla_bloqueio_du ?? ''}"></td></tr>`; }).join('')}</table></div>
      <p class="tiny muted" style="margin-top:8px">A verificação roda todo dia útil às 07h (Brasília) e avisa no sino do portal: sem responsável, início atrasado, prazo próximo, atraso, escalonamento ao gestor e à diretoria, validação parada e bloqueio longo.</p>`;
    c.onchange = async e => { const tr = e.target.closest('tr[data-p]'); if (!tr) return; const k = e.target.dataset.k;
      const v = k === 'alertas_antes_du' ? e.target.value.split(/[,; ]+/).map(Number).filter(n => n > 0) : +e.target.value;
      try { await q(sb.from('pm_sla_regras').update({ [k]: v }).eq('prioridade', tr.dataset.p)); toast('Regra de SLA salva.'); } catch (er) { falha(er); } };
  } else if (aba === 'acessos') {
    const pes = await rpc('pm_pessoas');
    const adm = PAPEL === 'admin';
    c.innerHTML = `<div class="aviso">O papel no módulo vem dos papéis do portal: <b>admin</b> → admin · <b>diretoria</b> → diretoria · administrativo, RH, comercial ou supervisor → <b>membro</b> · só colaborador → sem acesso. Use a exceção para mudar o papel de alguém só aqui.${adm ? '' : ' Só o administrador altera exceções.'}</div>
      <div class="card"><table class="cfg-t"><tr><th>Pessoa</th><th>Papéis no portal</th><th>Papel no módulo</th><th>Exceção</th></tr>
      ${pes.map(p => `<tr data-u="${p.id}"><td>${av(p.id)} ${esc(p.nome)}</td><td class="tiny">${esc((p.papel_portal || []).join(', '))}</td><td><b>${esc(p.papel)}</b></td><td>${(p.papel_portal || []).includes('admin') ? '<span class="tiny muted">admin do portal</span>' : `<select ${adm ? '' : 'disabled'} style="max-width:200px"><option value="">— padrão do portal —</option>${['diretoria', 'membro', 'admin'].map(x => `<option ${p.excecao === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`}</td></tr>`).join('')}</table></div>`;
    c.onchange = async e => { const tr = e.target.closest('tr[data-u]'); if (!tr) return; const v = e.target.value;
      try { if (v) await q(sb.from('pm_acessos').upsert({ usuario_id: tr.dataset.u, papel: v })); else await q(sb.from('pm_acessos').delete().eq('usuario_id', tr.dataset.u)); toast('Acesso atualizado.'); const np = await rpc('pm_pessoas'); S.pessoas = np; S.pmap = {}; np.forEach(p => S.pmap[p.id] = p); telaConfig('acessos'); } catch (er) { falha(er); } };
  } else if (aba === 'modelos') {
    const [mods, projs] = await Promise.all([q(sb.from('pm_vw_projetos').select('*').eq('eh_modelo', true).order('nome')), q(sb.from('pm_projetos').select('id,codigo,nome').eq('eh_modelo', false).order('nome'))]);
    c.innerHTML = `<div class="aviso">Um modelo é uma cópia limpa de um projeto (ondas, tarefas, durações e dependências, sem responsáveis, status nem evidências). Use em "Novo a partir de modelo".</div>
      <div class="card" style="margin-bottom:12px"><h3 style="font-size:13px;margin-bottom:8px">Criar modelo a partir de um projeto</h3><div class="campos" style="grid-template-columns:2fr 1fr 2fr auto;align-items:end">
        <div class="fld"><label>Projeto de origem</label><select id="md-src">${projs.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></div>
        <div class="fld"><label>Código do modelo</label><input id="md-cod" placeholder="MODELO-NR1"></div><div class="fld"><label>Nome do modelo</label><input id="md-nome" placeholder="Modelo — Implantação NR-1 / PGR"></div><button class="btn btn-gold" id="md-criar">Criar modelo</button></div></div>
      <div class="card"><h3 style="font-size:13px;margin-bottom:8px">Modelos (${mods.length})</h3>${mods.map(m => `<div class="li" style="cursor:default"><span class="tt"><b>${esc(m.nome)}</b> <span class="muted">· ${esc(m.codigo)} · ${m.total_tarefas} tarefas</span></span><a class="btn btn-sm" href="#/p/${m.id}/tabela">Abrir</a>${PAPEL === 'admin' ? `<button class="btn btn-sm btn-err" data-delm="${m.id}">Excluir</button>` : ''}</div>`).join('') || '<div class="tiny muted">Nenhum modelo ainda.</div>'}</div>`;
    $('md-criar').onclick = async () => { const cod = $('md-cod').value.trim(), nome = $('md-nome').value.trim(); if (!cod || !nome) return toast('Informe código e nome do modelo.', true);
      try { const id = await rpc('pm_criar_de_modelo', { p_modelo: $('md-src').value, p_codigo: cod, p_nome: nome, p_data_inicio: hojeISO(), p_gestor: null }); await q(sb.from('pm_projetos').update({ eh_modelo: true, status: 'planejamento' }).eq('id', id)); toast('Modelo criado.'); telaConfig('modelos'); } catch (er) { falha(er); } };
    c.onclick = async e => { const d = e.target.closest('[data-delm]'); if (!d) return; if (!await perguntar('Excluir modelo', 'O modelo será apagado. Projetos já criados a partir dele continuam.', null, false, 'Excluir')) return;
      try { await q(sb.from('pm_projetos').delete().eq('id', d.dataset.delm)); telaConfig('modelos'); } catch (er) { falha(er); } };
  }
}

/* ========================================================== EXPORTAR EXCEL (layout do Painel_NR1_PGR_CS_v2) */
function carregarScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Não consegui carregar ' + src)); document.head.appendChild(s); }); }
async function exportarExcel() {
  const p = S.proj;
  try { toast('Montando a planilha...'); await carregarScript('/portal/_comum/vendor/exceljs.min.js'); } catch (e) { return falha(e); }
  const wb = new ExcelJS.Workbook(); wb.creator = 'Portal C&S';
  const OURO = 'FFC79A3B', PRETO = 'FF0D0D0D', HDR = 'FF1F1F1F', CREME = 'FFF3F0E9', LINHA = 'FFD9D4C7', PRATA = 'FFC7C7C7';
  const borda = { top: { style: 'thin', color: { argb: LINHA } }, bottom: { style: 'thin', color: { argb: LINHA } }, left: { style: 'thin', color: { argb: LINHA } }, right: { style: 'thin', color: { argb: LINHA } } };
  const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const cab = (ws, titulo, ncol) => {
    ws.mergeCells(1, 1, 1, ncol); ws.mergeCells(2, 1, 2, ncol);
    for (let c = 1; c <= ncol; c++) { ws.getCell(1, c).fill = fill(PRETO); ws.getCell(2, c).fill = fill(PRETO); ws.getCell(3, c).fill = fill(OURO); }
    Object.assign(ws.getCell(1, 1), { value: titulo, font: { name: 'Cormorant Garamond', size: 18, bold: true, color: { argb: OURO } }, alignment: { vertical: 'middle' } });
    Object.assign(ws.getCell(2, 1), { value: 'Costa & Sobral  —  Movendo Confiança, Gerando Valor.', font: { name: 'Montserrat', size: 9, italic: true, color: { argb: PRATA } }, alignment: { vertical: 'middle' } });
    ws.getRow(1).height = 34; ws.getRow(2).height = 18; ws.getRow(3).height = 4;
  };
  const hdr = (ws, r, vals, c0) => { vals.forEach((v, i) => { const c = ws.getCell(r, (c0 || 1) + i); c.value = v; c.font = { name: 'Montserrat', size: 9.5, bold: true, color: { argb: OURO } }; c.fill = fill(HDR); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = borda; }); };
  const ts = S.tarefas.slice().sort((a, b) => ((ondaDe(a).ordem || 99) - (ondaDe(b).ordem || 99)) || a.codigo - b.codigo);
  const n = ts.length, R0 = 5, R1 = R0 + n - 1;
  const STL = ['Concluído', 'Em andamento', 'Em validação', 'Bloqueado', 'Não iniciado', 'Não se aplica', 'Cancelado'];
  const dU = s => { const d = pD(s); return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null; };   // data pura no Excel (sem fuso)
  // Painel de Controle
  const ws = wb.addWorksheet('Painel de Controle', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  ws.columns = [5, 24, 44, 8, 28, 12, 13, 11, 11, 15, 18, 11, 48].map(w => ({ width: w }));
  cab(ws, `C&S  ·  PAINEL DE CONTROLE — ${p.nome.toUpperCase()}`, 13);
  hdr(ws, 4, ['ID', 'Onda', 'Requisito / item a implantar', 'NR', 'Documento gerado', 'Obrigatório?', 'Depende de', 'Início', 'Prazo', 'Status', 'Responsável', 'Dias p/ prazo', 'Observações']); ws.getRow(4).height = 30;
  ts.forEach((t, i) => {
    const r = R0 + i, o = ondaDe(t);
    const vals = [t.codigo, o.nome || '', t.titulo, t.referencia || '', t.entregavel || '', t.obrigatoriedade === 'condicional' ? 'Condicional' : 'Sim', t.depende_de || '—', dU(t.inicio_previsto), dU(t.fim_previsto), STATUS[t.status], t.responsavel_id ? nomeP(t.responsavel_id) : '', null, t.observacoes || ''];
    vals.forEach((v, j) => { const c = ws.getCell(r, j + 1); c.value = v; c.font = { name: 'Montserrat', size: 9.5 }; c.border = borda; c.alignment = { horizontal: [0, 3, 5, 6, 7, 8, 9, 11].includes(j) ? 'center' : 'left', vertical: 'middle', wrapText: [1, 2, 12].includes(j) }; });
    ws.getCell(r, 8).numFmt = 'dd/mm/yyyy'; ws.getCell(r, 9).numFmt = 'dd/mm/yyyy';
    const ob = ws.getCell(r, 2); ob.font = { name: 'Montserrat', size: 8.5, bold: true, color: { argb: PRETO } }; ob.fill = fill('FF' + String(o.cor || '#C79A3B').replace('#', '').toUpperCase());
    ws.getCell(r, 11).fill = fill(CREME); ws.getCell(r, 13).fill = fill(CREME);
    ws.getCell(r, 12).value = { formula: `IF(J${r}="Concluído","✓",IF(OR(J${r}="Não se aplica",J${r}="Cancelado"),"—",I${r}-TODAY()))` }; ws.getCell(r, 12).numFmt = '0;-0;0';
    ws.getRow(r).height = 32;
  });
  const cfS = (ref) => [['Concluído', 'FFD7EBD3', 'FF2E6B2A'], ['Em andamento', 'FFF8E7B5', 'FF8A6100'], ['Em validação', 'FFDDE8F5', 'FF2A4F7A'], ['Bloqueado', 'FFF4D0CC', 'FF9B2C20'], ['Não iniciado', 'FFECEAE4', 'FF5C5446'], ['Não se aplica', 'FFE4E4E4', 'FF7A7A7A'], ['Cancelado', 'FFE4E4E4', 'FF7A7A7A']]
    .map(([v, b, f]) => ({ type: 'cellIs', operator: 'equal', formulae: [`"${v}"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: b } }, font: { bold: true, color: { argb: f } } } }));
  if (n) {
    ws.dataValidations.add(`J${R0}:J${R1}`, { type: 'list', allowBlank: false, formulae: [`"${STL.join(',')}"`] });
    ws.addConditionalFormatting({ ref: `J${R0}:J${R1}`, rules: cfS() });
    ws.addConditionalFormatting({ ref: `L${R0}:L${R1}`, rules: [
      { type: 'expression', formulae: [`AND(ISNUMBER(L${R0}),L${R0}<0)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF4D0CC' } }, font: { bold: true, color: { argb: 'FF9B2C20' } } } },
      { type: 'expression', formulae: [`AND(ISNUMBER(L${R0}),L${R0}<=7)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8E7B5' } }, font: { bold: true, color: { argb: 'FF8A6100' } } } },
      { type: 'expression', formulae: [`L${R0}="✓"`], style: { font: { bold: true, color: { argb: 'FF2E6B2A' } } } }] });
  }
  // Cronograma semanal
  const iniP = ts.length ? pD(ts.map(t => t.inicio_previsto).filter(Boolean).sort()[0]) : pD(p.data_inicio);
  const fimP = ts.length ? pD(ts.map(t => t.fim_previsto).filter(Boolean).sort().slice(-1)[0]) : addD(iniP, 30);
  const seg0 = addD(iniP, -((iniP.getDay() + 6) % 7)); const semanas = []; for (let d = seg0; d <= fimP; d = addD(d, 7)) semanas.push(d);
  const wc = wb.addWorksheet('Cronograma', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  wc.columns = [{ width: 5 }, { width: 42 }, { width: 14 }, ...semanas.map(() => ({ width: 4.2 }))];
  const ncC = 3 + semanas.length;
  cab(wc, `C&S  ·  CRONOGRAMA SEMANAL — ${fdy(iso(semanas[0]))} A ${fdy(iso(semanas[semanas.length - 1]))}`, ncC);
  hdr(wc, 4, ['ID', 'Item', 'Status']);
  semanas.forEach((d, i) => { const c = wc.getCell(4, 4 + i); c.value = dU(iso(d)); c.numFmt = 'dd/mm'; c.font = { name: 'Montserrat', size: 9.5, bold: true, color: { argb: OURO } }; c.fill = fill(HDR); c.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 }; c.border = borda; });
  wc.getRow(4).height = 44;
  ts.forEach((t, i) => { const r = R0 + i;
    [[1, `'Painel de Controle'!A${r}`], [2, `'Painel de Controle'!C${r}`], [3, `'Painel de Controle'!J${r}`]].forEach(([c, f]) => { const cel = wc.getCell(r, c); cel.value = { formula: f }; cel.font = { name: 'Montserrat', size: 8.5 }; cel.border = borda; cel.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 2 }; });
    for (let k = 0; k < semanas.length; k++) { const cel = wc.getCell(r, 4 + k); cel.border = borda; }
    wc.getRow(r).height = 24; });
  if (n) {
    const L = c => wc.getColumn(c).letter, A = L(4), Z = L(ncC);
    const dentro = `AND(${A}$4<='Painel de Controle'!$I${R0},${A}$4+6>='Painel de Controle'!$H${R0})`;
    wc.addConditionalFormatting({ ref: `${A}${R0}:${Z}${R1}`, rules: [
      { type: 'expression', formulae: [`AND(${dentro},$C${R0}="Concluído")`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD7EBD3' } } } },
      { type: 'expression', formulae: [`AND(${dentro},OR($C${R0}="Não se aplica",$C${R0}="Cancelado"))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE4E4E4' } } } },
      { type: 'expression', formulae: [`AND(${dentro},'Painel de Controle'!$I${R0}<TODAY())`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF9B2C20' } } } },
      { type: 'expression', formulae: [dentro], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: OURO } } } },
      { type: 'expression', formulae: [`AND(TODAY()>=${A}$4,TODAY()<${A}$4+7)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: CREME } } } }] });
    wc.addConditionalFormatting({ ref: `${A}4:${Z}4`, rules: [{ type: 'expression', formulae: [`AND(TODAY()>=${A}$4,TODAY()<${A}$4+7)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: OURO } }, font: { bold: true, color: { argb: PRETO } } } }] });
    wc.addConditionalFormatting({ ref: `C${R0}:C${R1}`, rules: cfS() });
  }
  const lg = wc.getCell(R1 + 2, 2); lg.value = 'Barra dourada = em execução · vermelha escura = prazo vencido sem concluir · verde = concluído · coluna creme = semana atual'; lg.font = { name: 'Montserrat', size: 8.5, italic: true, color: { argb: 'FF7A7A7A' } };
  // Resumo
  const wr = wb.addWorksheet('Resumo'); wr.columns = [2, 34, 13, 3, 32, 8, 12, 13].map(w => ({ width: w }));
  cab(wr, 'C&S  ·  RESUMO DO ANDAMENTO', 8);
  const J = `'Painel de Controle'!$J$${R0}:$J$${Math.max(R1, R0)}`, B = `'Painel de Controle'!$B$${R0}:$B$${Math.max(R1, R0)}`, I = `'Painel de Controle'!$I$${R0}:$I$${Math.max(R1, R0)}`, H = `'Painel de Controle'!$H$${R0}:$H$${Math.max(R1, R0)}`;
  hdr(wr, 5, ['Status', 'Qtd'], 2); hdr(wr, 5, ['Onda', 'Itens', 'Concluídos', 'Prazo final'], 5);
  const cores = { 'Concluído': ['FFD7EBD3', 'FF2E6B2A'], 'Em andamento': ['FFF8E7B5', 'FF8A6100'], 'Em validação': ['FFDDE8F5', 'FF2A4F7A'], 'Bloqueado': ['FFF4D0CC', 'FF9B2C20'], 'Não iniciado': ['FFECEAE4', 'FF5C5446'], 'Não se aplica': ['FFE4E4E4', 'FF7A7A7A'], 'Cancelado': ['FFE4E4E4', 'FF7A7A7A'] };
  STL.forEach((s, i) => { const r = 6 + i, c = wr.getCell(r, 2); c.value = s; c.font = { name: 'Montserrat', bold: true, color: { argb: cores[s][1] } }; c.fill = fill(cores[s][0]); c.border = borda;
    const v = wr.getCell(r, 3); v.value = { formula: `COUNTIF(${J},"${s}")` }; v.font = { name: 'Montserrat', bold: true }; v.alignment = { horizontal: 'center' }; v.border = borda; });
  const rT = 6 + STL.length; wr.getCell(rT, 2).value = 'TOTAL'; wr.getCell(rT, 2).font = { name: 'Montserrat', bold: true }; wr.getCell(rT, 3).value = { formula: `SUM(C6:C${rT - 1})` }; wr.getCell(rT, 3).font = { name: 'Montserrat', bold: true }; wr.getCell(rT, 3).alignment = { horizontal: 'center' };
  S.ondas.forEach((o, i) => { const r = 6 + i; const nm = String(o.nome).replace(/"/g, '""');
    [[5, o.nome], [6, { formula: `COUNTIF(${B},"${nm}")` }], [7, { formula: `COUNTIFS(${B},"${nm}",${J},"Concluído")` }], [8, { formula: `SUMPRODUCT(MAX((${B}="${nm}")*${I}))` }]].forEach(([c, v]) => { const cel = wr.getCell(r, c); cel.value = v; cel.font = { name: 'Montserrat', bold: c === 5 }; cel.border = borda; cel.alignment = { horizontal: c === 5 ? 'left' : 'center', wrapText: c === 5 }; });
    wr.getCell(r, 5).fill = fill('FF' + String(o.cor || '#C79A3B').replace('#', '').toUpperCase()); wr.getCell(r, 8).numFmt = 'dd/mm/yyyy'; });
  const ind = [["% concluído (sem 'Não se aplica' e cancelados)", `IFERROR(C${6 + STL.indexOf('Concluído')}/(C${rT}-C${6 + STL.indexOf('Não se aplica')}-C${6 + STL.indexOf('Cancelado')}),0)`, '0%'],
    ['Itens atrasados', `COUNTIFS(${I},"<"&TODAY(),${J},"<>Concluído",${J},"<>Não se aplica",${J},"<>Cancelado")`],
    ['Vencem nos próximos 7 dias', `COUNTIFS(${I},">="&TODAY(),${I},"<="&(TODAY()+7),${J},"<>Concluído",${J},"<>Não se aplica",${J},"<>Cancelado")`],
    ['Início do cronograma', `MIN(${H})`, 'dd/mm/yyyy'], ['Fim do cronograma', `MAX(${I})`, 'dd/mm/yyyy']];
  ind.forEach(([l, f, nf], i) => { const r = rT + 2 + i; const a = wr.getCell(r, 2); a.value = l; a.font = { name: 'Montserrat', size: 10, bold: true, color: { argb: 'FF1F1F1F' } };
    const b = wr.getCell(r, 3); b.value = { formula: f }; b.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: OURO } }; b.alignment = { horizontal: 'center' }; if (nf) b.numFmt = nf; });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `Painel_${p.codigo}_${hojeISO()}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
  toast('Planilha exportada.');
}
