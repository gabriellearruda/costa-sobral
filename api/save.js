// api/save.js — Vercel Serverless Function
// Recebe o conteúdo do admin, gera o index.html e commita no GitHub.
// O Vercel detecta o commit e faz o deploy automaticamente (~30s).

// ── Rate limiting em memória ─────────────────────────────────────────────
// (reinicia quando a função fria é reciclada — suficiente para este caso de uso)
const attempts = new Map(); // ip → { count, firstAt }
const LIMIT = 5;            // máx tentativas
const WINDOW_MS = 15 * 60 * 1000; // janela de 15 minutos

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return { blocked: false };
  }
  if (entry.count >= LIMIT) {
    const retryIn = Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
    return { blocked: true, retryIn };
  }
  entry.count++;
  return { blocked: false };
}

function resetRateLimit(ip) {
  attempts.delete(ip);
}

// ── Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS: aceita origens configuradas (separadas por vírgula)
  const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'https://costa-sobral.vercel.app')
    .split(',').map(o => o.trim());
  const origin = req.headers.origin || '';
  const originOk = !origin || allowedOrigins.includes(origin);
  if (!originOk) {
    return res.status(403).json({ error: 'Origem não permitida' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // IP para rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

  // Ping de autenticação (sem publicar nada)
  const { password, content, ping } = req.body || {};

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rl = checkRateLimit(ip);
  if (rl.blocked) {
    return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${rl.retryIn}s.` });
  }

  // ── Autenticação ──────────────────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return res.status(500).json({ error: 'ADMIN_PASSWORD não configurado' });
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }

  // Senha correta → zera contador
  resetRateLimit(ip);

  // Ping de login (só valida senha, não publica)
  if (ping) return res.status(200).json({ ok: true });

  // ── Config GitHub ─────────────────────────────────────────────────────────
  const token  = process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    return res.status(500).json({
      error: 'Variáveis GITHUB_TOKEN, GITHUB_OWNER ou GITHUB_REPO não configuradas no Vercel.',
    });
  }

  if (!content || typeof content !== 'object') {
    return res.status(400).json({ error: 'Conteúdo inválido' });
  }

  try {
    const html        = generateHTML(content);
    const contentJson = JSON.stringify(content, null, 2);

    await Promise.all([
      commitFile({ token, owner, repo, branch, path: 'index.html',   text: html,        msg: 'chore: atualiza conteúdo via CMS' }),
      commitFile({ token, owner, repo, branch, path: 'content.json', text: contentJson, msg: 'chore: atualiza content.json via CMS' }),
    ]);

    return res.status(200).json({
      ok: true,
      message: 'Publicado! O site será atualizado em ~30 segundos.',
    });
  } catch (err) {
    console.error('[CMS save error]', err);
    return res.status(500).json({ error: err.message || 'Erro ao publicar' });
  }
}

// ── GitHub API helper ─────────────────────────────────────────────────────
async function commitFile({ token, owner, repo, branch, path, text, msg }) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Pega SHA atual do arquivo (necessário para atualizar)
  let sha;
  const getRes = await fetch(`${apiUrl}?ref=${branch}`, { headers });
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  }

  const body = {
    message: msg,
    content: Buffer.from(text, 'utf-8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(`GitHub: ${err.message}`);
  }
  return putRes.json();
}

// ── Gerador de HTML ───────────────────────────────────────────────────────
function generateHTML(d) {
  const waUrl = `https://wa.me/${d.contact_phone_wa}?text=${encodeURIComponent(d.contact_wa_msg || '')}`;
  const brand = d.brand_name || 'C&S';

  function parseTitle(raw = '') {
    return raw.replace(/\[([^\]]+)\]/g, '<em>$1</em>');
  }

  // Ícones dos serviços (stroke)
  const svcIcons = {
    seguranca: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M12 11l-1 4 1 1 1-1-1-4z"/><path d="M9 16l-2 1m8-1l2 1"/></svg>`,
    portaria:  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="2" width="12" height="20" rx="1"/><path d="M15 8h4l2 3-2 3h-4"/><circle cx="9" cy="12" r="1"/></svg>`,
    limpeza:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 22l7-7m0 0l2-6 4 4-6 2zm7-7l4-4a2 2 0 012.83 2.83L19 12"/><path d="M5 20l2-2"/></svg>`,
    predial:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>`,
    shield:    `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    coffee:    `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/></svg>`,
    home:      `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg>`,
  };

  // Ícones dos pilares (fill)
  const pilarIcons = {
    estrategia: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19 22H5v-2h14v2zm-3.5-9.5c0 2.485-2.686 4.5-5.5 4.5S4.5 14.985 4.5 12.5c0-1.87 1.4-3.472 3.5-4.215V7c0-1.105.895-2 2-2s2 .895 2 2v1.285c2.1.743 3.5 2.345 3.5 4.215zM12 5c-.828 0-1.5.672-1.5 1.5S11.172 8 12 8s1.5-.672 1.5-1.5S12.828 5 12 5z"/></svg>`,
    eficiencia: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>`,
    experiencia:`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
    solucao:    `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`,
  };

  const checkIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

  const servicesHTML = (d.services || []).map(s =>
    `      <div class="svc-card">
        <div class="svc-icon">${svcIcons[s.icon] || svcIcons.shield}</div>
        <h3>${s.title}</h3>
        <p>${s.desc}</p>
      </div>`
  ).join('\n');

  const pilaresHTML = (d.pilares || []).map(p =>
    `      <div class="pilar-card">
        <div class="pilar-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${(pilarIcons[p.icon] || pilarIcons.estrategia).replace(/^<svg[^>]*>/, '').replace('</svg>', '')}</svg></div>
        <h4>${p.title}</h4>
        <p>${p.desc}</p>
      </div>`
  ).join('\n');

  const saItemsHTML = (d.sa_items || []).map(item =>
    `        <li><span class="sa-check">${checkIcon}</span>${item}</li>`
  ).join('\n');

  const hoursHTML = (d.hours || []).map(h =>
    `          <tr><td>${h.day}</td><td class="${h.closed ? 'closed' : 'open'}">${h.closed ? 'Fechado' : h.open}</td></tr>`
  ).join('\n');

  const phone = d.contact_phone_wa || '';
  const phoneFmt = phone.length >= 12
    ? `+${phone.slice(0,2)}-${phone.slice(2,4)}-${phone.slice(4)}`
    : `+${phone}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${d.seo_title}</title>
  <meta name="description" content="${d.seo_desc}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="keywords" content="${d.seo_keywords}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${d.seo_url}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${d.seo_url}">
  <meta property="og:title" content="${d.og_title}">
  <meta property="og:description" content="${d.og_desc}">
  <meta property="og:locale" content="pt_BR">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"${brand} Soluções e Serviços","description":"Empresa especializada em serviços terceirizados: portaria, limpeza, segurança, manutenção predial.","url":"${d.seo_url}","telephone":"${phoneFmt}","address":{"@type":"PostalAddress","streetAddress":"${d.contact_addr1}","addressLocality":"Suzano","addressRegion":"SP","postalCode":"${(d.contact_cep||'').replace('CEP ','')}","addressCountry":"BR"},"geo":{"@type":"GeoCoordinates","latitude":-23.5426,"longitude":-46.3108},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday"],"opens":"09:00","closes":"18:00"}],"sameAs":["https://www.instagram.com/${d.contact_instagram}"]}
  <\/script>
  <style>
    :root{--gold:#D4A520;--gold-lt:#E8C050;--gold-dim:rgba(212,165,32,.15);--silver:#B8BCCC;--onyx:#0C0C0E;--slate:#161719;--ground:#F3F1EC;--surface:#FFFFFF;--text:#1A1B1E;--text-sub:#4A4E5C;--border-lt:rgba(212,165,32,.18);--border-dk:rgba(212,165,32,.22);--wa:#25D366;--open:#5EC882;}
    @media(prefers-color-scheme:dark){:root{--ground:#0C0C0E;--surface:#1A1B1E;--text:#EDEAE2;--text-sub:#8A8FA0;}}
    :root[data-theme="light"]{--ground:#F3F1EC;--surface:#FFFFFF;--text:#1A1B1E;--text-sub:#4A4E5C;}
    :root[data-theme="dark"]{--ground:#0C0C0E;--surface:#1A1B1E;--text:#EDEAE2;--text-sub:#8A8FA0;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    html{scroll-behavior:smooth;}
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ground);color:var(--text);line-height:1.65;}
    img{max-width:100%;display:block;} a{color:inherit;text-decoration:none;}
    .label{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);}
    .gold-rule{display:block;width:36px;height:2px;background:linear-gradient(90deg,var(--gold),transparent);margin:10px 0 22px;}
    .container{max-width:1120px;margin:0 auto;padding:0 24px;}
    nav{position:sticky;top:0;z-index:100;background:var(--onyx);border-bottom:1px solid var(--border-dk);}
    .nav-inner{display:flex;align-items:center;justify-content:space-between;height:62px;gap:20px;}
    .nav-brand{display:flex;align-items:center;gap:10px;font-family:Georgia,serif;font-size:1rem;font-weight:700;color:#EDEAE2;letter-spacing:.02em;}
    .nav-links{display:flex;gap:28px;list-style:none;}
    .nav-links a{font-size:.78rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--silver);transition:color .2s;}
    .nav-links a:hover{color:var(--gold);}
    .nav-cta{display:inline-flex;align-items:center;gap:8px;background:var(--wa);color:#fff;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:9px 18px;border-radius:4px;transition:opacity .2s;white-space:nowrap;}
    .nav-cta:hover{opacity:.88;}
    .hero{background:var(--onyx);position:relative;overflow:hidden;padding:96px 0 80px;}
    .hero::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(-52deg,transparent,transparent 48px,rgba(212,165,32,.03) 48px,rgba(212,165,32,.03) 49px);}
    .hero::after{content:'';position:absolute;top:-80px;right:-80px;width:520px;height:520px;background:radial-gradient(circle,rgba(212,165,32,.1) 0%,transparent 65%);pointer-events:none;}
    .hero-inner{position:relative;z-index:1;}
    .hero h1{font-family:Georgia,serif;font-size:clamp(2rem,4.5vw,3.4rem);font-weight:700;line-height:1.15;color:#EDEAE2;text-wrap:balance;margin-bottom:18px;}
    .hero h1 em{font-style:normal;color:var(--gold);}
    .hero-tagline{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--silver);border-left:2px solid var(--gold);padding-left:12px;margin-bottom:20px;}
    .hero-sub{font-size:1rem;color:var(--silver);max-width:500px;margin-bottom:36px;line-height:1.75;}
    .hero-actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}
    .btn-gold{display:inline-flex;align-items:center;gap:8px;background:var(--gold);color:var(--onyx);font-weight:700;font-size:.86rem;letter-spacing:.06em;text-transform:uppercase;padding:13px 26px;border-radius:4px;transition:background .2s,transform .15s;}
    .btn-gold:hover{background:var(--gold-lt);transform:translateY(-1px);}
    .btn-outline{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(212,165,32,.35);color:var(--silver);font-weight:600;font-size:.86rem;letter-spacing:.05em;text-transform:uppercase;padding:12px 22px;border-radius:4px;transition:border-color .2s,color .2s;}
    .btn-outline:hover{border-color:var(--gold);color:var(--gold);}
    .mvv{background:var(--slate);border-top:1px solid var(--border-dk);border-bottom:1px solid var(--border-dk);padding:52px 0;}
    .mvv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;}
    .mvv-item{padding:0 40px;border-right:1px solid var(--border-dk);}
    .mvv-item:first-child{padding-left:0;}
    .mvv-item:last-child{border-right:none;}
    .mvv-item h3{font-family:Georgia,serif;font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:14px;}
    .mvv-item p{font-size:.88rem;color:var(--silver);line-height:1.75;}
    .about{padding:88px 0;}
    .about-grid{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:start;}
    .about h2{font-family:Georgia,serif;font-size:clamp(1.5rem,2.8vw,2.2rem);font-weight:700;line-height:1.25;text-wrap:balance;margin-bottom:20px;}
    .about p{color:var(--text-sub);margin-bottom:14px;line-height:1.78;}
    .pilares-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .pilar-card{background:var(--onyx);border:1px solid var(--border-dk);border-radius:10px;padding:22px 20px 20px;transition:border-color .2s;}
    .pilar-card:hover{border-color:var(--gold);}
    .pilar-icon{font-size:1.5rem;margin-bottom:14px;color:var(--gold);display:flex;align-items:center;}
    .pilar-icon svg{width:26px;height:26px;fill:var(--gold);}
    .pilar-card h4{font-family:Georgia,serif;font-size:1rem;font-weight:700;color:#EDEAE2;margin-bottom:8px;}
    .pilar-card p{font-size:.8rem;color:var(--silver);line-height:1.6;}
    .services{padding:88px 0;background:var(--surface);border-top:1px solid var(--border-lt);border-bottom:1px solid var(--border-lt);}
    .section-head{margin-bottom:52px;}
    .section-head h2{font-family:Georgia,serif;font-size:clamp(1.5rem,2.8vw,2.2rem);font-weight:700;text-wrap:balance;max-width:520px;}
    .services-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;}
    .svc-card{background:var(--ground);border:1px solid var(--border-lt);border-radius:6px;padding:30px 24px;transition:border-color .2s,transform .2s;}
    .svc-card:hover{border-color:var(--gold);transform:translateY(-2px);}
    .svc-icon{width:42px;height:42px;background:var(--gold-dim);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:var(--gold);}
    .svc-card h3{font-family:Georgia,serif;font-size:1.05rem;font-weight:700;margin-bottom:8px;}
    .svc-card p{font-size:.88rem;color:var(--text-sub);line-height:1.65;}
    .seguranca-ativa{background:#080809;border-top:1px solid var(--border-dk);}
    .seguranca-ativa-inner{display:grid;grid-template-columns:1fr 1fr;align-items:center;}
    .seguranca-ativa-content{padding:80px 60px 80px 0;display:flex;flex-direction:column;justify-content:center;}
    .seguranca-ativa-content h2{font-family:Georgia,serif;font-size:clamp(1.8rem,3vw,2.6rem);font-weight:700;color:var(--gold);letter-spacing:.06em;margin-bottom:28px;text-transform:uppercase;}
    .seguranca-ativa-content .intro{font-size:.95rem;color:var(--silver);line-height:1.75;margin-bottom:32px;max-width:460px;}
    .seguranca-ativa-content .intro strong{color:#EDEAE2;}
    .sa-list{list-style:none;display:flex;flex-direction:column;gap:18px;}
    .sa-list li{display:flex;align-items:center;gap:14px;font-size:.93rem;color:#EDEAE2;}
    .sa-check{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;}
    .sa-check svg{stroke:#080809;}
    .seguranca-ativa-image{position:relative;overflow:hidden;align-self:center;border-radius:8px;}
    .seguranca-ativa-image img{width:100%;height:auto;object-fit:cover;object-position:center top;display:block;border-radius:8px;}
    .seguranca-ativa-image .img-placeholder{width:100%;height:100%;background:#1A1B1E;display:flex;align-items:center;justify-content:center;color:#2A2B2E;font-size:3rem;}
    .info{padding:88px 0;background:var(--onyx);border-top:1px solid var(--border-dk);}
    .info-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:72px;align-items:start;}
    .info h2{font-family:Georgia,serif;font-size:1.9rem;color:#EDEAE2;margin-bottom:8px;}
    .info-block{margin-bottom:28px;}
    .info-block .lbl{font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:5px;}
    .info-block .val{color:var(--silver);font-size:.93rem;line-height:1.65;}
    .info-block .val a{color:var(--gold-lt);}
    .info-block .val a:hover{text-decoration:underline;}
    .hours-table{width:100%;border-collapse:collapse;}
    .hours-table tr{border-bottom:1px solid rgba(212,165,32,.1);}
    .hours-table tr:last-child{border-bottom:none;}
    .hours-table td{padding:8px 0;font-size:.87rem;color:var(--silver);font-variant-numeric:tabular-nums;}
    .hours-table td:first-child{font-weight:600;padding-right:20px;color:#9094A4;}
    .hours-table .closed{color:#4A505E;}
    .hours-table .open{color:var(--open);font-weight:600;}
    .btn-wa{display:inline-flex;align-items:center;gap:10px;background:var(--wa);color:#fff;font-weight:700;font-size:.88rem;letter-spacing:.05em;text-transform:uppercase;padding:14px 26px;border-radius:6px;transition:opacity .2s,transform .15s;margin-top:28px;}
    .btn-wa:hover{opacity:.9;transform:translateY(-1px);}
    footer{background:#080809;border-top:1px solid rgba(212,165,32,.12);padding:32px 0;}
    .footer-inner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;}
    .footer-brand{font-family:Georgia,serif;font-size:.9rem;color:var(--silver);}
    .footer-brand strong{color:var(--gold);}
    .footer-right{text-align:right;}
    .footer-cnpj{font-size:.7rem;color:#4A505E;font-variant-numeric:tabular-nums;}
    .footer-copy{font-size:.7rem;color:#4A505E;margin-top:2px;}
    .fab{position:fixed;bottom:26px;right:26px;z-index:200;width:58px;height:58px;border-radius:50%;background:var(--wa);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 22px rgba(37,211,102,.38);transition:transform .2s,box-shadow .2s;}
    .fab:hover{transform:scale(1.1);box-shadow:0 6px 30px rgba(37,211,102,.55);}
    @media(max-width:920px){.about-grid{grid-template-columns:1fr;gap:40px;}.services-grid{grid-template-columns:1fr 1fr;}.info-grid{grid-template-columns:1fr;gap:40px;}.nav-links{display:none;}.nav-cta{display:none;}}
    @media(max-width:860px){.seguranca-ativa-inner{grid-template-columns:1fr;}.seguranca-ativa-content{padding:60px 0 48px;}.seguranca-ativa-image{min-height:320px;}}
    @media(max-width:560px){.nav-inner{height:56px;}.hero{padding:56px 0 48px;}.hero h1{font-size:1.75rem;}.hero-actions{flex-direction:column;align-items:stretch;}.btn-gold,.btn-outline{justify-content:center;text-align:center;}.mvv-grid{grid-template-columns:1fr;gap:32px;}.mvv-item{padding:0;border-right:none;border-bottom:1px solid var(--border-dk);padding-bottom:28px;}.mvv-item:last-child{border-bottom:none;padding-bottom:0;}.services-grid{grid-template-columns:1fr;}.btn-wa{width:100%;justify-content:center;}.footer-inner{flex-direction:column;align-items:flex-start;}.footer-right{text-align:left;}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;}}
  </style>
</head>
<body>

<a class="fab" href="${waUrl}" target="_blank" rel="noopener" aria-label="Fale conosco no WhatsApp">
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.477.643 4.8 1.77 6.82L2 30l7.37-1.93A13.93 13.93 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z" fill="#fff"/><path d="M22.4 19.6c-.32-.16-1.88-.93-2.17-1.03-.29-.1-.5-.16-.71.16-.21.32-.82 1.03-1.01 1.24-.18.21-.37.24-.69.08-.32-.16-1.34-.49-2.56-1.57-.94-.84-1.58-1.87-1.77-2.19-.18-.32-.02-.49.14-.65.15-.14.32-.37.48-.55.16-.18.21-.32.32-.53.1-.21.05-.4-.03-.55-.08-.16-.71-1.71-.97-2.34-.26-.62-.52-.53-.71-.54h-.6c-.21 0-.55.08-.83.4-.29.32-1.09 1.07-1.09 2.6s1.12 3.01 1.27 3.22c.16.21 2.19 3.35 5.32 4.7.74.32 1.32.51 1.77.65.74.24 1.42.2 1.95.12.6-.09 1.88-.77 2.14-1.51.26-.74.26-1.38.18-1.51-.08-.13-.29-.21-.6-.37z" fill="#25D366"/></svg>
</a>

<nav>
  <div class="container nav-inner">
    <div class="nav-brand">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2L4 6.5V13c0 4.97 3.83 9.63 9 10.93C18.17 22.63 22 17.97 22 13V6.5L13 2z" stroke="#D4A520" stroke-width="1.6" fill="none"/><path d="M13 2L4 6.5V13c0 4.97 3.83 9.63 9 10.93" stroke="#B8BCCC" stroke-width="1.6" fill="none"/><text x="13" y="15.5" text-anchor="middle" fill="#D4A520" font-family="Georgia,serif" font-size="7" font-weight="700">C&amp;S</text></svg>
      ${brand}
    </div>
    <ul class="nav-links">
      <li><a href="#sobre">Sobre</a></li>
      <li><a href="#servicos">Serviços</a></li>
      <li><a href="#contato">Contato</a></li>
    </ul>
    <a class="nav-cta" href="${waUrl}" target="_blank" rel="noopener">
      <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.477.643 4.8 1.77 6.82L2 30l7.37-1.93A13.93 13.93 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z"/></svg>
      Solicitar Orçamento
    </a>
  </div>
</nav>

<section class="hero">
  <div class="container hero-inner">
    <h1>${parseTitle(d.hero_title)}</h1>
    <div class="hero-tagline">${d.hero_tagline}</div>
    <p class="hero-sub">${d.hero_sub}</p>
    <div class="hero-actions">
      <a class="btn-gold" href="${waUrl}" target="_blank" rel="noopener">
        <svg width="15" height="15" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.477.643 4.8 1.77 6.82L2 30l7.37-1.93A13.93 13.93 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z"/></svg>
        ${d.hero_btn1_text}
      </a>
      <a class="btn-outline" href="#servicos">${d.hero_btn2_text}</a>
    </div>
  </div>
</section>

<div class="mvv">
  <div class="container">
    <div class="mvv-grid">
      <div class="mvv-item"><h3>Missão</h3><p>${d.mvv_missao}</p></div>
      <div class="mvv-item"><h3>Visão</h3><p>${d.mvv_visao}</p></div>
      <div class="mvv-item"><h3>Valores</h3><p>${d.mvv_valores}</p></div>
    </div>
  </div>
</div>

<section class="about" id="sobre">
  <div class="container about-grid">
    <div>
      <span class="label">Quem somos</span>
      <span class="gold-rule"></span>
      <h2>${d.about_title}</h2>
      <p>${d.about_p1}</p>
      <p>${d.about_p2}</p>
    </div>
    <div class="pilares-grid" style="align-self:start;">
${pilaresHTML}
    </div>
  </div>
</section>

<section class="services" id="servicos">
  <div class="container">
    <div class="section-head">
      <span class="label">O que oferecemos</span>
      <span class="gold-rule"></span>
      <h2>${d.services_title}</h2>
    </div>
    <div class="services-grid">
${servicesHTML}
    </div>
  </div>
</section>

<section class="seguranca-ativa">
  <div class="container seguranca-ativa-inner">
    <div class="seguranca-ativa-content">
      <h2>${d.sa_title}</h2>
      <p class="intro">${d.sa_intro}</p>
      <ul class="sa-list">
${saItemsHTML}
      </ul>
    </div>
    <div class="seguranca-ativa-image">
      <img src="${d.sa_img_src}" alt="${d.sa_img_alt}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <div class="img-placeholder" style="display:none;">🛡️</div>
    </div>
  </div>
</section>

<section class="info" id="contato">
  <div class="container info-grid">
    <div>
      <span class="label">Fale com a gente</span>
      <span class="gold-rule"></span>
      <h2>Onde estamos &amp; como nos encontrar</h2>
      <div class="info-block">
        <div class="lbl">Endereço</div>
        <div class="val">${d.contact_addr1}<br>${d.contact_addr2}<br>${d.contact_cep}</div>
      </div>
      <div class="info-block">
        <div class="lbl">Telefone / WhatsApp</div>
        <div class="val"><a href="tel:+${d.contact_phone_wa}">${d.contact_phone_display}</a></div>
      </div>
      <div class="info-block">
        <div class="lbl">Instagram</div>
        <div class="val"><a href="https://www.instagram.com/${d.contact_instagram}" target="_blank" rel="noopener">@${d.contact_instagram}</a></div>
      </div>
      <a class="btn-wa" href="${waUrl}" target="_blank" rel="noopener">
        <svg width="19" height="19" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.477.643 4.8 1.77 6.82L2 30l7.37-1.93A13.93 13.93 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z"/></svg>
        Enviar mensagem no WhatsApp
      </a>
    </div>
    <div>
      <span class="label">Horário de funcionamento</span>
      <span class="gold-rule"></span>
      <table class="hours-table" aria-label="Horário de funcionamento">
        <tbody>
${hoursHTML}
        </tbody>
      </table>
    </div>
  </div>
</section>

<footer>
  <div class="container footer-inner">
    <div class="footer-brand"><strong>${brand}</strong> — Soluções em Serviços Terceirizados</div>
    <div class="footer-right">
      <div class="footer-cnpj">CNPJ ${d.footer_cnpj} · ${d.footer_city}</div>
      <div class="footer-copy">${d.footer_copy}</div>
    </div>
  </div>
</footer>

</body>
</html>`;
}
