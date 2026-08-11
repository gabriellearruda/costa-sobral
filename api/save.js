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

  function parseTitle(raw = '') {
    return raw.replace(/\[([^\]]+)\]/g, '<em>$1</em>');
  }

  const svgMap = {
    shield:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    coffee:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
    home:     `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg>`,
    building: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
    school:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg>`,
    cart:     `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`,
  };

  const trustIcons = [
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M9 7h1m-1 4h1M5 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0zM21 14a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  ];

  const trustHTML = (d.trust_items || []).map((item, i) =>
    `      <div class="trust-item">${trustIcons[i] || trustIcons[0]} ${item}</div>`
  ).join('\n');

  const servicesHTML = (d.services || []).map(s =>
    `      <div class="svc-card">
        <div class="svc-icon">${svgMap[s.icon] || svgMap.shield}</div>
        <h3>${s.title}</h3>
        <p>${s.desc}</p>
      </div>`
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

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${d.seo_url}">
  <meta property="og:title" content="${d.og_title}">
  <meta property="og:description" content="${d.og_desc}">
  <meta property="og:locale" content="pt_BR">

  <!-- Schema.org LocalBusiness -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Costa & Sobral Soluções e Serviços",
    "description": "Empresa especializada em serviços terceirizados: portaria, limpeza, recepção corporativa e apoio operacional.",
    "url": "${d.seo_url}",
    "telephone": "${phoneFmt}",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "${d.contact_addr1}",
      "addressLocality": "Suzano",
      "addressRegion": "SP",
      "postalCode": "${(d.contact_cep || '').replace('CEP ', '')}",
      "addressCountry": "BR"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": -23.5426, "longitude": -46.3108 },
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "09:00", "closes": "18:00" }
    ],
    "sameAs": ["https://www.instagram.com/${d.contact_instagram}"]
  }
  <\/script>

  <style>
    :root{--gold:#D4A520;--gold-lt:#E8C050;--gold-dim:rgba(212,165,32,.15);--silver:#B8BCCC;--onyx:#0C0C0E;--slate:#161719;--ground:#F3F1EC;--surface:#FFFFFF;--text:#1A1B1E;--text-sub:#4A4E5C;--border-lt:rgba(212,165,32,.18);--border-dk:rgba(212,165,32,.22);--wa:#25D366;--open:#5EC882;}
    @media(prefers-color-scheme:dark){:root{--ground:#0C0C0E;--surface:#1A1B1E;--text:#EDEAE2;--text-sub:#8A8FA0;}}
    :root[data-theme="light"]{--ground:#F3F1EC;--surface:#FFFFFF;--text:#1A1B1E;--text-sub:#4A4E5C;}
    :root[data-theme="dark"]{--ground:#0C0C0E;--surface:#1A1B1E;--text:#EDEAE2;--text-sub:#8A8FA0;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    html{scroll-behavior:smooth;}
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ground);color:var(--text);line-height:1.65;}
    img{max-width:100%;display:block;}
    a{color:inherit;text-decoration:none;}
    .label{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);}
    .gold-rule{display:block;width:36px;height:2px;background:linear-gradient(90deg,var(--gold),transparent);margin:10px 0 22px;}
    .container{max-width:1120px;margin:0 auto;padding:0 24px;}
    nav{position:sticky;top:0;z-index:100;background:var(--onyx);border-bottom:1px solid var(--border-dk);}
    .nav-inner{display:flex;align-items:center;justify-content:space-between;height:62px;gap:20px;}
    .nav-brand{display:flex;align-items:center;gap:10px;font-family:Georgia,serif;font-size:1rem;font-weight:700;color:#EDEAE2;letter-spacing:.02em;}
    .nav-brand em{color:var(--gold);font-style:normal;}
    .nav-links{display:flex;gap:28px;list-style:none;}
    .nav-links a{font-size:.78rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--silver);transition:color .2s;}
    .nav-links a:hover{color:var(--gold);}
    .nav-cta{display:inline-flex;align-items:center;gap:8px;background:var(--wa);color:#fff;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:9px 18px;border-radius:4px;transition:opacity .2s;white-space:nowrap;}
    .nav-cta:hover{opacity:.88;}
    .hero{background:var(--onyx);position:relative;overflow:hidden;padding:96px 0 80px;}
    .hero::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(-52deg,transparent,transparent 48px,rgba(212,165,32,.03) 48px,rgba(212,165,32,.03) 49px);}
    .hero::after{content:'';position:absolute;top:-80px;right:-80px;width:520px;height:520px;background:radial-gradient(circle,rgba(212,165,32,.1) 0%,transparent 65%);pointer-events:none;}
    .hero-inner{display:grid;grid-template-columns:1fr 220px;gap:56px;align-items:center;position:relative;z-index:1;}
    .hero-eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:18px;}
    .hero-eyebrow .line{width:24px;height:1px;background:var(--gold);}
    .hero h1{font-family:Georgia,serif;font-size:clamp(2rem,4.5vw,3.4rem);font-weight:700;line-height:1.15;color:#EDEAE2;text-wrap:balance;margin-bottom:18px;}
    .hero h1 em{font-style:normal;color:var(--gold);}
    .hero-tagline{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--silver);border-left:2px solid var(--gold);padding-left:12px;margin-bottom:20px;}
    .hero-sub{font-size:1rem;color:var(--silver);max-width:500px;margin-bottom:36px;line-height:1.75;}
    .hero-actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}
    .btn-gold{display:inline-flex;align-items:center;gap:8px;background:var(--gold);color:var(--onyx);font-weight:700;font-size:.86rem;letter-spacing:.06em;text-transform:uppercase;padding:13px 26px;border-radius:4px;transition:background .2s,transform .15s;}
    .btn-gold:hover{background:var(--gold-lt);transform:translateY(-1px);}
    .btn-outline{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(212,165,32,.35);color:var(--silver);font-weight:600;font-size:.86rem;letter-spacing:.05em;text-transform:uppercase;padding:12px 22px;border-radius:4px;transition:border-color .2s,color .2s;}
    .btn-outline:hover{border-color:var(--gold);color:var(--gold);}
    .hero-badge{border:1px solid var(--border-dk);border-radius:8px;padding:28px 22px;text-align:center;background:rgba(26,27,30,.7);}
    .hero-badge .big{font-family:Georgia,serif;font-size:2.6rem;color:var(--gold);font-weight:700;line-height:1;margin-bottom:6px;}
    .hero-badge .sm{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--silver);}
    .trust-bar{background:var(--slate);border-top:1px solid var(--border-dk);border-bottom:1px solid var(--border-dk);padding:16px 0;}
    .trust-items{display:flex;flex-wrap:wrap;gap:8px 40px;align-items:center;justify-content:center;}
    .trust-item{display:flex;align-items:center;gap:8px;font-size:.76rem;font-weight:600;color:var(--silver);letter-spacing:.06em;text-transform:uppercase;}
    .trust-item svg{color:var(--gold);flex-shrink:0;}
    .about{padding:88px 0;}
    .about-grid{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:start;}
    .about h2{font-family:Georgia,serif;font-size:clamp(1.5rem,2.8vw,2.2rem);font-weight:700;line-height:1.25;text-wrap:balance;margin-bottom:20px;}
    .about p{color:var(--text-sub);margin-bottom:14px;line-height:1.78;}
    .services{padding:88px 0;background:var(--surface);border-top:1px solid var(--border-lt);border-bottom:1px solid var(--border-lt);}
    .section-head{margin-bottom:52px;}
    .section-head h2{font-family:Georgia,serif;font-size:clamp(1.5rem,2.8vw,2.2rem);font-weight:700;text-wrap:balance;max-width:520px;}
    .services-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
    .svc-card{background:var(--ground);border:1px solid var(--border-lt);border-radius:6px;padding:30px 24px;transition:border-color .2s,transform .2s;}
    .svc-card:hover{border-color:var(--gold);transform:translateY(-2px);}
    .svc-icon{width:42px;height:42px;background:var(--gold-dim);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:var(--gold);}
    .svc-card h3{font-family:Georgia,serif;font-size:1.05rem;font-weight:700;margin-bottom:8px;}
    .svc-card p{font-size:.88rem;color:var(--text-sub);line-height:1.65;}
    .clients{padding:72px 0;}
    .clients-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:36px;}
    .client-chip{display:flex;align-items:center;gap:9px;border:1px solid var(--border-lt);border-radius:100px;padding:9px 18px;font-size:.83rem;font-weight:600;color:var(--text-sub);background:var(--surface);}
    .client-chip svg{color:var(--gold);}
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
    @media(max-width:920px){.hero-inner{grid-template-columns:1fr;}.hero-badge{display:none;}.about-grid{grid-template-columns:1fr;gap:40px;}.services-grid{grid-template-columns:1fr 1fr;}.info-grid{grid-template-columns:1fr;gap:40px;}.nav-links{display:none;}.nav-cta{display:none;}}
    @media(max-width:560px){.nav-inner{height:56px;}.hero{padding:56px 0 48px;}.hero h1{font-size:1.75rem;}.hero-actions{flex-direction:column;align-items:stretch;}.btn-gold,.btn-outline{justify-content:center;text-align:center;}.services-grid{grid-template-columns:1fr;}.btn-wa{width:100%;justify-content:center;}.footer-inner{flex-direction:column;align-items:flex-start;}.footer-right{text-align:left;}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;}}
  </style>
</head>
<body>

<a class="fab" href="${waUrl}" target="_blank" rel="noopener" aria-label="Fale conosco no WhatsApp">
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M16 2C8.268 2 2 8.268 2 16c0 2.477.643 4.8 1.77 6.82L2 30l7.37-1.93A13.93 13.93 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z" fill="#fff"/>
    <path d="M22.4 19.6c-.32-.16-1.88-.93-2.17-1.03-.29-.1-.5-.16-.71.16-.21.32-.82 1.03-1.01 1.24-.18.21-.37.24-.69.08-.32-.16-1.34-.49-2.56-1.57-.94-.84-1.58-1.87-1.77-2.19-.18-.32-.02-.49.14-.65.15-.14.32-.37.48-.55.16-.18.21-.32.32-.53.1-.21.05-.4-.03-.55-.08-.16-.71-1.71-.97-2.34-.26-.62-.52-.53-.71-.54h-.6c-.21 0-.55.08-.83.4-.29.32-1.09 1.07-1.09 2.6s1.12 3.01 1.27 3.22c.16.21 2.19 3.35 5.32 4.7.74.32 1.32.51 1.77.65.74.24 1.42.2 1.95.12.6-.09 1.88-.77 2.14-1.51.26-.74.26-1.38.18-1.51-.08-.13-.29-.21-.6-.37z" fill="#25D366"/>
  </svg>
</a>

<nav>
  <div class="container nav-inner">
    <div class="nav-brand">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M13 2L4 6.5V13c0 4.97 3.83 9.63 9 10.93C18.17 22.63 22 17.97 22 13V6.5L13 2z" stroke="#D4A520" stroke-width="1.6" fill="none"/>
        <path d="M13 2L4 6.5V13c0 4.97 3.83 9.63 9 10.93" stroke="#B8BCCC" stroke-width="1.6" fill="none"/>
        <text x="13" y="15.5" text-anchor="middle" fill="#D4A520" font-family="Georgia,serif" font-size="7" font-weight="700">C&amp;S</text>
      </svg>
      Costa <em>&amp;</em> Sobral
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
    <div>
      <div class="hero-eyebrow">
        <span class="line"></span>
        <span class="label">${d.hero_eyebrow}</span>
      </div>
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
    <div class="hero-badge">
      <div class="big">SP</div>
      <div class="sm">Região metropolitana<br>de São Paulo</div>
    </div>
  </div>
</section>

<div class="trust-bar">
  <div class="container">
    <div class="trust-items">
${trustHTML}
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
      <p>${d.about_p3}</p>
    </div>
    <div class="hero-badge" style="align-self:start;max-width:220px;">
      <div class="big">SP</div>
      <div class="sm">Região metropolitana<br>de São Paulo</div>
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

<section class="clients">
  <div class="container">
    <span class="label">Segmentos que atendemos</span>
    <span class="gold-rule"></span>
    <div class="clients-row">
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16"/><rect x="9" y="10" width="6" height="11"/></svg>Empresas</div>
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>Indústrias</div>
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 14l9-5-9-5-9 5 9 5z"/></svg>Escolas</div>
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4"/></svg>Supermercados</div>
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg>Condomínios</div>
      <div class="client-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/></svg>Recepção corporativa</div>
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
    <div class="footer-brand">
      <strong>Costa &amp; Sobral</strong> — Soluções em Serviços Terceirizados
    </div>
    <div class="footer-right">
      <div class="footer-cnpj">CNPJ ${d.footer_cnpj} · ${d.footer_city}</div>
      <div class="footer-copy">${d.footer_copy}</div>
    </div>
  </div>
</footer>

</body>
</html>`;
}
