// =====================================================================
// CIMED · Sistema de Gestão de Projetos
// ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR
// =====================================================================

export const SUPABASE_URL = 'https://cjvzeacrswpjmoanucoz.supabase.co';

// Chave publishable (equivalente nova da antiga "anon"). Pode ficar visível:
// quem protege os dados é a RLS criada no 01-schema.sql.
export const SUPABASE_ANON_KEY = 'sb_publishable_1lAnQar90ILppiGDPOLKLg_s-qi7eaS';

// =====================================================================
// PESSOAS E NÍVEIS DE ACESSO
// =====================================================================
// O e-mail tem que ser IGUAL ao cadastrado em Authentication > Users.
//
// papel 'gestao'    -> tudo: as cinco abas, criar, editar, excluir, anexar
// papel 'controles' -> só as abas Quadro e Projetos, sem editar nada do
//                      projeto. Podem apenas marcar se o Compliance precisa
//                      acompanhar aquele projeto, e escrever a observação.
//
// ⚠️ TROQUE os dois e-mails de Compliance abaixo pelos reais e crie as
//    contas em Authentication > Users (com "Auto Confirm User" marcado).
//
// ⚠️ Quem NÃO estiver nesta lista entra como 'controles' (o acesso mais
//    restrito). É de propósito: conta criada no Supabase e esquecida aqui
//    não ganha acesso total. Se alguém reclamar que só vê duas abas, é
//    porque o e-mail dela não está escrito aqui exatamente igual.
export const PESSOAS = {
  'josianny.silva@grupocimed.com.br': { nome: 'Josianny', papel: 'gestao' },
  'melissa.dias@grupocimed.com.br':   { nome: 'Melissa',  papel: 'gestao' },

  'TROCAR.compliance1@grupocimed.com.br': { nome: 'Compliance 1', papel: 'controles' },
  'TROCAR.compliance2@grupocimed.com.br': { nome: 'Compliance 2', papel: 'controles' },
};

// Regras do semáforo (RAG). Ajuste os dias se quiser outro critério.
export const REGRAS = {
  diasAtencao: 7,      // entrega em até X dias -> amarelo
  diasParado: 21,      // sem atualização há mais de X dias -> amarelo
};

// Limite de tamanho por anexo, em MB.
export const LIMITE_ANEXO_MB = 25;
