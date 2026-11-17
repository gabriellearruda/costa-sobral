# Estrutura do site cservicos.com — onde fica cada coisa

```
costa-sobral/
├── index.html          ← SITE institucional (página inicial do cservicos.com)
├── admin.html          ← painel de edição do site
├── conteudo.json       ← textos do site
├── content.json
├── img/                ← imagens do site
├── api/save.js         ← salva os textos do painel
├── sw.js               ← limpeza (não mexer)
├── vercel.json         ← regras de publicação (não mexer)
├── scripts/            ← conferência automática antes de publicar (não mexer)
│
├── app/                ← APP DO POSTO   → cservicos.com/app
│   ├── index.html, painel.html, treinamento.html, maquete.html
│   ├── config.js, dados.js, sw.js, manifest-*.json
│   ├── icons/  treino/  vendor/
│
└── portal/             ← PORTAL (Área Restrita) → cservicos.com/portal
    ├── index.html
    ├── _comum/cs-auth.js
    └── adm/custos/  adm/uniformes/  (e os próximos sistemas)
```

## Regras para subir arquivos pelo GitHub

1. **Antes de arrastar, abra a pasta certa no GitHub.** Arquivos do App vão **dentro de `app/`**; arquivos do Portal, **dentro de `portal/`**. Nunca solte arquivos do App na página inicial do repositório.
2. **O `index.html` da raiz é só o site.** Se um upload trouxer outro `index.html` para a raiz, ele substitui o site.
3. **Nunca suba** `.sql`, backups `.json`, planilhas ou PDFs da empresa. O repositório é público.

## Proteção automática

Antes de cada publicação, a Vercel roda `scripts/checar-estrutura.sh`. Se o site sumir da raiz, se o App for parar lá, se faltar o Portal ou se aparecer um `.sql` ou um backup, **a publicação é cancelada** e o site no ar continua como estava. O motivo aparece no log do deploy, em Vercel > Deployments.
