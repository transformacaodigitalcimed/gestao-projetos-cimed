// =====================================================================
// CIMED · Sistema de Gestão de Projetos
// ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR
// =====================================================================
//
// Onde achar estes dois valores:
//   Supabase > seu projeto > Project Settings > Data API
//     - Project URL          -> cole em SUPABASE_URL
//     - anon / public key    -> cole em SUPABASE_ANON_KEY
//
// A chave "anon" foi feita para ficar visível no navegador. Quem protege
// os dados é a regra de segurança (RLS) do arquivo 01-schema.sql, que só
// libera leitura e escrita para quem está logado.
// NUNCA cole aqui a chave "service_role".
//
// =====================================================================

export const SUPABASE_URL = 'https://cjvzeacrswpjmoanucoz.supabase.co';

// Chave publishable (equivalente nova da antiga "anon"). Pode ficar visível:
// quem protege os dados é a RLS criada no 01-schema.sql.
export const SUPABASE_ANON_KEY = 'sb_publishable_1lAnQar90ILppiGDPOLKLg_s-qi7eaS';

// Nome que aparece no sistema para cada e-mail cadastrado no Supabase.
// Confirme que são os mesmos e-mails criados em Authentication > Users.
export const PESSOAS = {
  'josianny.silva@grupocimed.com.br': 'Josianny',
  'melissa.dias@grupocimed.com.br': 'Melissa',
};

// Regras do semáforo (RAG). Ajuste os dias se quiser outro critério.
export const REGRAS = {
  diasAtencao: 7,      // entrega em até X dias -> amarelo
  diasParado: 21,      // sem atualização há mais de X dias -> amarelo
};
