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
    const contentJson = JSON.stringify(content, null, 2);

    await commitFile({ token, owner, repo, branch, path: 'conteudo.json', text: contentJson, msg: 'chore: atualiza conteudo.json via CMS' });

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

