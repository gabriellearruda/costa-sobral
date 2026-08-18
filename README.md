# 🛡️ C&S — Site Institucional

> **Movendo Confiança, Gerando Valor.**

Site institucional da **C&S Soluções e Serviços Ltda.**, empresa especializada em serviços terceirizados de portaria, limpeza e manutenção predial para condomínios, empresas e indústrias, sediada em Suzano, SP.

🔗 **[cservicos.com](https://cservicos.com)**

---

## ✨ Sobre o projeto

Site one-page desenvolvido com HTML e CSS puros — sem frameworks, sem dependências — com painel administrativo integrado para edição de conteúdo sem precisar mexer no código.

**Funcionalidades:**
- 📱 Layout responsivo (mobile, tablet, desktop)
- 🌙 Suporte a modo claro e escuro
- 💬 Botão flutuante de WhatsApp
- ✏️ Painel CMS admin para editar textos diretamente pelo navegador
- 🔒 Headers de segurança no painel admin (noindex, X-Frame-Options)
- 🗺️ Informações de contato, endereço e horários
- 🎨 Identidade visual fiel à marca (preto, ouro, prata)
- 🏷️ SEO completo: Open Graph, Schema LocalBusiness, canonical

**Seções do site:**
1. Hero com trust bar (4 diferenciais)
2. Quem somos + 4 pilares (Estratégia, Eficiência, Pessoas, Transparência)
3. Serviços: Portaria, Limpeza e Manutenção Predial
4. Segurança jurídica (empresa regularizada, CLT em dia)
5. Como funciona (4 passos)
6. Trabalhe conosco
7. Contato e rodapé

---

## 🚀 Deploy

Qualquer push na branch `master` atualiza o site automaticamente.

---

## ✏️ CMS — Painel Administrativo

O site conta com um painel admin para editar os textos sem abrir código.

**Acesso:** `/admin.html`

- Edite qualquer texto do site através de formulários visuais
- As alterações são salvas diretamente no `conteudo.json` via GitHub API
- O site atualiza automaticamente após o commit
- O painel está protegido com senha e não é indexado por buscadores

> **Segurança:** o admin exige token de acesso e está configurado com `X-Robots-Tag: noindex` e `X-Frame-Options: DENY` via `vercel.json`.

---

## 📁 Estrutura

```
site/
├── index.html        # Página principal (todo o conteúdo e estilos)
├── admin.html        # Painel CMS para edição de textos
├── conteudo.json     # Conteúdo editável pelo CMS
├── content.json      # Conteúdo legado (referência)
├── vercel.json       # Configuração de headers de segurança
├── .gitignore
└── img/
    └── seguranca-ativa.jpg  # Imagem da seção Segurança Ativa
```

---

## 📞 Contato da empresa

| | |
|---|---|
| 📍 Endereço | Av. Rio de Janeiro, 100 — Sl 03, Parque Suzano, Suzano — SP |
| 📱 WhatsApp | [(11) 92661-2817](https://wa.me/5511926612817) |
| 📸 Instagram | [@cs_facilities](https://www.instagram.com/cs_facilities) |
| 🕐 Horário | Segunda a Sexta, 09h–18h |
| 🔗 Repositório | [github.com/gabriellearruda/costa-sobral](https://github.com/gabriellearruda/costa-sobral) |

---

<p align="center">Feito com ❤️ como presente de Dia dos Pais</p>
