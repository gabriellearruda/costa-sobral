/* =====================================================================
   C&S · Área Restrita — login único com verificação em 2 etapas
   Uso em cada sistema do portal:
     <script src="/app/vendor/supabase.js"></script>
     <script src="/app/config.js"></script>
     <script src="/portal/_comum/cs-auth.js"></script>
     const { sb, usuario } = await CSAuth.iniciar({ sistema: 'Custos Gerais', papeis: ['administrativo','diretoria'] });
   - A sessão vale para todos os sistemas em cservicos.com/portal (mesmo navegador).
   - O banco só libera dados para sessões que passaram pelo código do autenticador.
   ===================================================================== */
(function () {
  'use strict';
  const LOGO = '/app/icons/logo.png';
  const FRASES = [
    'Confiança se constrói no detalhe de cada plantão.',
    'Processo bem feito é o que o cliente não precisa ver.',
    'Cada posto coberto é uma promessa cumprida.',
    'Movendo confiança, gerando valor.',
    'Organização hoje é tranquilidade no fechamento do mês.'
  ];
  const MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

  const css = `
  html.cs-auth-pendente body > *:not(#cs-auth){display:none!important}
  #cs-auth{position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:1.15fr 1fr;font-family:'Montserrat',system-ui,sans-serif;color:#F5F5F0;background:#0D0D0D}
  #cs-auth *{box-sizing:border-box}
  #cs-auth .cs-brand{position:relative;overflow:hidden;padding:48px 56px;display:flex;flex-direction:column;justify-content:space-between;
    background:radial-gradient(900px 500px at 15% 0%,rgba(212,175,55,.16),transparent 60%),linear-gradient(160deg,#1A1A1A 0%,#0D0D0D 70%)}
  #cs-auth .cs-brand::before{content:"";position:absolute;inset:0;opacity:.07;pointer-events:none;
    background-image:linear-gradient(45deg,#D4AF37 1px,transparent 1px),linear-gradient(-45deg,#D4AF37 1px,transparent 1px);background-size:44px 44px}
  #cs-auth .cs-brand > *{position:relative}
  #cs-auth .cs-logo{height:58px;width:auto;align-self:flex-start}
  #cs-auth .cs-eyebrow{display:flex;gap:14px;align-items:center;font-size:12px;letter-spacing:.18em;color:#C0C0C0;font-weight:600}
  #cs-auth .cs-eyebrow i{display:inline-block;width:36px;height:1px;background:#D4AF37}
  #cs-auth .cs-eyebrow b{color:#D4AF37;font-weight:600}
  #cs-auth .cs-frase{font-family:'Playfair Display',Georgia,serif;font-size:clamp(28px,3.4vw,46px);line-height:1.15;margin:18px 0 0;max-width:15em;color:#F5F5F0}
  #cs-auth .cs-rodape{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#8f8f8a}
  #cs-auth .cs-form-lado{display:flex;align-items:center;justify-content:center;padding:40px 28px;background:#121212;border-left:1px solid rgba(212,175,55,.25)}
  #cs-auth .cs-card{width:100%;max-width:400px}
  #cs-auth h1{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:30px;margin:0 0 6px;color:#F5F5F0}
  #cs-auth .cs-sub{color:#b9b9b3;font-size:14px;line-height:1.5;margin:0 0 26px}
  #cs-auth label{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:600;color:#e7e7e2;margin:16px 0 8px}
  #cs-auth label a{font-weight:500;color:#D4AF37;text-decoration:underline;cursor:pointer;font-size:13px}
  #cs-auth .cs-campo{position:relative}
  #cs-auth input{width:100%;height:50px;border-radius:10px;border:1px solid #3a3a38;background:#0D0D0D;color:#F5F5F0;padding:0 46px 0 16px;font:inherit;font-size:15px;outline:none;transition:border-color .15s}
  #cs-auth input:focus{border-color:#D4AF37;box-shadow:0 0 0 3px rgba(212,175,55,.18)}
  #cs-auth input.cs-codigo{letter-spacing:.5em;text-align:center;font-size:22px;padding:0 12px;font-variant-numeric:tabular-nums}
  #cs-auth .cs-olho{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;color:#9b9b95;cursor:pointer;padding:6px;font-size:13px}
  #cs-auth .cs-btn{width:100%;height:52px;margin-top:24px;border:0;border-radius:10px;cursor:pointer;font:inherit;font-weight:700;font-size:15px;letter-spacing:.02em;color:#0D0D0D;
    background:linear-gradient(180deg,#E6C65A,#D4AF37 55%,#B8860B)}
  #cs-auth .cs-btn:disabled{opacity:.6;cursor:wait}
  #cs-auth .cs-link{display:block;margin-top:14px;text-align:center;color:#b9b9b3;font-size:13px;cursor:pointer;text-decoration:underline;background:none;border:0;width:100%;font-family:inherit}
  #cs-auth .cs-nota{margin-top:26px;padding-top:18px;border-top:1px solid #2a2a28;color:#9b9b95;font-size:12.5px;line-height:1.55}
  #cs-auth .cs-erro{min-height:20px;margin-top:12px;color:#ff8a7a;font-size:13px}
  #cs-auth .cs-ok{color:#9fd8a8}
  #cs-auth .cs-qr{display:flex;gap:16px;align-items:center;background:#F5F5F0;border-radius:12px;padding:12px;margin:6px 0 4px}
  #cs-auth .cs-qr img{width:150px;height:150px;flex:0 0 150px}
  #cs-auth .cs-qr small{color:#333;font-size:11.5px;line-height:1.45;word-break:break-all}
  #cs-auth ol{margin:0 0 6px;padding-left:20px;color:#d6d6d0;font-size:13px;line-height:1.65}
  #cs-auth .cs-mini{font-size:12px;color:#9b9b95}
  @media (max-width:860px){
    #cs-auth{grid-template-columns:1fr;grid-template-rows:auto 1fr;overflow:auto}
    #cs-auth .cs-brand{padding:24px 22px}
    #cs-auth .cs-frase{font-size:24px}
    #cs-auth .cs-rodape{display:none}
    #cs-auth .cs-form-lado{border-left:0;border-top:1px solid rgba(212,175,55,.25);align-items:flex-start}
  }`;

  const fontes = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let sb = null, raiz = null, opcoes = {}, resolver = null, rejeitar = null, emRecuperacao = false;

  function cliente() {
    if (sb) return sb;
    if (!window.supabase || !window.CS_CONFIG) throw new Error('Configuração do Supabase não carregada.');
    sb = window.supabase.createClient(window.CS_CONFIG.url, window.CS_CONFIG.chave, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cs-portal-auth' }
    });
    return sb;
  }

  function montar() {
    document.documentElement.classList.add('cs-auth-pendente');
    if (!document.getElementById('cs-auth-css')) {
      document.head.insertAdjacentHTML('beforeend', fontes);
      const st = document.createElement('style'); st.id = 'cs-auth-css'; st.textContent = css; document.head.appendChild(st);
    }
    raiz = document.getElementById('cs-auth');
    if (!raiz) { raiz = document.createElement('div'); raiz.id = 'cs-auth'; document.body.appendChild(raiz); }
    const hoje = new Date();
    const frase = FRASES[(hoje.getFullYear() * 400 + hoje.getMonth() * 31 + hoje.getDate()) % FRASES.length];
    raiz.innerHTML = `
      <section class="cs-brand">
        <img class="cs-logo" src="${LOGO}" alt="C&amp;S Soluções em Serviços Terceirizados">
        <div>
          <div class="cs-eyebrow"><i></i><b>ÁREA RESTRITA</b><span>${hoje.getDate()} ${MESES[hoje.getMonth()]} ${hoje.getFullYear()}</span></div>
          <p class="cs-frase">${esc(frase)}</p>
        </div>
        <div class="cs-rodape"><span>© ${hoje.getFullYear()} C&amp;S · Costa &amp; Sobral</span><span>Uso interno. O acesso é registrado.</span></div>
      </section>
      <section class="cs-form-lado"><div class="cs-card" id="cs-card"></div></section>`;
  }
  const card = () => raiz.querySelector('#cs-card');
  const erro = (msg, ok) => { const e = raiz.querySelector('.cs-erro'); if (e) { e.textContent = msg || ''; e.className = 'cs-erro' + (ok ? ' cs-ok' : ''); } };
  const ocupado = (b, txt) => { const btn = raiz.querySelector('.cs-btn'); if (btn) { btn.disabled = b; if (txt) btn.textContent = txt; } };

  function traduz(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login|invalid credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Confirme o e-mail pelo link enviado antes de entrar.';
    if (/invalid.*code|invalid totp|challenge/i.test(m)) return 'Código inválido ou expirado. Confira o aplicativo e tente de novo.';
    if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
    if (/password.*(6|characters|weak)/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
    if (/network|fetch/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
    return m || 'Não foi possível continuar.';
  }

  /* ---------- telas ---------- */
  function telaLogin(msg) {
    card().innerHTML = `
      <h1>Bom ter você aqui</h1>
      <p class="cs-sub">Entre com o seu e-mail cadastrado na C&amp;S${opcoes.sistema ? ` para abrir <b style="color:#D4AF37">${esc(opcoes.sistema)}</b>` : ''}.</p>
      <form id="cs-f" autocomplete="on" novalidate>
        <label for="cs-email">E-mail</label>
        <div class="cs-campo"><input id="cs-email" type="email" autocomplete="username" placeholder="voce@cservicos.com" required></div>
        <label for="cs-senha">Senha <a id="cs-esqueci">Esqueci a senha</a></label>
        <div class="cs-campo"><input id="cs-senha" type="password" autocomplete="current-password" placeholder="Sua senha" required>
          <button type="button" class="cs-olho" id="cs-olho" aria-label="Mostrar senha">ver</button></div>
        <button class="cs-btn" type="submit">Entrar</button>
        <div class="cs-erro" role="alert"></div>
      </form>
      <p class="cs-nota">Depois da senha, o portal pede o código de 6 dígitos do aplicativo autenticador no seu celular.</p>`;
    if (msg) erro(msg.texto || msg, msg.ok);
    const email = raiz.querySelector('#cs-email');
    try { email.value = localStorage.getItem('cs-portal-ultimo-email') || ''; } catch (e) {}
    (email.value ? raiz.querySelector('#cs-senha') : email).focus();
    raiz.querySelector('#cs-olho').onclick = () => { const s = raiz.querySelector('#cs-senha'); s.type = s.type === 'password' ? 'text' : 'password'; };
    raiz.querySelector('#cs-esqueci').onclick = () => telaEsqueci(email.value);
    raiz.querySelector('#cs-f').onsubmit = async ev => {
      ev.preventDefault();
      const e = email.value.trim().toLowerCase(), s = raiz.querySelector('#cs-senha').value;
      if (!e || !s) return erro('Informe e-mail e senha.');
      ocupado(true, 'Entrando…'); erro('');
      try {
        const { error } = await cliente().auth.signInWithPassword({ email: e, password: s });
        if (error) throw error;
        try { localStorage.setItem('cs-portal-ultimo-email', e); } catch (x) {}
        await avancar();
      } catch (x) { ocupado(false, 'Entrar'); erro(traduz(x)); }
    };
  }

  function telaEsqueci(emailAtual) {
    card().innerHTML = `
      <h1>Recuperar a senha</h1>
      <p class="cs-sub">Enviamos um link para o seu e-mail. Ao abrir o link, você define uma senha nova.</p>
      <form id="cs-f" novalidate>
        <label for="cs-email">E-mail</label>
        <div class="cs-campo"><input id="cs-email" type="email" value="${esc(emailAtual || '')}" required></div>
        <button class="cs-btn" type="submit">Enviar link</button>
        <div class="cs-erro" role="alert"></div>
      </form>
      <button class="cs-link" id="cs-voltar">Voltar para o login</button>`;
    raiz.querySelector('#cs-voltar').onclick = () => telaLogin();
    raiz.querySelector('#cs-f').onsubmit = async ev => {
      ev.preventDefault();
      const e = raiz.querySelector('#cs-email').value.trim().toLowerCase();
      if (!e) return erro('Informe o e-mail.');
      ocupado(true, 'Enviando…');
      try {
        const { error } = await cliente().auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        telaLogin({ texto: 'Se o e-mail estiver cadastrado, o link chega em instantes. Confira também o spam.', ok: true });
      } catch (x) { ocupado(false, 'Enviar link'); erro(traduz(x)); }
    };
  }

  function telaNovaSenha() {
    card().innerHTML = `
      <h1>Nova senha</h1>
      <p class="cs-sub">Use pelo menos 8 caracteres, com letras e números.</p>
      <form id="cs-f" novalidate>
        <label for="cs-s1">Nova senha</label><div class="cs-campo"><input id="cs-s1" type="password" autocomplete="new-password" required></div>
        <label for="cs-s2">Repita a senha</label><div class="cs-campo"><input id="cs-s2" type="password" autocomplete="new-password" required></div>
        <button class="cs-btn" type="submit">Salvar senha</button>
        <div class="cs-erro" role="alert"></div>
      </form>`;
    raiz.querySelector('#cs-s1').focus();
    raiz.querySelector('#cs-f').onsubmit = async ev => {
      ev.preventDefault();
      const a = raiz.querySelector('#cs-s1').value, b = raiz.querySelector('#cs-s2').value;
      if (a.length < 8 || !/[a-z]/i.test(a) || !/\d/.test(a)) return erro('A senha precisa ter pelo menos 8 caracteres, com letras e números.');
      if (a !== b) return erro('As duas senhas não são iguais.');
      ocupado(true, 'Salvando…');
      try {
        const { error } = await cliente().auth.updateUser({ password: a });
        if (error) throw error;
        emRecuperacao = false;
        history.replaceState(null, '', location.pathname + location.search);
        await avancar();
      } catch (x) { ocupado(false, 'Salvar senha'); erro(traduz(x)); }
    };
  }

  function telaCodigo(factorId) {
    card().innerHTML = `
      <h1>Verificação em 2 etapas</h1>
      <p class="cs-sub">Abra o aplicativo autenticador no celular e digite o código de 6 dígitos de <b>C&amp;S Portal</b>.</p>
      <form id="cs-f" novalidate>
        <label for="cs-cod">Código</label>
        <div class="cs-campo"><input id="cs-cod" class="cs-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>
        <button class="cs-btn" type="submit">Confirmar</button>
        <div class="cs-erro" role="alert"></div>
      </form>
      <button class="cs-link" id="cs-sair">Entrar com outro usuário</button>
      <p class="cs-nota">Perdeu o celular ou trocou de aparelho? Peça ao administrador do portal para liberar um novo cadastro do autenticador.</p>`;
    const cod = raiz.querySelector('#cs-cod'); cod.focus();
    cod.oninput = () => { cod.value = cod.value.replace(/\D/g, '').slice(0, 6); if (cod.value.length === 6) raiz.querySelector('#cs-f').requestSubmit(); };
    raiz.querySelector('#cs-sair').onclick = () => sair();
    raiz.querySelector('#cs-f').onsubmit = async ev => {
      ev.preventDefault();
      if (!/^\d{6}$/.test(cod.value)) return erro('Digite os 6 números do aplicativo.');
      ocupado(true, 'Confirmando…');
      try {
        const { error } = await cliente().auth.mfa.challengeAndVerify({ factorId, code: cod.value });
        if (error) throw error;
        await avancar();
      } catch (x) { ocupado(false, 'Confirmar'); cod.value = ''; cod.focus(); erro(traduz(x)); }
    };
  }

  async function telaCadastrar2fa() {
    card().innerHTML = `<h1>Ativar a verificação em 2 etapas</h1><p class="cs-sub">Preparando…</p>`;
    const c = cliente();
    try {
      const { data: lf } = await c.auth.mfa.listFactors();
      for (const f of ((lf && lf.all) || []).filter(f => f.status !== 'verified')) await c.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'C&S Portal', issuer: 'C&S Portal' });
      if (error) throw error;
      card().innerHTML = `
        <h1>Ativar a verificação em 2 etapas</h1>
        <p class="cs-sub">É feito uma vez só, leva 1 minuto.</p>
        <ol>
          <li>No celular, instale o <b>Google Authenticator</b> ou o <b>Microsoft Authenticator</b> (grátis).</li>
          <li>No aplicativo, toque em <b>+</b> e escolha <b>Ler código QR</b>.</li>
          <li>Aponte a câmera para o quadro abaixo.</li>
          <li>Digite aqui o código de 6 dígitos que aparecer em <b>C&amp;S Portal</b>.</li>
        </ol>
        <div class="cs-qr"><img alt="Código QR do autenticador" src="${esc(data.totp.qr_code)}">
          <small>Sem câmera? No aplicativo escolha <b>Inserir chave</b> e digite:<br><b>${esc(data.totp.secret)}</b></small></div>
        <form id="cs-f" novalidate>
          <label for="cs-cod">Código do aplicativo</label>
          <div class="cs-campo"><input id="cs-cod" class="cs-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
          <button class="cs-btn" type="submit">Ativar e entrar</button>
          <div class="cs-erro" role="alert"></div>
        </form>
        <button class="cs-link" id="cs-sair">Sair</button>`;
      const cod = raiz.querySelector('#cs-cod'); cod.focus();
      cod.oninput = () => { cod.value = cod.value.replace(/\D/g, '').slice(0, 6); };
      raiz.querySelector('#cs-sair').onclick = () => sair();
      raiz.querySelector('#cs-f').onsubmit = async ev => {
        ev.preventDefault();
        if (!/^\d{6}$/.test(cod.value)) return erro('Digite os 6 números do aplicativo.');
        ocupado(true, 'Ativando…');
        try {
          const r = await c.auth.mfa.challengeAndVerify({ factorId: data.id, code: cod.value });
          if (r.error) throw r.error;
          await avancar();
        } catch (x) { ocupado(false, 'Ativar e entrar'); cod.value = ''; cod.focus(); erro(traduz(x)); }
      };
    } catch (x) {
      card().innerHTML = `<h1>Não foi possível ativar</h1><p class="cs-sub">${esc(traduz(x))}</p><button class="cs-link" id="cs-sair">Voltar</button>`;
      raiz.querySelector('#cs-sair').onclick = () => sair();
    }
  }

  function telaSemAcesso(usuario) {
    card().innerHTML = `
      <h1>Sem acesso a este sistema</h1>
      <p class="cs-sub">${usuario && usuario.nome ? esc(usuario.nome) + ', seu' : 'Seu'} usuário entrou, mas não tem o papel necessário para ${opcoes.sistema ? '<b>' + esc(opcoes.sistema) + '</b>' : 'esta área'}.
      Se precisar, peça ao administrador do portal.</p>
      <button class="cs-btn" id="cs-portal">Ir para o portal</button>
      <button class="cs-link" id="cs-sair">Sair</button>`;
    raiz.querySelector('#cs-portal').onclick = () => { location.href = '/portal/'; };
    raiz.querySelector('#cs-sair').onclick = () => sair();
  }

  /* ---------- fluxo ---------- */
  async function avancar() {
    const c = cliente();
    if (emRecuperacao) return telaNovaSenha();
    const { data: s } = await c.auth.getSession();
    if (!s || !s.session) return telaLogin();
    const { data: aal, error: e1 } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
    if (e1) return telaLogin(traduz(e1));
    if (aal.currentLevel !== 'aal2') {
      const { data: lf } = await c.auth.mfa.listFactors();
      const ok = ((lf && lf.totp) || []).find(f => f.status === 'verified');
      return ok ? telaCodigo(ok.id) : telaCadastrar2fa();
    }
    const user = s.session.user;
    const { data: a, error: e2 } = await c.from('acessos').select('nome,email,papeis,ativo').eq('user_id', user.id).maybeSingle();
    if (e2) return telaLogin(traduz(e2));
    const papeis = (a && a.ativo && a.papeis) || [];
    const usuario = {
      id: user.id, email: user.email, nome: (a && a.nome) || user.email, papeis,
      tem: (...p) => papeis.includes('admin') || p.flat().some(x => papeis.includes(x))
    };
    const exige = opcoes.papeis || [];
    if (!papeis.length || (exige.length && !usuario.tem(exige))) return telaSemAcesso(usuario);
    raiz.remove(); raiz = null;
    document.documentElement.classList.remove('cs-auth-pendente');
    CSAuth.usuario = usuario;
    if (resolver) { const r = resolver; resolver = null; r({ sb: c, usuario }); }
  }

  async function sair() {
    try { await cliente().auth.signOut(); } catch (e) {}
    location.reload();
  }

  const CSAuth = {
    usuario: null,
    get sb() { return cliente(); },
    iniciar(opts) {
      opcoes = opts || {};
      return new Promise((res, rej) => {
        resolver = res; rejeitar = rej;
        const go = () => {
          try {
            montar();
            const c = cliente();
            if (/type=recovery/.test(location.hash)) emRecuperacao = true;
            c.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') { emRecuperacao = true; if (raiz) telaNovaSenha(); } });
            card().innerHTML = '<p class="cs-sub">Carregando…</p>';
            avancar().catch(x => telaLogin(traduz(x)));
          } catch (x) { rej(x); }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
      });
    },
    sair
  };
  window.CSAuth = CSAuth;
})();
