#!/bin/bash
# Roda na Vercel antes de cada publicação (vercel.json > ignoreCommand).
# Se a estrutura estiver errada, a publicação é CANCELADA e o site que está no ar continua como está.
# Saída 0 = cancela a publicação · saída 1 = pode publicar.
bloqueia() { echo "PUBLICAÇÃO BLOQUEADA: $1"; echo "Veja o ESTRUTURA.md na raiz do repositório."; exit 0; }

[ -f index.html ] || bloqueia "falta o index.html do site na raiz."
grep -q 'C&S Postos' index.html && bloqueia "o index.html da raiz é o App do posto. O App fica em app/index.html; a raiz é o site."
grep -q 'Portaria, Limpeza e Manutenção Predial' index.html || bloqueia "o index.html da raiz não parece ser o site institucional."
[ -f app/index.html ] && grep -q 'C&S Postos' app/index.html || bloqueia "app/index.html (App do posto) sumiu ou foi trocado."
[ -f portal/index.html ] || bloqueia "falta portal/index.html (Portal)."
for f in painel.html maquete.html dados.js config.js; do
  [ -f "$f" ] && echo "AVISO: $f está na raiz, mas é arquivo do App (o certo é app/$f). Pode apagar da raiz."
done
if command -v git >/dev/null 2>&1; then
  ruim=$(git ls-files 2>/dev/null | grep -iE '\.sql$|backup.*\.json$|(^|/)\.env' | head -1)
  [ -n "$ruim" ] && bloqueia "o arquivo $ruim não pode ir para o site (pode ter dados ou senhas)."
fi
echo "Estrutura conferida: site na raiz, App em /app, Portal em /portal. Publicando."
exit 1
