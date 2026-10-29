// C&S — configuração de conexão com o Supabase.
// Pegue os dois valores em: Supabase > Project Settings > API Keys (e Data API para a URL).
// A chave aqui é a PUBLICÁVEL (sb_publishable_... ou "anon"). NUNCA coloque a chave secreta / service_role.
window.CS_CONFIG = {
  url: 'COLE_AQUI_A_URL_DO_PROJETO',      // ex.: https://abcdefghijk.supabase.co
  chave: 'COLE_AQUI_A_CHAVE_PUBLICAVEL'   // ex.: sb_publishable_xxxxxxxx
};
