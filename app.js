// =====================================================================
// CIMED · Sistema de Gestão de Projetos
// Front-end estático (GitHub Pages) + Supabase (banco e login).
// Nenhuma configuração aqui: edite config.js.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PESSOAS, REGRAS, LIMITE_ANEXO_MB } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------- CONSTANTES
// =====================================================================
// PROGRAMAS
// Cada programa é um quadro com etapas próprias. Quem só enxerga um nem
// vê o alternador: para essa pessoa o sistema é o quadro dela e pronto.
//
// ETAPAS deixou de ser fixo — ele é recalculado quando o programa muda.
// =====================================================================
let ETAPAS = ['Prioritário', 'Protótipo e ajustes', 'Fila', 'Entregue', 'Congelado / Cancelado'];
let PILARES = [];   // [{ nome, curto, cor }] — vazio esconde o campo
const pilarDe = (nome) => PILARES.find((p) => p.nome === nome);
let ETAPA_PARADA = 'Congelado / Cancelado';
let ETAPA_ENTREGUE = 'Entregue';

// Troca o programa em foco: refaz as etapas e recorta os projetos.
// Filtrando na origem, todas as telas seguem funcionando sem saber que
// programas existem.
function aplicarPrograma(id) {
  estado.programaAtivo = id || '';

  const visiveis = estado.programas.filter(
    (pr) => !estado.programasVisiveis || estado.programasVisiveis.includes(pr.id));

  const alvo = visiveis.filter((pr) => !estado.programaAtivo || pr.id === estado.programaAtivo);

  // Em "Todos", o quadro mostra a união das etapas, na ordem dos programas
  const etapas = [];
  alvo.forEach((pr) => (pr.etapas || []).forEach((e) => {
    if (!etapas.some((x) => x.nome === e.nome)) etapas.push(e);
  }));

  // Pilares também vêm do programa: quem não tem, não vê o campo.
  PILARES = [];
  alvo.forEach((pr) => (pr.pilares || []).forEach((pl) => {
    if (!PILARES.some((x) => x.nome === pl.nome)) PILARES.push(pl);
  }));

  ETAPAS = etapas.map((e) => e.nome);
  ETAPA_ENTREGUE = etapas.find((e) => e.tipo === 'entregue')?.nome || 'Entregue';
  ETAPA_PARADA = etapas.find((e) => e.tipo === 'parada')?.nome || 'Congelado / Cancelado';

  const permitidos = new Set(alvo.map((pr) => pr.id));
  estado.projetos = estado.todosProjetos.filter(
    (p) => !p.programa_id || permitidos.has(p.programa_id));

  try { localStorage.setItem('programa', estado.programaAtivo); } catch { /* sem problema */ }
}
const STATUS = ['Não iniciado', 'Em mapeamento', 'Em construção', 'Em homologação',
                'Entregue', 'Em melhoria', 'Congelado', 'Cancelado', 'Descontinuado'];

// Status que já contam como entrega. "Em melhoria" é entrega viva: está
// rodando, o ganho já é real, e continua evoluindo. Por isso ela NÃO pode
// zerar o R$ capturado — se contasse como obra, mover um projeto no ar para
// melhoria apagaria o valor do painel.
const ENTREGUES = ['Entregue', 'Em melhoria'];

// A lista do banco pode ter status antigo que saiu daqui (ex.: 'Em ajustes',
// hoje 'Em homologação'). Mostrar o valor real evita que abrir a ficha de um
// projeto troque o status dele sem ninguém pedir.
const FAMILIAS_STATUS = [
  ['Em andamento',  ['Não iniciado', 'Em mapeamento', 'Em construção', 'Em homologação']],
  ['Concluído',     ['Entregue', 'Em melhoria']],
  ['Fora do fluxo', ['Congelado', 'Cancelado', 'Descontinuado']],
];

// As opções agrupadas, respeitando status antigo que já saiu da lista:
// ele vira um grupo "Outros" em vez de sumir e trocar o valor sozinho.
function opcoesStatus(atual) {
  const conhecidos = FAMILIAS_STATUS.flatMap(([, ss]) => ss);
  const extras = statusDisponiveis().filter((s) => !conhecidos.includes(s));
  const grupos = extras.length ? [...FAMILIAS_STATUS, ['Outros', extras]] : FAMILIAS_STATUS;

  return grupos.map(([rot, ss]) => `<optgroup label="${rot}">`
    + ss.map((s) => `<option${s === atual ? ' selected' : ''}>${esc(s)}</option>`).join('')
    + '</optgroup>').join('');
}

function statusDisponiveis() {
  const extras = [...new Set(estado.projetos.map((p) => p.status).filter(Boolean))]
    .filter((v) => !STATUS.includes(v))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return [...STATUS, ...extras];
}

// Status que tiram o projeto do fluxo: não cobram prazo e vivem na
// última coluna do Quadro.
const CONGELADOS = ['Congelado'];
const ENCERRADOS = ['Cancelado', 'Descontinuado'];
const FORA_DO_FLUXO = [...CONGELADOS, ...ENCERRADOS];

const RAG = {
  r: { nome: 'Atrasado',  cls: 'r', cor: 'var(--vermelho)' },
  a: { nome: 'Atenção',   cls: 'a', cor: 'var(--ambar)' },
  v: { nome: 'No prazo',  cls: 'v', cor: 'var(--verde)' },
  c: { nome: 'Entregue',  cls: 'c', cor: 'var(--entregue)' },
  m: { nome: 'Em melhoria', cls: 'm', cor: 'var(--melhoria)' },
  s: { nome: 'Sem prazo', cls: 'n', cor: 'var(--cinza-claro)' },
  z: { nome: 'Congelado', cls: 'z', cor: 'var(--congelado)' },
  x: { nome: 'Cancelado', cls: 'x', cor: 'var(--cancelado)' },
};
const ORDEM_RAG = ['r', 'a', 'v', 's', 'c', 'm', 'z', 'x'];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const BUCKET = 'anexos-projetos';

// =====================================================================
// NÍVEIS DE ACESSO
// 'gestao'    -> tudo.
// 'controles' -> Compliance: veem Quadro e Projetos, não editam o projeto,
//                só respondem se precisam acompanhar.
// ⚠️ Isto esconde e trava a interface. NÃO é uma barreira de banco de
//    dados: a RLS libera escrita para qualquer pessoa logada. Serve para
//    dar clareza de papel a colegas, não para conter quem quer burlar.
// =====================================================================
const PAPEIS = {
  gestao:    { abas: ['visao', 'quadro', 'cronograma', 'notificacoes'], editaProjeto: true },
  controles: { abas: ['quadro'],                                       editaProjeto: false },
};

const podeEditar = () => PAPEIS[estado.papel]?.editaProjeto === true;

const COMPLIANCE = {
  sim: { rot: 'Compliance acompanha', cls: 'sim' },
  nao: { rot: 'Compliance não precisa', cls: 'nao' },
};
const compChave = (v) => (v === true ? 'sim' : v === false ? 'nao' : '');

// ----------------------------------------------------------------- ESTADO
const estado = {
  usuario: null,
  nome: '',
  papel: 'gestao',
  projetos: [],
  comentarios: [],
  historico: [],
  anexos: [],
  tarefas: [],
  modelos: [],
  programas: [],
  programasVisiveis: null,   // null = enxerga todos
  programaAtivo: '',         // '' = Todos
  todosProjetos: [],
  lidoAte: null,
  view: 'visao',
  filtroRag: '',
  editando: null,
};

// ---------------------------------------------------------------- ATALHOS
const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HOJE = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

function paraData(v) {
  if (!v) return null;
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}
const dias = (de, ate) => Math.round((ate - de) / 86400000);

function fmtData(v) {
  const d = paraData(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '—';
}
function fmtQuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  if (min < 10080) return `há ${Math.round(min / 1440)} d`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
const fmtNum = (n, casas = 0) =>
  n === null || n === undefined || n === '' ? '—'
    : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtReal = (n) => (n ? 'R$ ' + fmtNum(n) : '—');
// taxa horária precisa dos centavos: R$ 60,76 arredondado para R$ 61
// muda a conta em mais de mil reais por ano.
const fmtReal2 = (n) => (n || n === 0 ? 'R$ ' + fmtNum(n, 2) : '—');

// Campo de dinheiro e de horas: aceita o jeito que a pessoa digita —
// 114000 · 114.000 · 114.000,00 · 47296,76 — e devolve número limpo.
// Tendo vírgula, ela é a decimal e os pontos são separador de milhar.
// Sem vírgula, um ponto sozinho com até duas casas também é decimal
// (quem cola de planilha em inglês escreve 47296.76).
function numBR(v) {
  const t = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!t) return null;
  let limpo;
  if (t.includes(',')) {
    limpo = t.replace(/\./g, '').replace(',', '.');
  } else {
    const partes = t.split('.');
    limpo = (partes.length === 2 && partes[1].length <= 2) ? t : t.replace(/\./g, '');
  }
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

// Sai do campo, ele se arruma: 114000 vira 114.000,00. Sem isso o número
// fica uma fileira de dígitos e ninguém sabe se são mil ou cem mil reais.
// ---------------------------------------------------------------- VALOR
// O ganho anual deixou de ser digitado: ele é horas/mês × custo da hora
// × 12. Antes os dois campos eram independentes e nada impedia alguém
// gravar 50 h/mês com um valor anual que não conversava com elas.
const ganhoAnual = (horas, taxa) =>
  (Number(horas) > 0 && Number(taxa) > 0) ? Number(horas) * Number(taxa) * 12 : null;

// Dois tipos de ganho, somados no total e separados quando importa:
//   porHoras  = capacidade liberada (vira dinheiro se houver realocação)
//   direto    = caixa que para de sair (licença, contrato encerrado)
// A diretoria pergunta justamente essa diferença, e somar numa coluna só
// fazia o painel prometer caixa onde havia capacidade.
const porHoras   = (p) => Number(p.custo_ano || 0);
const custoDireto = (p) => Number(p.custo_direto_ano || 0);
const valorAno   = (p) => porHoras(p) + custoDireto(p);

// Quantos meses o projeto roda DENTRO de um ano. Entregar em outubro não
// economiza doze meses em 2026: economiza três. Sem isso o painel conta
// como capturado um dinheiro que o ano ainda não viu.
//
// Regra: o mês da entrega conta inteiro (entregou em outubro, conta
// out/nov/dez = 3). `projetar` usa a data prevista de quem ainda não
// entregou, para responder "e se tudo sair no prazo?".
function mesesDeData(iso, ano) {
  if (!iso) return 0;
  const d = paraData(iso);
  if (!d || Number.isNaN(d.getTime())) return 0;
  if (d.getFullYear() > ano) return 0;
  if (d.getFullYear() < ano) return 12;
  return 12 - d.getMonth();
}

function mesesNoAno(p, ano, projetar) {
  if (FORA_DO_FLUXO.includes(p.status)) return 0;
  return mesesDeData(p.data_entrega || (projetar ? p.data_prevista : null), ano);
}

const capturadoNoAno = (p, ano, projetar) =>
  valorAno(p) * mesesNoAno(p, ano, projetar) / 12;

const somar = (ps, fn) => ps.reduce((s, p) => s + fn(p), 0);

function formatarCampoNumero(el) {
  if (!el) return;
  const n = numBR(el.value);
  if (n === null) { el.value = ''; return; }
  el.value = el.dataset.formato === 'moeda'
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

// =====================================================================
// CONFIRMAÇÃO — nada é apagado sem dizer antes o que se perde junto
// =====================================================================
let resolverConfirma = null;

function confirmar({ titulo, texto, perdas = [], rotulo = 'Excluir' }) {
  $('#confirmar-titulo').textContent = titulo;
  $('#confirmar-texto').textContent = texto;
  $('#confirmar-perdas').innerHTML = perdas.map((x) => `<li>${esc(x)}</li>`).join('');
  $('#confirmar-ok').textContent = rotulo;
  $('#confirmar').hidden = false;
  setTimeout(() => $('#confirmar-ok').focus(), 60);
  return new Promise((res) => { resolverConfirma = res; });
}

function fecharConfirma(resposta) {
  $('#confirmar').hidden = true;
  const r = resolverConfirma;
  resolverConfirma = null;
  if (r) r(resposta);
}

$('#confirmar-ok').addEventListener('click', () => fecharConfirma(true));

// =====================================================================
// CONFETE — a comemoração de quando um projeto é entregue
// =====================================================================
function soltarConfete() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const alvo = $('#confete');
  const cores = ['#FFD200', '#E8B800', '#0A6B4F', '#111111', '#FFF4C9'];
  alvo.innerHTML = Array.from({ length: 70 }, () => {
    const cor = cores[Math.floor(Math.random() * cores.length)];
    const esq = Math.random() * 100;
    const atraso = Math.random() * 0.5;
    const giro = Math.random() * 720 - 360;
    const dur = 2.2 + Math.random() * 1.4;
    return `<i style="left:${esq}%;background:${cor};animation-delay:${atraso}s;
             animation-duration:${dur}s;--giro:${giro}deg"></i>`;
  }).join('');
  alvo.hidden = false;
  clearTimeout(soltarConfete._t);
  soltarConfete._t = setTimeout(() => { alvo.hidden = true; alvo.innerHTML = ''; }, 4200);
}

function toast(msg, erro = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('erro', erro);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

// =====================================================================
// MENÇÕES — escrever "@Melissa" num comentário marca a pessoa. Nada de
// tabela nova: a menção é lida do próprio texto, comparando com PESSOAS.
// =====================================================================
const MENCIONAVEIS = [...new Set(Object.values(PESSOAS).map((p) => p.nome))];

// Responsável é sempre alguém do time de transformação: lista fechada.
// Quem executa o trabalho manual que será eliminado vai em "executante",
// que é campo livre — pode ser pessoa, dupla ou área inteira.
const TIME = [...new Set(Object.values(PESSOAS)
  .filter((p) => p.papel === 'gestao').map((p) => p.nome))]
  .sort((a, b) => a.localeCompare(b, 'pt-BR'));

const escapaRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// devolve os nomes marcados num texto
function mencionados(texto) {
  return MENCIONAVEIS.filter((n) =>
    new RegExp('@' + escapaRegex(n) + '\\b', 'i').test(texto || ''));
}

const mencionaMim = (texto) =>
  mencionados(texto).some((n) => n.toLowerCase() === estado.nome.toLowerCase());

// texto seguro + as menções destacadas
function textoComMencoes(texto) {
  let html = esc(texto);
  MENCIONAVEIS.forEach((n) => {
    const re = new RegExp('@' + escapaRegex(n) + '\\b', 'gi');
    const minha = n.toLowerCase() === estado.nome.toLowerCase();
    html = html.replace(re, (m) => `<b class="mencao${minha ? ' eu' : ''}">${m}</b>`);
  });
  return html;
}

// autocomplete: digitar "@" abre a lista de pessoas.
// A lista é criada aqui, então funciona em qualquer campo — basta chamar.
function ligarMencoes(txtSel) {
  const txt = $(txtSel);
  if (!txt) return;

  const pai = txt.parentElement;
  pai.classList.add('tem-mencao');
  const lista = document.createElement('ul');
  lista.className = 'mencoes';
  lista.hidden = true;
  pai.appendChild(lista);

  let opcoes = [];
  let ativo = 0;

  const fechar = () => { lista.hidden = true; opcoes = []; };

  const desenhar = () => {
    if (!opcoes.length) return fechar();
    lista.innerHTML = opcoes.map((n, i) =>
      `<li class="${i === ativo ? 'ativo' : ''}" data-nome="${esc(n)}">@${esc(n)}</li>`).join('');
    lista.hidden = false;
  };

  const inserir = (nome) => {
    const pos = txt.selectionStart;
    const antes = txt.value.slice(0, pos).replace(/@(\w*)$/, '@' + nome + ' ');
    txt.value = antes + txt.value.slice(pos);
    txt.focus();
    txt.setSelectionRange(antes.length, antes.length);
    fechar();
  };

  txt.addEventListener('input', () => {
    const trecho = txt.value.slice(0, txt.selectionStart).match(/@(\w*)$/);
    if (!trecho) return fechar();
    const busca = trecho[1].toLowerCase();
    opcoes = MENCIONAVEIS.filter((n) => n.toLowerCase().startsWith(busca));
    ativo = 0;
    desenhar();
  });

  txt.addEventListener('keydown', (e) => {
    if (lista.hidden || !opcoes.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); ativo = (ativo + 1) % opcoes.length; desenhar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = (ativo - 1 + opcoes.length) % opcoes.length; desenhar(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); inserir(opcoes[ativo]); }
    else if (e.key === 'Escape') { e.stopPropagation(); fechar(); }
  });

  lista.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-nome]');
    if (li) { e.preventDefault(); inserir(li.dataset.nome); }
  });

  txt.addEventListener('blur', () => setTimeout(fechar, 120));
}

// =====================================================================
// SEMÁFORO (RAG) — critério objetivo, calculado pela data. Ninguém escolhe
// a cor na mão: verde = no prazo, amarelo = precisa de decisão,
// vermelho = compromisso de data quebrado.
// =====================================================================
function calcRag(p) {
  // Projeto fora do fluxo não é cobrado por prazo: não faz sentido dizer
  // que um projeto cancelado está atrasado.
  if (ENCERRADOS.includes(p.status)) return { k: 'x', motivo: p.status };
  if (CONGELADOS.includes(p.status)) return { k: 'z', motivo: 'Congelado' };

  // Em melhoria vem antes de Entregue: ela também tem data de entrega, mas
  // merece cor própria — é o único jeito de enxergar no Quadro o que já está
  // no ar e ainda está sendo mexido.
  if (p.status === 'Em melhoria') return { k: 'm', motivo: 'No ar, em evolução' };
  if (ENTREGUES.includes(p.status) || p.data_entrega) return { k: 'c', motivo: 'Entregue' };
  if (!p.data_prevista) return { k: 's', motivo: 'Sem previsão de entrega definida' };

  const restam = dias(HOJE, paraData(p.data_prevista));
  if (restam < 0) return { k: 'r', motivo: `Atrasado há ${Math.abs(restam)} dia(s)`, d: restam };
  if (restam <= REGRAS.diasAtencao) return { k: 'a', motivo: restam === 0 ? 'Vence hoje' : `Vence em ${restam} dia(s)`, d: restam };

  if (p.atualizado_em && p.status !== 'Não iniciado') {
    const parado = dias(new Date(p.atualizado_em), HOJE);
    if (parado > REGRAS.diasParado) return { k: 'a', motivo: `Sem atualização há ${parado} dias`, d: restam };
  }
  return { k: 'v', motivo: `Faltam ${restam} dia(s)`, d: restam };
}

// =====================================================================
// AUTENTICAÇÃO
// =====================================================================
function nomeDe(email) {
  if (!email) return '';
  if (PESSOAS[email]?.nome) return PESSOAS[email].nome;
  const bruto = email.split('@')[0].split(/[._-]/)[0];
  return bruto.charAt(0).toUpperCase() + bruto.slice(1);
}

// Quem não está no config.js cai no papel mais restrito, nunca no mais
// amplo: conta criada no Supabase e esquecida aqui não ganha acesso total.
// O papel VALE O QUE ESTÁ NO BANCO (tabela perfis), porque é o banco que
// aplica as travas.
//
// Devolve null quando a conta NÃO está cadastrada. E null significa
// NENHUM acesso, não acesso reduzido: quem não está na lista não entra.
//
// O config.js só entra como reserva se a tabela perfis ainda não existir,
// para o sistema não se trancar antes de a atualização do banco rodar.
async function descobrirPapel(user) {
  const { data, error } = await sb.from('perfis')
    .select('papel, programas').eq('user_id', user.id).maybeSingle();

  if (error) {
    console.warn('Tabela perfis indisponível, usando o config.js:', error.message);
    return PESSOAS[user.email]?.papel || null;
  }
  // null aqui quer dizer "enxerga todos os programas"
  estado.programasVisiveis = data?.programas?.length ? data.programas : null;
  return data?.papel || null;
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-entrar');
  const erro = $('#login-erro');
  erro.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-senha').value,
  });

  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) {
    erro.textContent = error.message.includes('Invalid login')
      ? 'E-mail ou senha incorretos.'
      : 'Não foi possível entrar: ' + error.message;
    erro.hidden = false;
  }
});

async function sair() {
  await sb.auth.signOut();
  location.reload();
}
$('#btn-sair').addEventListener('click', sair);
$('#btn-sair-sem-acesso').addEventListener('click', sair);

sb.auth.onAuthStateChange((_evt, sessao) => {
  if (sessao?.user) iniciar(sessao.user);
});

(async () => {
  if (SUPABASE_URL.startsWith('COLE_AQUI')) {
    $('#login-erro').textContent = 'Configure o arquivo config.js com a URL e a chave do Supabase.';
    $('#login-erro').hidden = false;
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session?.user) iniciar(data.session.user);
})();

async function iniciar(user) {
  if (estado.usuario) return;
  const papel = await descobrirPapel(user);

  // Conta autenticada mas fora da lista: para aqui. Nada é carregado.
  if (!papel) {
    $('#tela-login').hidden = true;
    $('#email-sem-acesso').textContent = user.email;
    $('#tela-sem-acesso').hidden = false;
    return;
  }

  estado.usuario = user;
  estado.nome = nomeDe(user.email);
  estado.papel = papel;

  $('#tela-login').hidden = true;
  $('#app').hidden = false;
  $('#usuario').textContent = estado.nome;
  if (estado.papel === 'controles') {
    $('#usuario').textContent = estado.nome + ' · Compliance';
  }

  aplicarPapel();
  montarSelects();
  await carregarTudo();
  ligarTempoReal();
}

// Qual programa abrir: o último usado, se ainda for permitido; senão o
// único que a pessoa enxerga; senão "Todos".
function escolherPrograma() {
  const visiveis = estado.programas.filter(
    (pr) => !estado.programasVisiveis || estado.programasVisiveis.includes(pr.id));

  if (visiveis.length === 1) return visiveis[0].id;

  let guardado = '';
  try { guardado = localStorage.getItem('programa') || ''; } catch { /* sem problema */ }
  if (guardado && visiveis.some((pr) => pr.id === guardado)) return guardado;
  return '';
}

// O alternador só existe para quem enxerga mais de um programa.
function montarAlternador() {
  const visiveis = estado.programas.filter(
    (pr) => !estado.programasVisiveis || estado.programasVisiveis.includes(pr.id));

  const caixa = $('#troca-programa');
  const sel = $('#sel-programa');
  const fixo = $('#programa-fixo');

  if (visiveis.length <= 1) {
    caixa.hidden = true;
    fixo.textContent = visiveis[0]?.nome || '';
    fixo.hidden = !visiveis.length;
    return;
  }

  fixo.hidden = true;
  caixa.hidden = false;
  sel.innerHTML = '<option value="">Todos os programas</option>' +
    visiveis.map((pr) => `<option value="${pr.id}">${esc(pr.nome)}</option>`).join('');
  sel.value = estado.programaAtivo;
}

$('#sel-programa').addEventListener('change', (e) => {
  aplicarPrograma(e.target.value);
  montarSelects();
  renderTudo();
  toast(e.target.value
    ? estado.programas.find((pr) => pr.id === e.target.value)?.nome
    : 'Todos os programas');
});

// Esconde as abas que o papel não alcança e trava o que ele não edita.
function aplicarPapel() {
  const abas = PAPEIS[estado.papel]?.abas || PAPEIS.gestao.abas;
  $$('.nav-item').forEach((b) => { b.hidden = !abas.includes(b.dataset.view); });
  $('#sino').hidden = !abas.includes('notificacoes');
  if (!abas.includes(estado.view)) irPara(abas[0]);

  const dono = podeEditar();
  $('#btn-novo').hidden = !dono;
  document.body.classList.toggle('somente-compliance', !dono);
}

// =====================================================================
// DADOS
// =====================================================================
async function carregarTudo() {
  const [proj, com, hist, anx, tar, mod, prg, leit] = await Promise.all([
    sb.from('projetos').select('*').eq('arquivado', false),
    sb.from('comentarios').select('*').order('criado_em', { ascending: false }).limit(200),
    sb.from('historico').select('*').order('criado_em', { ascending: false }).limit(200),
    sb.from('anexos').select('*').order('criado_em', { ascending: false }),
    sb.from('tarefas').select('*').order('ordem', { ascending: true }),
    sb.from('modelos').select('*').order('nome', { ascending: true }),
    sb.from('programas').select('*').eq('ativo', true).order('ordem', { ascending: true }),
    sb.from('leituras').select('lido_ate').eq('user_id', estado.usuario.id).maybeSingle(),
  ]);

  const falha = proj.error || com.error || hist.error;
  $('#sync').className = 'sync ' + (falha ? 'erro' : 'ok');
  $('#sync').title = falha ? 'Erro de conexão: ' + falha.message : 'Conectado ao banco';
  if (falha) { toast('Erro ao carregar dados: ' + falha.message, true); return; }

  estado.todosProjetos = proj.data || [];
  estado.programas = prg.data || [];
  estado.comentarios = com.data || [];
  estado.historico = hist.data || [];
  // Sem erro fatal: se a tabela ainda não existe, o bloco só não aparece.
  estado.anexos = anx.data || [];
  estado.tarefas = tar.data || [];
  estado.modelos = mod.data || [];
  estado.lidoAte = leit.data?.lido_ate || null;

  if (anx.error) console.warn('Anexos indisponíveis — rode o 03:', anx.error.message);
  if (tar.error) console.warn('Tarefas indisponíveis — rode o 05:', tar.error.message);
  if (prg.error) console.warn('Programas indisponíveis — rode o 07:', prg.error.message);

  // sem a tabela de programas, o sistema segue como um quadro só
  if (!estado.programas.length) estado.projetos = estado.todosProjetos;
  else { montarAlternador(); aplicarPrograma(escolherPrograma()); }

  renderTudo();
}

function ligarTempoReal() {
  sb.channel('mudancas')
    .on('postgres_changes', { event: '*', schema: 'public' }, async () => {
      await carregarTudo();
    })
    .subscribe();
}

async function salvarProjeto(id, campos) {
  campos.atualizado_por = estado.nome;
  const r = id
    ? await sb.from('projetos').update(campos).eq('id', id).select().single()
    : await sb.from('projetos').insert(campos).select().single();
  if (r.error) throw r.error;
  return r.data;
}

// =====================================================================
// NAVEGAÇÃO
// =====================================================================
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('.nav-item');
  if (b) irPara(b.dataset.view);
});

// o sino ficou no canto, ao lado do nome, mas navega como as abas
$('#sino').addEventListener('click', () => irPara('notificacoes'));

$('#parados').addEventListener('toggle', (e) => {
  const d = e.target.closest('details');
  if (d) estado.abrirParados = d.open;
}, true);

// Clicar num indicador da Visão geral: filtra o Quadro, abre a aba e rola
// até a coluna correspondente. Sem isso o número é um beco sem saída.
function focarNoQuadro(filtro, etapa) {
  $('#busca').value = '';
  $('#filtro').value = filtro;
  if (etapa && etapa === ETAPA_PARADA) estado.abrirParados = true;

  irPara('quadro');
  renderQuadro();
  if (!etapa) return;

  // espera o scroll suave para o topo terminar, senão os dois brigam
  setTimeout(() => {
    const alvo = etapa === ETAPA_PARADA
      ? $('#parados .kparados')
      : [...$$('#kanban .kcol')].find((c) => c.dataset.etapa === etapa);
    if (!alvo) return;

    const box = $('#kanban');
    if (box.contains(alvo)) {
      const dx = alvo.getBoundingClientRect().left - box.getBoundingClientRect().left;
      box.scrollTo({ left: box.scrollLeft + dx - (box.clientWidth - alvo.offsetWidth) / 2,
                     behavior: 'smooth' });
    } else {
      alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    alvo.classList.add('focada');
    setTimeout(() => alvo.classList.remove('focada'), 2400);
  }, 360);
}

$('#kpis').addEventListener('click', (e) => {
  const k = e.target.closest('[data-foco]');
  if (k) focarNoQuadro(k.dataset.foco, k.dataset.col || '');
});

// O conceito de cada pilar mora no banco, com as palavras do Deco, e
// aparece exatamente onde alguém classifica um projeto. Antes o critério
// existia só na memória de quem esteve na reunião.
function mostrarCriterioPilar() {
  const pl = pilarDe($('#f-pilar').value);
  const el = $('#pilar-criterio');
  el.hidden = !pl || !(pl.desc || pl.metrica);
  if (el.hidden) { $('#campo-nps').hidden = true; return; }

  el.innerHTML = (pl.desc ? `<span class="pc-desc">${esc(pl.desc)}</span>` : '')
    + (pl.metrica ? `<span class="pc-metrica">Como se mede: ${esc(pl.metrica)}</span>` : '');

  // o campo de NPS só aparece no pilar que o usa como régua
  $('#campo-nps').hidden = !/NPS/i.test(pl.metrica || '');
}

$('#f-pilar').addEventListener('change', mostrarCriterioPilar);

function irPara(view) {
  estado.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('ativo', b.dataset.view === view));
  $('#sino').classList.toggle('ativo', view === 'notificacoes');
  $$('.view').forEach((s) => s.classList.toggle('ativa', s.id === 'view-' + view));
  if (view === 'cronograma') renderGantt();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// A lista suspensa de Responsável e Solicitante: quem já é responsável por
// algum projeto, mais todo mundo com login. Continua aceitando nome novo.
function montarListaPessoas() {
  const ordenar = (a, b) => a.localeCompare(b, 'pt-BR');
  const opcoes = (ns) => ns.map((n) => `<option value="${esc(n)}"></option>`).join('');

  // menções e responsáveis de tarefa: o time inteiro
  $('#lista-pessoas').innerHTML = opcoes([...new Set([...MENCIONAVEIS])].sort(ordenar));

  // solicitante: cresce sozinho com quem já foi cadastrado
  $('#lista-solicitantes').innerHTML = opcoes(
    [...new Set(estado.projetos.map((p) => p.solicitante).filter(Boolean))].sort(ordenar));

  // quem executa: idem, mais os responsáveis antigos que vieram de lá
  $('#lista-executantes').innerHTML = opcoes([...new Set([
    ...estado.projetos.map((p) => p.executante).filter(Boolean),
    ...estado.projetos.map((p) => p.responsavel).filter((r) => r && !TIME.includes(r)),
  ])].sort(ordenar));
}

// A lista fechada tolera o valor antigo do projeto aberto. Sem isso,
// abrir uma ficha de alguém de fora do time trocaria o responsável em
// silêncio pelo primeiro nome da lista.
function montarResponsaveis(atual) {
  const fora = atual && !TIME.includes(atual);
  $('#f-responsavel').innerHTML = '<option value="">Sem responsável</option>'
    + TIME.map((n) => `<option${n === atual ? ' selected' : ''}>${esc(n)}</option>`).join('')
    + (fora ? `<option selected value="${esc(atual)}">${esc(atual)} — fora do time</option>` : '');
}

function renderTudo() {
  montarSelects();     // as etapas mudam junto com o programa
  renderVisao();
  renderFiltros();
  montarListaPessoas();
  renderNotificacoes();
  if (estado.view === 'cronograma') renderGantt();
  $('#rodape-atualizacao').textContent = 'Atualizado ' + fmtQuando(new Date().toISOString());
}

// =====================================================================
// VISÃO GERAL
// =====================================================================
function renderVisao() {
  const ps = estado.projetos;
  const cont = Object.fromEntries(ORDEM_RAG.map((k) => [k, 0]));
  ps.forEach((p) => cont[calcRag(p).k]++);

  const ativos = ps.filter((p) => !ENTREGUES.includes(p.status) && !FORA_DO_FLUXO.includes(p.status));
  const entregues = ps.filter((p) => ENTREGUES.includes(p.status));
  const melhorias = ps.filter((p) => p.status === 'Em melhoria');
  const parados = ps.filter((p) => FORA_DO_FLUXO.includes(p.status));

  $('#visao-sub').textContent =
    `${ps.length} projetos · ${ativos.length} em andamento · ${entregues.length} entregues`
    + (parados.length ? ` · ${parados.length} fora do fluxo` : '');

  renderValor(ps);
  renderPilares(ps);
  renderRitmo(ps);
  renderCarga(ativos);

  // Cada indicador é um botão: leva ao Quadro já filtrado e, quando existe
  // uma coluna correspondente, rola até ela. Ler o número e não conseguir
  // chegar nos projetos por trás dele era um beco sem saída.
  $('#kpis').innerHTML = [
    ['destaque', 'Em andamento', ativos.length, 'de ' + ps.length + ' no portfólio',
     'foco::andamento', ''],
    ['r', 'Atrasados', cont.r, 'prazo vencido', 'rag::r', ''],
    ['c', 'Entregues', entregues.length,
     melhorias.length ? melhorias.length + ' ainda em melhoria' : 'desde o início do programa',
     'foco::entregues', ETAPA_ENTREGUE],
    ['z', 'Congelados e cancelados', parados.length, 'fora do fluxo',
     'foco::parados', ETAPA_PARADA],
  ].map(([cls, rot, num, pe, foco, col]) => `
    <button type="button" class="kpi ${cls}" data-foco="${esc(foco)}" data-col="${esc(col)}"
            title="Ver estes projetos no Quadro">
      <span class="kpi-rot">${esc(rot)}</span>
      <span class="kpi-num">${esc(num)}</span>
      <span class="kpi-pe">${esc(pe)}</span>
      <span class="kpi-ir">ver no quadro →</span>
    </button>`).join('');

  // barra de saúde
  const total = ps.length || 1;
  $('#barra-rag').innerHTML = ORDEM_RAG
    .filter((k) => cont[k])
    .map((k) => `<span style="width:${(cont[k] / total) * 100}%;background:${RAG[k].cor}"></span>`)
    .join('');

  const legenda = ORDEM_RAG.map((k) =>
    `<li><i style="background:${RAG[k].cor}"></i><b>${cont[k]}</b> ${RAG[k].nome}</li>`).join('');
  $('#legenda-rag').innerHTML = legenda;
  $('#legenda-gantt').innerHTML = legenda;

  // atenção imediata
  const urgentes = ps
    .map((p) => ({ p, r: calcRag(p) }))
    .filter((x) => x.r.k === 'r' || x.r.k === 'a')
    .sort((a, b) => (a.r.d ?? 999) - (b.r.d ?? 999))
    .slice(0, 8);

  $('#lista-atencao').innerHTML = urgentes.length
    ? urgentes.map(({ p, r }) => `
        <li>
          <span class="pill ${RAG[r.k].cls}">${RAG[r.k].nome}</span>
          <span class="nome" data-abrir="${p.id}">${esc(p.nome)}</span>
          <span class="quando" style="color:${RAG[r.k].cor}">${esc(r.motivo)}</span>
        </li>`).join('')
    : '<li class="vazio">Nenhum projeto em risco de prazo. Tudo dentro do combinado.</li>';

  renderQuadro();
}

// ---------------------------------------------------- VALOR DO PROGRAMA
// O KPI antigo somava o custo evitado do portfólio inteiro, misturando o
// que já foi entregue com o que nem começou. Isso inflava o número e não
// respondia a pergunta que a diretoria faz: quanto disso já é real.
function renderValor(ps) {
  const faixas = [
    { k: 'feito', rot: 'Já entregue', cor: 'var(--entregue)',
      desc: 'ganho capturado, rodando hoje',
      itens: ps.filter((p) => ENTREGUES.includes(p.status)) },
    { k: 'andando', rot: 'Em construção', cor: 'var(--amarelo-esc)',
      desc: 'a caminho, com data marcada',
      itens: ps.filter((p) => !ENTREGUES.includes(p.status) && !FORA_DO_FLUXO.includes(p.status)
                              && p.etapa !== 'Fila') },
    { k: 'fila', rot: 'Na fila', cor: 'var(--cinza-claro)',
      desc: 'potencial ainda não iniciado',
      itens: ps.filter((p) => p.etapa === 'Fila' && !FORA_DO_FLUXO.includes(p.status)) },
  ];

  faixas.forEach((f) => {
    f.rs = f.itens.reduce((s, p) => s + valorAno(p), 0);
    f.hs = f.itens.reduce((s, p) => s + Number(p.horas_mes || 0), 0);
    // Projeto sem horas e sem custo entra na contagem mas não soma nada.
    // Entregar um desses mexe o "6" e não mexe o R$ — e aí parece que o
    // painel travou. Dizer quantos são tira o mistério.
    // Quem declarou que não tem ganho financeiro não é falta de
    // preenchimento: é decisão registrada. Não entra no aviso.
    f.semValor = f.itens.filter((p) =>
      !valorAno(p) && !Number(p.horas_mes) && !p.sem_ganho_financeiro).length;
  });

  const total = faixas.reduce((s, f) => s + f.rs, 0) || 1;
  const feito = faixas[0].rs;

  // O destaque é o que o ANO realmente capturou, não o valor anual cheio.
  // Um projeto entregue em agosto rendeu cinco meses em 2026, não doze —
  // e era isso que o número antigo prometia sem querer.
  const ANO = HOJE.getFullYear();
  const realizado = somar(ps, (p) => capturadoNoAno(p, ANO, false));
  const previsto  = somar(ps, (p) => capturadoNoAno(p, ANO, true));
  const proximo   = somar(ps, (p) => capturadoNoAno(p, ANO + 1, true));

  $('#valor-total').innerHTML = `
    <span class="valor-num">${fmtReal(realizado)}</span>
    <span class="valor-rot">capturado em ${ANO}
      · de ${fmtReal(feito)}/ano já no ar</span>`;

  // Caixa e capacidade são ganhos de naturezas diferentes. Mostrar os dois
  // evita prometer dinheiro onde o que existe é hora liberada.
  const caixa = somar(ps, (p) => custoDireto(p));
  const horas = somar(ps, (p) => porHoras(p));
  const outroCriterio = ps.filter((p) => p.sem_ganho_financeiro).length;
  const semValor = faixas.reduce((s, f) => s + f.semValor, 0);
  const baseRH = custoEstrutura();
  const pctRH = baseRH ? ((caixa + horas) / baseRH * 100).toFixed(1).replace('.', ',') + '%' : '';
  $('#valor-tipos').innerHTML = caixa ? `
    <span class="vt caixa"><b>${fmtReal(caixa)}</b>/ano em custo direto
      <small>licenças e contratos que deixam de ser pagos</small></span>
    <span class="vt cap"><b>${fmtReal(horas)}</b>/ano em horas liberadas
      <small>${fmtNum(hcEquivalente(somar(ps, (p) => Number(p.horas_mes || 0))), 2)} pessoas
        em tempo integral${pctRH ? ` · ${pctRH} do custo de RH` : ''}</small></span>` : '';

  // Tudo que está FORA da conta do dinheiro, numa frase só, no rodapé.
  const fora = [];
  if (semValor) fora.push(`<b>${semValor}</b> ainda sem valor informado`);
  if (outroCriterio) fora.push(`<b>${outroCriterio}</b> sem ganho financeiro por decisão`);
  $('#valor-rodape').innerHTML = fora.length
    ? 'Fora desta conta: ' + fora.join(' · ') : '';

  $('#valor-anos').innerHTML = `
    <div class="ano-bloco">
      <div class="ano-rot">Previsão de fechar ${ANO}</div>
      <div class="ano-num">${fmtReal(previsto)}</div>
      <div class="ano-pe">se tudo que tem data entregar no prazo</div>
    </div>
    <div class="ano-bloco proj">
      <div class="ano-rot">Projetado para ${ANO + 1}</div>
      <div class="ano-num">${fmtReal(proximo)}</div>
      <div class="ano-pe">ano cheio de tudo que estiver rodando</div>
    </div>`;

  $('#valor-barra').innerHTML = faixas
    .filter((f) => f.rs)
    .map((f) => `<span style="width:${(f.rs / total) * 100}%;background:${f.cor}"
                       title="${esc(f.rot)}: ${fmtReal(f.rs)}"></span>`).join('');

  $('#valor-blocos').innerHTML = faixas.map((f) => `
    <div class="valor-bloco">
      <span class="vb-marca" style="background:${f.cor}"></span>
      <div>
        <div class="vb-rot">${esc(f.rot)} <b>${f.itens.length}</b></div>
        <div class="vb-num">${fmtReal(f.rs)}<small>/ano</small></div>
        <div class="vb-pe">${f.hs ? fmtNum(f.hs, 1) + ' h/mês · ' : ''}${esc(f.desc)}</div>
      </div>
    </div>`).join('');
}

// --------------------------------------------------- FRENTES POR PILAR
// É o recorte do deck: quantas frentes, quanto valem e em que fase estão.
// Sai do banco, então não precisa ser refeito à mão a cada apresentação.
// Um profissional em tempo integral = 176 h/mês (jornada de 44h de Pouso
// Alegre). O Deco pediu "horas e HC": HC não vira coluna no banco, é esta
// divisão — guardar número derivável é criar duas versões da verdade.
const HORAS_INTEGRAL = 176;
const hcEquivalente = (horas) => horas / HORAS_INTEGRAL;

// Denominador do "% do custo operacional", que ele pediu. Vazio no banco
// significa simplesmente não mostrar o percentual.
function custoEstrutura() {
  const alvo = estado.programaAtivo
    ? estado.programas.filter((pr) => pr.id === estado.programaAtivo)
    : estado.programas;
  const t = alvo.reduce((s, pr) => s + Number(pr.custo_estrutura_ano || 0), 0);
  return t || null;
}

function renderPilares(ps) {
  $('#painel-pilares').hidden = !PILARES.length;
  if (!PILARES.length) return;

  const grupos = PILARES.map((pl) => ({ ...pl, itens: ps.filter((p) => p.pilar === pl.nome) }));
  const semPilar = ps.filter((p) => !p.pilar);
  if (semPilar.length) {
    grupos.push({ nome: 'Sem pilar definido', curto: 'Sem pilar',
                  cor: 'var(--cinza-claro)', itens: semPilar, orfao: true });
  }

  $('#pilares').innerHTML = grupos.map((g) => {
    const horas = g.itens.reduce((s, p) => s + Number(p.horas_mes || 0), 0);
    const custo = g.itens.reduce((s, p) => s + valorAno(p), 0);
    const nps = g.itens.map((p) => Number(p.nps)).filter((n) => Number.isFinite(n) && n !== 0);
    const base = custoEstrutura();
    const pct = (base && custo) ? (custo / base * 100).toFixed(1).replace('.', ',') + '%' : '';

    // a quebra por fase, na ordem em que a leitura faz sentido
    const fases = [
      ['Entregues', g.itens.filter((p) => ENTREGUES.includes(p.status)).length],
      ['Em andamento', g.itens.filter((p) => !ENTREGUES.includes(p.status)
        && p.status !== 'Não iniciado' && !FORA_DO_FLUXO.includes(p.status)).length],
      ['Não iniciadas', g.itens.filter((p) => p.status === 'Não iniciado').length],
      ['Fora do fluxo', g.itens.filter((p) => FORA_DO_FLUXO.includes(p.status)).length],
    ].filter(([, n]) => n);

    return `
      <div class="pilar-bloco${g.orfao ? ' orfao' : ''}" style="--pcor:${g.cor}">
        <div class="pilar-topo">
          <span class="pilar-nome">${esc(g.nome)}</span>
          <span class="pilar-n">${g.itens.length}</span>
        </div>
        ${g.metrica ? `<p class="pilar-metrica">${esc(g.metrica)}</p>` : ''}
        <div class="pilar-numeros">
          ${horas ? `<span><b>${fmtNum(horas, 1)}</b> h/mês</span>` : ''}
          ${horas ? `<span><b>${fmtNum(hcEquivalente(horas), 2)}</b> HC</span>` : ''}
          ${custo ? `<span><b>${fmtReal(custo)}</b>/ano</span>` : ''}
          ${pct ? `<span><b>${pct}</b> do custo de RH</span>` : ''}
          ${nps.length ? `<span><b>${fmtNum(nps.reduce((s, n) => s + n, 0) / nps.length, 0)}</b> NPS médio</span>` : ''}
          ${!horas && !custo && !nps.length ? '<span class="sem-meta">medido por outro critério</span>' : ''}
        </div>
        <ul class="pilar-fases">
          ${fases.map(([rot, n]) => `<li><span>${rot}</span><b>${n}</b></li>`).join('')}
        </ul>
      </div>`;
  }).join('');
}

// ------------------------------------------------------ RITMO DE ENTREGA
function renderRitmo(ps) {
  const meses = [];
  for (let i = -5; i <= 3; i++) {
    const d = new Date(HOJE.getFullYear(), HOJE.getMonth() + i, 1);
    meses.push({
      ch: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      rot: MESES[d.getMonth()],
      futuro: i > 0,
      agora: i === 0,
      feitos: 0, previstos: 0,
    });
  }
  const achar = (ch) => meses.find((m) => m.ch === ch);

  ps.forEach((p) => {
    if (p.data_entrega) { const m = achar(p.data_entrega.slice(0, 7)); if (m) m.feitos++; }
    else if (p.data_prevista && !FORA_DO_FLUXO.includes(p.status)) {
      const m = achar(p.data_prevista.slice(0, 7)); if (m) m.previstos++;
    }
  });

  const teto = Math.max(1, ...meses.map((m) => m.feitos + m.previstos));
  $('#ritmo').innerHTML = meses.map((m) => {
    const t = m.feitos + m.previstos;
    return `
      <div class="ritmo-col${m.agora ? ' agora' : ''}" title="${m.rot}: ${m.feitos} entregue(s), ${m.previstos} previsto(s)">
        <div class="ritmo-barras">
          ${m.previstos ? `<span class="rb prev" style="height:${(m.previstos / teto) * 100}%"></span>` : ''}
          ${m.feitos ? `<span class="rb feito" style="height:${(m.feitos / teto) * 100}%"></span>` : ''}
        </div>
        <span class="ritmo-num">${t || ''}</span>
        <span class="ritmo-mes">${m.rot}</span>
      </div>`;
  }).join('');
}

// -------------------------------------------------- CARGA POR RESPONSÁVEL
function renderCarga(ativos) {
  const porPessoa = {};
  ativos.forEach((p) => {
    const quem = p.responsavel || 'Sem responsável';
    (porPessoa[quem] ||= { n: 0, h: 0, risco: 0 });
    porPessoa[quem].n++;
    porPessoa[quem].h += Number(p.horas_mes || 0);
    const k = calcRag(p).k;
    if (k === 'r' || k === 'a') porPessoa[quem].risco++;
  });

  const lista = Object.entries(porPessoa).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const teto = Math.max(1, ...lista.map(([, v]) => v.n));

  $('#carga').innerHTML = lista.length ? lista.map(([quem, v]) => `
    <li>
      <span class="carga-nome">${esc(quem)}</span>
      <span class="carga-barra"><i style="width:${(v.n / teto) * 100}%"></i></span>
      <span class="carga-num">${v.n}</span>
      <span class="carga-h">${v.h ? fmtNum(v.h, 0) + ' h' : '—'}</span>
      ${v.risco ? `<span class="carga-risco" title="${v.risco} em risco de prazo">${v.risco}⚠</span>` : '<span class="carga-risco"></span>'}
    </li>`).join('')
    : '<li class="vazio">Nenhum projeto ativo.</li>';
}

// =====================================================================
// QUADRO (Kanban) — arrastar muda a etapa; status e progresso mudam no
// próprio card. A ficha completa só abre quando você clica no nome.
// =====================================================================
function renderQuadro() {
  const cont = Object.fromEntries(ORDEM_RAG.map((k) => [k, 0]));
  estado.projetos.forEach((p) => cont[calcRag(p).k]++);

  const lista = ordenarCards(projetosFiltrados());

  // A coluna de parados sai da fileira: ela é arquivo, não trabalho em
  // curso, e estava comendo um quinto da largura das colunas ativas.
  const emFluxo = ETAPAS.filter((et) => et !== ETAPA_PARADA);

  // Em "Todos os programas" as etapas dos dois quadros se somam. Coluna
  // vazia de outro programa só ocupa espaço, então some.
  const varios = !estado.programaAtivo && estado.programas.length > 1;
  const visiveis = varios
    ? emFluxo.filter((et) => lista.some((p) => p.etapa === et))
    : emFluxo;

  const coluna = (etapa) => {
    const ps = lista.filter((p) => p.etapa === etapa);
    const horas = ps.reduce((s, p) => s + Number(p.horas_mes || 0), 0);
    return `
      <section class="kcol" data-etapa="${esc(etapa)}">
        <header class="kcol-cab">
          <h4>${esc(etapa)}</h4>
          <span class="cont">${ps.length}</span>
          ${horas ? `<span class="kcol-horas">${fmtNum(horas, 1)} h/mês</span>` : ''}
          ${podeEditar()
            ? `<button class="kcol-novo" data-nova-etapa="${esc(etapa)}"
                       title="Criar um projeto já nesta etapa">+</button>`
            : ''}
        </header>
        <div class="kcol-corpo">
          ${ps.map(cardKanban).join('') || '<p class="kvazio">Solte um projeto aqui</p>'}
        </div>
      </section>`;
  };

  $('#kanban').style.gridTemplateColumns =
    `repeat(${visiveis.length}, minmax(248px, 1fr))`;
  $('#kanban').innerHTML = visiveis.map(coluna).join('');

  // a faixa de parados, recolhida, embaixo do quadro
  const parados = lista.filter((p) => p.etapa === ETAPA_PARADA);
  const faixa = $('#parados');
  faixa.hidden = !ETAPAS.includes(ETAPA_PARADA);
  faixa.innerHTML = `
    <details class="kparados" data-etapa="${esc(ETAPA_PARADA)}" ${estado.abrirParados ? 'open' : ''}>
      <summary>
        <span class="kp-titulo">${esc(ETAPA_PARADA)}</span>
        <span class="cont">${parados.length}</span>
        <span class="kp-dica">${parados.length ? 'arraste para cá para congelar' : 'nada parado'}</span>
      </summary>
      <div class="kp-corpo">
        ${parados.map(cardKanban).join('') || '<p class="kvazio">Solte um projeto aqui</p>'}
      </div>
    </details>`;

  $('#contagem').textContent = lista.length === estado.projetos.length
    ? `${estado.projetos.length} projetos no portfólio`
    : `${lista.length} de ${estado.projetos.length} projetos · filtro ativo`;
}

// Quanto o projeto rende NESTE ano e quanto renderá num ano cheio. Antes
// o card só mostrava horas, e o valor proporcional existia apenas somado
// no painel — não dava para abrir um projeto e saber o que ele entrega.
function linhaDinheiro(p) {
  const anual = valorAno(p);
  if (!anual || FORA_DO_FLUXO.includes(p.status)) return '';

  const ano = HOJE.getFullYear();
  const meses = mesesNoAno(p, ano, true);
  const noAno = anual * meses / 12;
  const entregue = !!p.data_entrega;

  return `
    <div class="kdinheiro" title="${entregue ? 'Entregue' : 'Previsto'}: ${meses} de 12 meses em ${ano}">
      <span class="kd-ano"><b>${fmtReal(noAno)}</b>
        ${entregue ? 'em' : 'previsto para'} ${ano}
        ${meses && meses < 12 ? `<i>${meses}/12</i>` : ''}</span>
      <span class="kd-cheio">${fmtReal(anual)}/ano cheio</span>
    </div>`;
}

function cardKanban(p) {
  const r = calcRag(p);
  const dono = podeEditar();
  const coments = estado.comentarios.filter((c) => c.projeto_id === p.id);
  const nAnexos = estado.anexos.filter((a) => a.projeto_id === p.id).length;
  const doProjeto = estado.tarefas.filter((t) => t.projeto_id === p.id);
  const nTarefas = doProjeto.length;
  const nFeitas = doProjeto.filter((t) => t.feita).length;
  const corte = estado.lidoAte ? new Date(estado.lidoAte) : new Date(0);
  const chamou = coments.some((c) =>
    c.autor !== estado.nome && mencionaMim(c.texto) && new Date(c.criado_em) > corte);
  const ck = compChave(p.compliance_necessario);
  const pl = pilarDe(p.pilar);

  const parado = FORA_DO_FLUXO.includes(p.status);

  // O card inteiro abre a ficha. Os controles internos param o clique
  // antes de chegar aqui, então mexer no status não abre nada.
  return `
    <article class="kcard ${RAG[r.k].cls}${estado.destacar === p.id ? ' novinho' : ''}${pl ? ' com-pilar' : ''}"
             ${pl ? `style="--pcor:${pl.cor}" title="Pilar: ${esc(pl.nome)}"` : ''}
             data-id="${p.id}" data-abrir="${p.id}">
      <div class="kcard-topo">
        ${['v', 'c'].includes(r.k)
          ? `<span class="kquieto">${esc(r.motivo)}</span>`
          : `<span class="pill ${RAG[r.k].cls}" title="${esc(r.motivo)}">${RAG[r.k].nome}</span>`}
        ${dono && ck === 'sim' ? '<span class="kcomp sim">Compliance</span>' : ''}
      </div>
      <h5>${esc(p.nome)}</h5>
      <div class="kcard-meta">
        <span>${esc(p.responsavel || 'sem responsável')}</span>
        ${p.horas_mes ? `<span>${fmtNum(p.horas_mes, 1)} h/mês</span>` : ''}
        ${p.sem_ganho_financeiro ? '<span class="ksemganho">sem ganho financeiro</span>' : ''}
        ${parado ? '' : `<span>${fmtData(p.data_prevista)}</span>`}
        ${nTarefas ? `<span class="ktarefa">${nFeitas}/${nTarefas} tarefas</span>` : ''}
        ${nAnexos ? `<span class="kanexo">${nAnexos} anexo${nAnexos > 1 ? 's' : ''}</span>` : ''}
        ${chamou ? '<span class="kmencao">@você</span>'
          : coments.length ? `<span class="kcoment">${coments.length} coment.</span>` : ''}
      </div>
      ${linhaDinheiro(p)}
      ${dono ? `
        <select class="kcard-etapa" data-etapa-sel="${p.id}" title="Mover para outra coluna">
          ${ETAPAS.filter((et) => et !== ETAPA_ENTREGUE && et !== ETAPA_PARADA)
             .map((et) => `<option${et === p.etapa ? ' selected' : ''}>${esc(et)}</option>`).join('')}
          ${[ETAPA_ENTREGUE, ETAPA_PARADA].includes(p.etapa)
             ? `<option selected>${esc(p.etapa)}</option>` : ''}
        </select>
        <select class="kcard-status" data-status="${p.id}"
                title="Mudar o status — entregar ou congelar move o card de coluna">
          ${opcoesStatus(p.status)}
        </select>
        ${parado ? '' : `
        <div class="kcard-prog">
          <button class="kbtn" data-prog="${p.id}" data-delta="-10" title="Diminuir 10%">−</button>
          <div class="progresso"><span style="width:${p.progresso}%"></span></div>
          <span class="kprog-num">${p.progresso}%</span>
          <button class="kbtn" data-prog="${p.id}" data-delta="10" title="Aumentar 10%">+</button>
        </div>`}`
      : `
        <div class="kcard-estado">${esc(p.status)}${parado ? '' : ' · ' + p.progresso + '%'}</div>
        ${selectCompliance(p, 'kcard-compliance')}`}
      ${parado && p.motivo_parada
        ? `<p class="kcard-motivo">${textoComMencoes(p.motivo_parada)}</p>`
        : (p.proximo_passo && p.etapa !== ETAPA_ENTREGUE)
          ? `<p class="kcard-passo">→ ${textoComMencoes(p.proximo_passo)}</p>` : ''}
    </article>`;
}

// O seletor que o time de Compliance responde. Mesmo HTML no card e na tabela.
function selectCompliance(p, classe) {
  const ck = compChave(p.compliance_necessario);
  const op = (v, rot) => `<option value="${v}"${ck === v ? ' selected' : ''}>${rot}</option>`;
  return `
    <select class="${classe} comp-${ck || 'vazio'}" data-compliance="${p.id}" draggable="false"
            title="${p.compliance_obs ? esc(p.compliance_obs) : 'Compliance precisa acompanhar?'}">
      ${op('', 'Compliance: a definir')}
      ${op('sim', 'Compliance: acompanhar')}
      ${op('nao', 'Compliance: não precisa')}
    </select>`;
}

function camposCompliance(valor) {
  return {
    compliance_necessario: valor === 'sim' ? true : valor === 'nao' ? false : null,
    compliance_por: estado.nome,
    compliance_em: new Date().toISOString(),
  };
}

// ------------------------------------------------- arrastar e soltar
// Trocamos o drag-and-drop do HTML5 por Pointer Events: o do HTML5
// simplesmente não dispara em toque, e era por isso que o Quadro não
// funcionava no celular.
//
// No dedo, porém, arrastar briga com rolar a tela — seria preciso
// travar a rolagem em cima dos cards, o que é pior. Então no toque o
// card ganha um botão de mover, que abre a lista de etapas.
let arrastando = null;

function ligarArrastar(kb) {
  kb.addEventListener('pointerdown', (e) => {
    if (!podeEditar() || (e.button ?? 0) !== 0) return;
    if (e.pointerType === 'touch') return;              // no toque, usa o botão
    if (e.target.closest('select, input, textarea, button, a')) return;

    const card = e.target.closest('.kcard');
    if (!card) return;

    const id = card.dataset.id;
    const inicio = { x: e.clientX, y: e.clientY };
    let clone = null, dx = 0, dy = 0;

    const limpar = () => {
      document.removeEventListener('pointermove', mover);
      document.removeEventListener('pointerup', largar);
      document.removeEventListener('pointercancel', limpar);
      card.classList.remove('arrastando');
      document.body.classList.remove('arrastando-algo');
      $$('.kcol, .kparados').forEach((c) => c.classList.remove('alvo'));
      if (clone) clone.remove();
      clone = null;
    };

    const comecar = (x, y) => {
      const r = card.getBoundingClientRect();
      dx = x - r.left;
      dy = y - r.top;
      clone = card.cloneNode(true);
      clone.classList.add('fantasma');
      clone.style.cssText =
        `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;pointer-events:none;z-index:140`;
      document.body.appendChild(clone);
      card.classList.add('arrastando');
      document.body.classList.add('arrastando-algo');
      arrastando = id;
    };

    const colunaSob = (x, y) => {
      if (clone) clone.style.visibility = 'hidden';
      const el = document.elementFromPoint(x, y);
      if (clone) clone.style.visibility = '';
      return el && el.closest('.kcol, .kparados');
    };

    const mover = (ev) => {
      if (!clone) {
        if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 6) return;
        comecar(ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      clone.style.left = `${ev.clientX - dx}px`;
      clone.style.top = `${ev.clientY - dy}px`;
      const col = colunaSob(ev.clientX, ev.clientY);
      $$('.kcol, .kparados').forEach((c) => c.classList.toggle('alvo', c === col));
    };

    const largar = (ev) => {
      const arrastou = !!clone;
      const col = arrastou ? colunaSob(ev.clientX, ev.clientY) : null;
      limpar();
      arrastando = null;
      if (!arrastou) return;

      // o clique que vem depois do arrasto não pode abrir a ficha
      estado.arrastouAgora = Date.now();
      if (!col) return;

      const p = estado.projetos.find((x) => x.id === id);
      if (p && p.etapa !== col.dataset.etapa) {
        mudarCampo(id, camposParaEtapa(p, col.dataset.etapa));
      }
    };

    document.addEventListener('pointermove', mover, { passive: false });
    document.addEventListener('pointerup', largar);
    document.addEventListener('pointercancel', limpar);
  });
}

function ligarQuadro() {
  // a faixa de parados vive fora do #kanban, então ouvimos a tela toda
  const kb = $('#view-quadro');
  ligarArrastar(kb);

  // status e compliance mudam direto no card
  kb.addEventListener('change', async (e) => {
    const st = e.target.closest('[data-status]');
    if (st) {
      const p = estado.projetos.find((x) => x.id === st.dataset.status);
      if (!p) return;
      const entregando = ENTREGUES.includes(st.value) && !ENTREGUES.includes(p.status);
      await mudarCampo(p.id, camposParaStatus(p, st.value));
      if (entregando) soltarConfete();
      return;
    }
    const et = e.target.closest('[data-etapa-sel]');
    if (et) {
      const p = estado.projetos.find((x) => x.id === et.dataset.etapaSel);
      if (p && p.etapa !== et.value) mudarCampo(p.id, camposParaEtapa(p, et.value));
      return;
    }

    const cp = e.target.closest('[data-compliance]');
    if (cp) return mudarCampo(cp.dataset.compliance, camposCompliance(cp.value));
  });

  kb.addEventListener('click', (e) => {
    // criar projeto já na etapa da coluna
    const novo = e.target.closest('[data-nova-etapa]');
    if (novo) {
      e.stopPropagation();
      abrirProjeto(null, novo.dataset.novaEtapa);
      return;
    }

    // progresso em passos de 10%
    const btn = e.target.closest('[data-prog]');
    if (!btn) return;
    e.stopPropagation();
    const p = estado.projetos.find((x) => x.id === btn.dataset.prog);
    if (!p) return;
    const valor = Math.min(100, Math.max(0, p.progresso + Number(btn.dataset.delta)));
    if (valor !== p.progresso) mudarCampo(p.id, { progresso: valor });
  });
}

const primeiraEtapaDeFluxo = () =>
  ETAPAS.find((et) => et !== ETAPA_ENTREGUE && et !== ETAPA_PARADA) || ETAPAS[0];

// Soltar na coluna "Entregue" é dizer que o projeto saiu — então o card
// passa a 100%, ganha data de entrega e o semáforo acompanha. Tirar de lá
// desfaz isso, senão ele ficaria verde para sempre.
const isoHoje = () =>
  `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

function camposParaEtapa(p, etapa) {
  const campos = { etapa };

  if (etapa === ETAPA_ENTREGUE && p.etapa !== ETAPA_ENTREGUE) {
    // quem já estava "Em melhoria" continua em melhoria: arrastar para a
    // coluna de entregues não pode rebaixar o status de volta.
    if (!ENTREGUES.includes(p.status)) campos.status = 'Entregue';
    campos.progresso = 100;
    if (!p.data_entrega) campos.data_entrega = isoHoje();

  } else if (etapa === ETAPA_PARADA && p.etapa !== ETAPA_PARADA) {
    // entrou na coluna de parados: congelado é o padrão, cancelar é decisão
    if (!FORA_DO_FLUXO.includes(p.status)) campos.status = 'Congelado';
    campos.data_entrega = null;

  } else if (etapa !== ETAPA_ENTREGUE && p.etapa === ETAPA_ENTREGUE) {
    campos.data_entrega = null;
    if (ENTREGUES.includes(p.status)) campos.status = 'Em construção';

  } else if (etapa !== ETAPA_PARADA && p.etapa === ETAPA_PARADA) {
    // voltou ao fluxo: sai do congelamento e o motivo deixa de valer
    if (FORA_DO_FLUXO.includes(p.status)) campos.status = 'Em construção';
    campos.motivo_parada = null;
  }
  return campos;
}

// O status manda na coluna, não o contrário: marcar "Entregue" move o
// card sozinho, marcar "Cancelado" manda para a coluna de parados.
function camposParaStatus(p, status) {
  const campos = { status };

  if (ENTREGUES.includes(status)) {
    campos.progresso = 100;
    campos.etapa = ETAPA_ENTREGUE;
    if (!p.data_entrega) campos.data_entrega = isoHoje();

  } else if (FORA_DO_FLUXO.includes(status)) {
    campos.etapa = ETAPA_PARADA;
    campos.data_entrega = null;

  } else {
    if (ENTREGUES.includes(p.status)) campos.data_entrega = null;
    if (p.etapa === ETAPA_ENTREGUE || p.etapa === ETAPA_PARADA) campos.etapa = primeiraEtapaDeFluxo();
    if (FORA_DO_FLUXO.includes(p.status)) campos.motivo_parada = null;
  }
  return campos;
}

// Aplica a mudança na tela na hora e só depois grava. Se o banco recusar,
// volta ao estado anterior — a tela nunca mente sobre o que foi salvo.
async function mudarCampo(id, campos) {
  const p = estado.projetos.find((x) => x.id === id);
  if (!p) return;

  const antes = {};
  Object.keys(campos).forEach((k) => { antes[k] = p[k]; });
  if (Object.keys(campos).every((k) => p[k] === campos[k])) return;

  Object.assign(p, campos);
  renderVisao();          // atualiza KPIs, semáforo e o quadro de uma vez

  try {
    await salvarProjeto(id, campos);
    await carregarTudo();
  } catch (err) {
    Object.assign(p, antes);
    renderVisao();
    toast('Não foi possível salvar: ' + err.message, true);
  }
}

ligarQuadro();

// =====================================================================
// CRONOGRAMA (Gantt)
// =====================================================================
function renderGantt() {
  // Projeto cancelado, descontinuado ou congelado não tem prazo vigente:
  // deixá-lo na linha do tempo faria o cronograma prometer o que ninguém
  // vai entregar.
  const fora = estado.projetos.filter((p) => FORA_DO_FLUXO.includes(p.status));
  const ps = estado.projetos
    .filter((p) => p.data_prevista && !FORA_DO_FLUXO.includes(p.status))
    .sort((a, b) => paraData(a.data_prevista) - paraData(b.data_prevista));

  const aviso = $('#fora-cronograma');
  aviso.hidden = !fora.length;
  if (fora.length) {
    const nCanc = fora.filter((p) => ENCERRADOS.includes(p.status)).length;
    const nCong = fora.length - nCanc;
    const partes = [];
    if (nCanc) partes.push(`${nCanc} cancelado${nCanc > 1 ? 's' : ''}`);
    if (nCong) partes.push(`${nCong} congelado${nCong > 1 ? 's' : ''}`);
    aviso.textContent = `Fora do cronograma: ${partes.join(' e ')}. Sem prazo vigente, não entram na linha do tempo.`;
  }

  renderLeituraCronograma(ps);

  if (!ps.length) { $('#gantt').innerHTML = '<p class="vazio">Nenhum projeto com data prevista.</p>'; return; }

  // janela de tempo: do mês mais antigo ao mês mais distante
  let ini = new Date(Math.min(...ps.map((p) => paraData(p.data_inicio || p.data_prevista)), HOJE));
  let fim = new Date(Math.max(...ps.map((p) => paraData(p.data_prevista)), HOJE));
  ini = new Date(ini.getFullYear(), ini.getMonth(), 1);
  fim = new Date(fim.getFullYear(), fim.getMonth() + 1, 0);

  const meses = [];
  for (let d = new Date(ini); d <= fim; d.setMonth(d.getMonth() + 1)) {
    meses.push(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  const totalDias = dias(ini, fim) || 1;
  const pct = (d) => (dias(ini, d) / totalDias) * 100;
  const grid = `grid-template-columns:240px repeat(${meses.length},1fr)`;

  const cabecalho = `
    <div class="gantt-cab" style="${grid}">
      <span class="gantt-rot">Projeto</span>
      ${meses.map((m, i) => `
        <span class="gantt-mes ${m.getMonth() === 0 || i === 0 ? 'ano' : ''}">
          ${MESES[m.getMonth()]}${m.getMonth() === 0 || i === 0 ? ' ' + String(m.getFullYear()).slice(2) : ''}
        </span>`).join('')}
    </div>`;

  const linhas = ps.map((p, idx) => {
    const r = calcRag(p);
    const dIni = paraData(p.data_inicio) || paraData(p.data_prevista);
    const dFim = paraData(p.data_entrega) || paraData(p.data_prevista);
    const esq = Math.max(0, pct(dIni));
    const larg = Math.max(2.2, pct(dFim) - esq);

    return `
      <div class="gantt-linha" style="${grid}">
        <span class="gantt-nome" data-abrir="${p.id}">
          ${esc(p.nome)}
          <small>${esc(p.responsavel || '—')} · ${fmtData(p.data_prevista)}</small>
        </span>
        <div class="gantt-trilho" style="grid-column:2/-1">
          <div class="gantt-grade" style="grid-template-columns:repeat(${meses.length},1fr)">
            ${meses.map(() => '<i></i>').join('')}
          </div>
          ${HOJE >= ini && HOJE <= fim
            ? `<div class="gantt-hoje${idx === 0 ? ' com-rotulo' : ''}" style="left:${pct(HOJE)}%"></div>`
            : ''}
          <div class="gantt-barra ${RAG[r.k].cls}" data-abrir="${p.id}"
               style="left:${esq}%;width:${larg}%" title="${esc(p.nome)} — ${esc(r.motivo)}">
            ${p.progresso}%
          </div>
        </div>
      </div>`;
  }).join('');

  $('#gantt').innerHTML = cabecalho + linhas;

  // Abrir o cronograma já mostrando hoje, e não janeiro do ano passado.
  const caixa = $('.gantt-wrap');
  const marca = $('.gantt-hoje');
  if (caixa && marca) {
    requestAnimationFrame(() => {
      const alvo = marca.getBoundingClientRect().left - caixa.getBoundingClientRect().left;
      caixa.scrollLeft = Math.max(0, caixa.scrollLeft + alvo - caixa.clientWidth / 2);
    });
  }
}

// =====================================================================
// LEITURA DO CRONOGRAMA
// Análise calculada na hora a partir das datas e dos responsáveis — não
// é um modelo de linguagem opinando. Isso é de propósito: recalcula
// sozinha a cada mudança, funciona sem internet, não custa nada e não
// tem como inventar uma data que não existe.
// =====================================================================
function renderLeituraCronograma(ps) {
  const achados = [];
  const rotuloMes = (ch) => {
    const [a, m] = ch.split('-');
    return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
  };

  if (ps.length >= 3) {
    // 1 · meses sobrecarregados
    const porMes = {};
    ps.forEach((p) => {
      const ch = p.data_prevista.slice(0, 7);
      (porMes[ch] ||= []).push(p);
    });
    const meses = Object.entries(porMes).sort((a, b) => b[1].length - a[1].length);
    const media = ps.length / Object.keys(porMes).length;
    const [chTopo, doTopo] = meses[0];

    if (doTopo.length >= 3 && doTopo.length >= media * 1.8) {
      achados.push({
        tipo: 'alerta',
        txt: `<b>${rotuloMes(chTopo)}</b> concentra ${doTopo.length} entregas, contra ${media.toFixed(1)} de média nos demais meses.`,
        det: doTopo.map((p) => p.nome).join(' · '),
      });
    }

    // 2 · mesma pessoa com mais de uma entrega no mesmo mês
    const sobrecarga = [];
    Object.entries(porMes).forEach(([ch, lista]) => {
      const porPessoa = {};
      lista.forEach((p) => { if (p.responsavel) (porPessoa[p.responsavel] ||= []).push(p); });
      Object.entries(porPessoa).forEach(([quem, seus]) => {
        if (seus.length > 1) sobrecarga.push({ ch, quem, seus });
      });
    });
    sobrecarga.sort((a, b) => b.seus.length - a.seus.length).slice(0, 3).forEach((s) => {
      achados.push({
        tipo: 'alerta',
        txt: `<b>${esc(s.quem)}</b> responde por ${s.seus.length} entregas em ${rotuloMes(s.ch)}.`,
        det: s.seus.map((p) => `${p.nome} (${fmtData(p.data_prevista)})`).join(' · '),
      });
    });

    // 3 · entregas empilhadas na mesma semana
    const porSemana = {};
    ps.forEach((p) => {
      const d = paraData(p.data_prevista);
      const ch = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 604800000) + '-' + d.getFullYear();
      (porSemana[ch] ||= []).push(p);
    });
    const semanaCheia = Object.values(porSemana).sort((a, b) => b.length - a.length)[0];
    if (semanaCheia && semanaCheia.length >= 3) {
      achados.push({
        tipo: 'alerta',
        txt: `${semanaCheia.length} entregas caem na mesma semana, em torno de <b>${fmtData(semanaCheia[0].data_prevista)}</b>.`,
        det: semanaCheia.map((p) => p.nome).join(' · '),
      });
    }

    // 4 · janelas livres à frente
    const vazios = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(HOJE.getFullYear(), HOJE.getMonth() + i, 1);
      const ch = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes[ch]) vazios.push(rotuloMes(ch));
    }
    if (vazios.length) {
      achados.push({
        tipo: 'folga',
        txt: `Sem nenhuma entrega prevista em <b>${vazios.join(', ')}</b>.`,
        // sem citar etapa: o nome muda de um programa para o outro
        det: 'Janela livre para antecipar algo que está esperando ou descongelar um projeto.',
      });
    }
  }

  // 5 · atrasos, que valem mesmo com poucos projetos
  const atrasados = ps.filter((p) => calcRag(p).k === 'r');
  if (atrasados.length) {
    achados.unshift({
      tipo: 'critico',
      txt: `${atrasados.length} projeto${atrasados.length > 1 ? 's' : ''} com prazo vencido, segurando o cronograma.`,
      det: atrasados.map((p) => `${p.nome} (${fmtData(p.data_prevista)})`).join(' · '),
    });
  }

  // 6 · projetos sem prazo nenhum
  const semPrazo = estado.projetos.filter(
    (p) => !p.data_prevista && !FORA_DO_FLUXO.includes(p.status) && !ENTREGUES.includes(p.status));
  if (semPrazo.length) {
    achados.push({
      tipo: 'alerta',
      txt: `${semPrazo.length} projeto${semPrazo.length > 1 ? 's' : ''} ativo${semPrazo.length > 1 ? 's' : ''} sem data prevista — não aparece${semPrazo.length > 1 ? 'm' : ''} aqui.`,
      det: semPrazo.map((p) => p.nome).join(' · '),
    });
  }

  $('#leitura-cronograma').innerHTML = achados.length
    ? achados.map((a) => `
        <li class="${a.tipo}">
          <span class="marca-leitura"></span>
          <span class="txt">${a.txt}<em>${esc(a.det)}</em></span>
        </li>`).join('')
    : '<li class="vazio">Nada fora do lugar: as entregas estão distribuídas e ninguém está com duas no mesmo mês.</li>';
}

// =====================================================================
// FILTROS DO QUADRO
// A tabela separada saiu: busca, filtros e ordenação passaram a viver no
// próprio Quadro, e o que era "exportar a lista" virou o Excel.
// =====================================================================
function projetosFiltrados() {
  const busca = $('#busca').value.trim().toLowerCase();
  const [tipo, valor] = ($('#filtro').value || '').split('::');

  return estado.projetos.filter((p) => {
    if (tipo === 'rag' && calcRag(p).k !== valor) return false;
    if (tipo === 'pilar' && (p.pilar || '') !== valor) return false;
    if (tipo === 'resp' && (p.responsavel || '') !== valor) return false;
    if (tipo === 'status' && p.status !== valor) return false;

    // os atalhos dos indicadores da Visão geral
    if (tipo === 'foco') {
      const entregue = ENTREGUES.includes(p.status);
      const parado = FORA_DO_FLUXO.includes(p.status);
      if (valor === 'andamento' && (entregue || parado)) return false;
      if (valor === 'entregues' && !entregue) return false;
      if (valor === 'parados' && !parado) return false;
    }

    if (busca) {
      const alvo = [p.nome, p.codigo, p.responsavel, p.solicitante,
                    p.proximo_passo, p.descricao].join(' ').toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function ordenarCards(lista) {
  const campo = $('#ordem-cards').value;
  return [...lista].sort((a, b) => {
    if (campo === 'prioridade') {
      return (a.prioridade - b.prioridade) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    }
    if (campo === 'nome') return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    if (campo === 'data_prevista') {
      return (a.data_prevista || '9999-12-31').localeCompare(b.data_prevista || '9999-12-31');
    }
    return (Number(b[campo]) || 0) - (Number(a[campo]) || 0);
  });
}

// Uma lista só, agrupada. Antes eram quatro listas, sete pastilhas e um
// botão de limpar — doze controles para filtrar vinte e dois projetos.
function renderFiltros() {
  const atual = $('#filtro').value;
  const conta = (teste) => estado.projetos.filter(teste).length;

  const grupo = (rotulo, itens) => {
    const vivos = itens.filter(([, , n]) => n > 0);
    if (!vivos.length) return '';
    return `<optgroup label="${rotulo}">` +
      vivos.map(([v, rot, n]) => `<option value="${v}">${esc(rot)} (${n})</option>`).join('') +
      '</optgroup>';
  };

  // Os três atalhos ficam no topo, fora de grupo: são a mesma pergunta que
  // os indicadores da Visão geral respondem, e é para cá que eles levam.
  const atalho = (v, rot, teste) => {
    const n = conta(teste);
    return n ? `<option value="${v}">${esc(rot)} (${n})</option>` : '';
  };

  $('#filtro').innerHTML =
    '<option value="">Todos os projetos</option>' +
    atalho('foco::andamento', 'Em andamento',
      (p) => !ENTREGUES.includes(p.status) && !FORA_DO_FLUXO.includes(p.status)) +
    atalho('foco::entregues', 'Entregues',
      (p) => ENTREGUES.includes(p.status)) +
    atalho('foco::parados', 'Congelados e cancelados',
      (p) => FORA_DO_FLUXO.includes(p.status)) +
    grupo('Situação', ORDEM_RAG.map((k) => [`rag::${k}`, RAG[k].nome, conta((p) => calcRag(p).k === k)])) +
    grupo('Pilar', PILARES.map((pl) => [`pilar::${pl.nome}`, pl.curto || pl.nome,
      conta((p) => p.pilar === pl.nome)])) +
    grupo('Responsável', [...new Set(estado.projetos.map((p) => p.responsavel).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((r) => [`resp::${r}`, r, conta((p) => p.responsavel === r)])) +
    grupo('Status', statusDisponiveis().map((s) => [`status::${s}`, s, conta((p) => p.status === s)]));

  $('#filtro').value = atual;
  if (!$('#filtro').value) $('#filtro').value = '';
}

['#busca', '#filtro', '#ordem-cards'].forEach((s) =>
  $(s).addEventListener('input', renderQuadro));


// =====================================================================
// NOTIFICAÇÕES
// =====================================================================
function gerarAlertas() {
  return estado.projetos
    .map((p) => ({ p, r: calcRag(p) }))
    .filter((x) => x.r.k === 'r' || x.r.k === 'a' || x.r.k === 's')
    .sort((a, b) => ORDEM_RAG.indexOf(a.r.k) - ORDEM_RAG.indexOf(b.r.k) || (a.r.d ?? 999) - (b.r.d ?? 999));
}

function renderNotificacoes() {
  const alertas = gerarAlertas();

  $('#lista-alertas').innerHTML = alertas.length ? alertas.map(({ p, r }) => `
    <li>
      <span class="marca-alerta" style="background:${RAG[r.k].cor}"></span>
      <span class="txt">
        <b data-abrir="${p.id}">${esc(p.nome)}</b> — ${esc(r.motivo)}
        <em>${esc(p.responsavel || 'sem responsável')} · previsão ${fmtData(p.data_prevista)}${p.proximo_passo ? ' · ' + esc(p.proximo_passo) : ''}</em>
      </span>
    </li>`).join('')
    : '<li class="vazio">Nenhum alerta. Todos os projetos com prazo definido estão no verde.</li>';

  // Menções dirigidas a quem está logado — dos comentários E dos campos
  // do projeto, porque o @ agora vale em todo campo de texto.
  const corteM = estado.lidoAte ? new Date(estado.lidoAte) : new Date(0);

  const minhas = estado.comentarios
    .filter((c) => c.autor !== estado.nome && mencionaMim(c.texto))
    .map((c) => {
      const p = estado.projetos.find((x) => x.id === c.projeto_id);
      return {
        autor: c.autor, quando: c.criado_em, texto: c.texto,
        onde: p ? `em <b data-abrir="${p.id}">${esc(p.nome)}</b>` : 'no mural',
      };
    });

  const CAMPOS_MENCAO = [
    ['proximo_passo', 'próximo passo'],
    ['descricao', 'descrição'],
    ['observacoes', 'observações'],
    ['motivo_parada', 'motivo da parada'],
    ['compliance_obs', 'observação do Compliance'],
  ];

  estado.projetos.forEach((p) => {
    CAMPOS_MENCAO.forEach(([campo, rotulo]) => {
      if (p[campo] && mencionaMim(p[campo]) && p.atualizado_por !== estado.nome) {
        minhas.push({
          autor: p.atualizado_por || 'alguém',
          quando: p.atualizado_em,
          texto: p[campo],
          onde: `no <b data-abrir="${p.id}">${esc(p.nome)}</b> · ${rotulo}`,
        });
      }
    });
  });

  minhas.sort((a, b) => new Date(b.quando) - new Date(a.quando));
  const lista = minhas.slice(0, 15);

  $('#painel-mencoes').hidden = !lista.length;
  $('#lista-mencoes').innerHTML = lista.map((m) => {
    const nova = new Date(m.quando) > corteM;
    return `
      <li class="${nova ? 'nova' : ''}">
        <div class="cab">
          <span class="autor">${esc(m.autor)}</span>
          <span class="onde">${m.onde}</span>
          <span class="quando">${fmtQuando(m.quando)}</span>
          ${nova ? '<span class="tag-nova">nova</span>' : ''}
        </div>
        <div class="texto">${textoComMencoes(m.texto)}</div>
      </li>`;
  }).join('');

  const recados = estado.comentarios.filter((c) => !c.projeto_id);
  $('#lista-recados').innerHTML = recados.length ? recados.map(itemRecado).join('')
    : '<li class="vazio">Nenhum recado ainda.</li>';

  $('#lista-historico').innerHTML = estado.historico.length ? estado.historico.map((h) => `
    <li>
      <span class="quando">${fmtQuando(h.criado_em)}</span>
      <span class="desc">
        <b>${esc(h.autor || 'alguém')}</b> alterou <b>${esc(h.campo)}</b> em ${esc(h.projeto_nome || 'projeto')}:
        <span class="de">${esc(h.valor_anterior || 'vazio')}</span> → <span class="para">${esc(h.valor_novo || 'vazio')}</span>
      </span>
    </li>`).join('')
    : '<li class="vazio">Nenhuma alteração registrada ainda.</li>';

  // Contador da aba = só o que é NOVIDADE e ainda não foi lido.
  // Os alertas de prazo ficam fora: eles não "se leem", são a situação
  // atual do portfólio. Se entrassem aqui, "Marcar tudo como lido" nunca
  // zeraria o número e pareceria que o botão não funciona.
  const corte = estado.lidoAte ? new Date(estado.lidoAte) : new Date(0);
  const novidades =
    estado.comentarios.filter((c) => new Date(c.criado_em) > corte && c.autor !== estado.nome).length +
    estado.historico.filter((h) => new Date(h.criado_em) > corte && h.autor !== estado.nome).length;

  const badge = $('#badge-notif');
  badge.textContent = novidades > 99 ? '99+' : novidades;
  badge.hidden = novidades === 0;

  const nPrazo = alertas.filter((a) => a.r.k !== 's').length;
  $('#titulo-alertas').textContent = nPrazo
    ? `Alertas automáticos (${nPrazo})`
    : 'Alertas automáticos';

  $('#btn-marcar-lido').hidden = novidades === 0;
}

function itemRecado(c) {
  return `
    <li>
      <div class="cab">
        <span class="autor">${esc(c.autor)}</span>
        <span class="quando">${fmtQuando(c.criado_em)}</span>
      </div>
      <div class="texto">${textoComMencoes(c.texto)}</div>
    </li>`;
}

// O @ vale em todo campo de texto livre, não só nos comentários.
['#recado-texto', '#comentario-texto', '#f-descricao', '#f-proximo_passo',
 '#f-observacoes', '#f-motivo-parada', '#f-compliance-obs'].forEach(ligarMencoes);

$('#form-recado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#recado-texto').value.trim();
  if (!texto) return;
  const { error } = await sb.from('comentarios').insert({ projeto_id: null, autor: estado.nome, texto });
  if (error) return toast('Não foi possível publicar: ' + error.message, true);
  await enfileirarMencoes(texto, null, 'mural');
  $('#recado-texto').value = '';
  await carregarTudo();
  toast('Recado publicado');
});

$('#btn-marcar-lido').addEventListener('click', async () => {
  const agora = new Date().toISOString();
  const { error } = await sb.from('leituras')
    .upsert({ user_id: estado.usuario.id, lido_ate: agora }, { onConflict: 'user_id' });
  if (error) return toast('Erro: ' + error.message, true);
  estado.lidoAte = agora;
  renderNotificacoes();
  toast('Notificações marcadas como lidas');
});

// =====================================================================
// MODAL DO PROJETO
// =====================================================================
function montarSelects() {
  $('#f-etapa').innerHTML = ETAPAS.map((v) => `<option>${esc(v)}</option>`).join('');
  $('#f-status').innerHTML = opcoesStatus('');

  // o campo de pilar só existe onde o programa define pilares
  $('#campo-pilar').hidden = !PILARES.length;
  $('#f-pilar').innerHTML = '<option value="">Sem pilar definido</option>' +
    PILARES.map((pl) => `<option value="${esc(pl.nome)}">${esc(pl.nome)}</option>`).join('');
}

function abrirProjeto(id, etapaPadrao) {
  const p = id ? estado.projetos.find((x) => x.id === id) : null;
  estado.editando = p ? p.id : null;

  $('#modal-cod').textContent = p?.codigo || 'NOVO';
  $('#modal-titulo').textContent = p?.nome || 'Novo projeto';
  $('#modal-erro').hidden = true;
  $('#btn-excluir').hidden = !p;

  const f = $('#form-projeto');
  const vals = p || {
    etapa: etapaPadrao || 'Fila', status: 'Não iniciado', progresso: 0, prioridade: 3,
  };
  montarResponsaveis(vals.responsavel);
  ['nome', 'descricao', 'codigo', 'responsavel', 'executante', 'solicitante', 'etapa', 'status',
   'data_inicio', 'data_prevista', 'data_entrega', 'prioridade', 'horas_mes',
   'custo_hora', 'custo_direto_ano', 'como_medimos', 'nps', 'progresso', 'proximo_passo',
   'motivo_parada', 'observacoes', 'pilar'].forEach((campo) => {
    f.elements[campo].value = vals[campo] ?? '';
  });
  formatarCampoNumero(f.elements.horas_mes);
  formatarCampoNumero(f.elements.custo_hora);
  formatarCampoNumero(f.elements.custo_direto_ano);
  mostrarCriterioPilar();
  f.elements.sem_ganho_financeiro.checked = !!vals.sem_ganho_financeiro;
  $('#campo-medimos').hidden = !vals.sem_ganho_financeiro;
  mostrarGanho();
  $('#out-progresso').textContent = (vals.progresso || 0) + '%';
  $('#campo-motivo').hidden = !FORA_DO_FLUXO.includes(vals.status);

  // comentários do projeto
  const doProjeto = estado.comentarios.filter((c) => c.projeto_id === id);
  $('.modal-comentarios').hidden = !p;
  $('#lista-comentarios').innerHTML = doProjeto.length ? doProjeto.map(itemRecado).join('')
    : '<li class="vazio">Nenhum comentário neste projeto.</li>';

  // ------------------------------------------------------ subtarefas
  const dono = podeEditar();
  $('#modal-tarefas').hidden = !p;
  if (p) renderTarefas(p.id);

  // o modelo só faz sentido na criação; depois ele vive no bloco de tarefas
  $('#campo-modelo').hidden = !!p || !dono || !estado.modelos.length;
  $('#f-modelo').innerHTML = '<option value="">Começar do zero</option>' +
    estado.modelos.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');

  // ------------------------------------------------------- compliance
  $('#bloco-compliance').hidden = !p;
  $('#f-compliance').value = p ? compChave(p.compliance_necessario) : '';
  $('#f-compliance-obs').value = p?.compliance_obs || '';
  $('#compliance-quem').textContent = p?.compliance_em
    ? `${p.compliance_por || 'alguém'} · ${fmtQuando(p.compliance_em)}`
    : '';

  // ----------------------------------------------------------- anexos
  $('#modal-anexos').hidden = !p;
  $('#anexo-limite').textContent = `até ${LIMITE_ANEXO_MB} MB por arquivo`;
  $('#anexo-status').hidden = true;
  $('#zona-anexo').hidden = !dono;
  renderAnexos(id);

  // ------------------------------------------- travas por nível de acesso
  [...$('#form-projeto').elements].forEach((el) => {
    if (el.type !== 'submit' && el.type !== 'button') el.disabled = !dono;
  });
  $('#btn-excluir').hidden = !p || !dono;
  $('#btn-salvar-projeto').hidden = !dono;
  $('#aviso-somente-leitura').hidden = dono;
  // sem permissão de editar, nada de microfone: o campo está travado
  $$('[data-ditar]').forEach((b) => { b.hidden = !dono || !Reconhecimento; });
  $('.modal-comentarios').hidden = !p;   // comentar é liberado para os dois papéis

  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  if (dono) setTimeout(() => $('#f-nome').focus(), 60);
}

// =====================================================================
// FILA DE NOTIFICAÇÕES
// O site só ENFILEIRA. Quem manda o e-mail é a função agendada no
// Supabase — navegador não envia e-mail, e não dá para confiar que a
// pessoa vai estar com a aba aberta na hora.
// =====================================================================
async function enfileirarMencoes(texto, projetoId, origem) {
  const alvos = mencionados(texto).filter((n) => n.toLowerCase() !== estado.nome.toLowerCase());
  if (!alvos.length) return;

  const projeto = estado.projetos.find((p) => p.id === projetoId);
  const onde = projeto ? projeto.nome : 'no mural';

  const linhas = alvos.map((quem) => ({
    para_nome: quem,
    assunto: `${estado.nome} marcou você em ${onde}`,
    corpo: texto.slice(0, 1200),
    projeto_id: projetoId || null,
    tipo: origem || 'mencao',
  }));

  const { error } = await sb.from('notificacoes').insert(linhas);
  if (error) console.warn('Fila de notificações indisponível:', error.message);
}

// ------------------------------- CALENDÁRIO (.ics para Outlook/Google)
$('#btn-ics').addEventListener('click', () => {
  // Leva o que está na tela: mesmo filtro do Quadro, mesmo programa.
  const visiveis = projetosFiltrados();
  const ids = new Set(visiveis.map((p) => p.id));
  const eventos = [];

  estado.tarefas
    .filter((t) => !t.feita && t.prazo && ids.has(t.projeto_id))
    .forEach((t) => {
      const proj = visiveis.find((p) => p.id === t.projeto_id);
      eventos.push({ id: t.id, data: t.prazo, titulo: t.titulo, onde: proj?.nome || '' });
    });

  visiveis
    .filter((p) => p.data_prevista && !ENTREGUES.includes(p.status) && !FORA_DO_FLUXO.includes(p.status))
    .forEach((p) => {
      eventos.push({ id: p.id, data: p.data_prevista, titulo: `Entrega: ${p.nome}`,
                     onde: p.proximo_passo || '' });
    });

  if (!eventos.length) return toast('Nada com data para exportar.', true);

  const limpo = (s) => String(s || '')
    .replace(new RegExp('[\\\\;,]', 'g'), ' ')
    .replace(new RegExp('[\\r\\n]+', 'g'), ' ')
    .slice(0, 180);
  const agora = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CIMED//Gestao de Projetos//PT-BR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Projetos CIMED',
    ...eventos.flatMap((ev) => {
      const fim = new Date(paraData(ev.data));
      fim.setDate(fim.getDate() + 1);
      const fimTxt = `${fim.getFullYear()}${String(fim.getMonth() + 1).padStart(2, '0')}${String(fim.getDate()).padStart(2, '0')}`;
      return [
        'BEGIN:VEVENT',
        `UID:${ev.id}@projetos.cimed`,
        `DTSTAMP:${agora}`,
        `DTSTART;VALUE=DATE:${ev.data.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${fimTxt}`,
        `SUMMARY:${limpo(ev.titulo)}`,
        `DESCRIPTION:${limpo(ev.onde)}`,
        'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY',
        `DESCRIPTION:${limpo(ev.titulo)}`, 'END:VALARM',
        'END:VEVENT',
      ];
    }),
    'END:VCALENDAR',
  ].join(String.fromCharCode(13, 10));

  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Projetos CIMED ${isoHoje()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${eventos.length} prazos exportados — abra o arquivo no Outlook`);
});


// =====================================================================
// SUBTAREFAS
// Projeto com tarefas não tem progresso digitado na mão: o banco calcula
// a porcentagem de concluídas. Uma tarefa que depende de outra só fecha
// depois dela — e quem barra é o Postgres, não a tela.
// =====================================================================
const tarefasDe = (projetoId) =>
  estado.tarefas.filter((t) => t.projeto_id === projetoId)
    .sort((a, b) => a.ordem - b.ordem || a.criado_em.localeCompare(b.criado_em));

function renderTarefas(projetoId) {
  const lista = tarefasDe(projetoId);
  const dono = podeEditar();
  const feitas = lista.filter((t) => t.feita).length;

  $('#tarefas-resumo').textContent = lista.length
    ? `${feitas} de ${lista.length} concluídas · o progresso do projeto vem daqui`
    : 'nenhuma ainda — o progresso segue no controle manual';

  $('#lista-tarefas').innerHTML = lista.length ? lista.map((t) => {
    const pai = t.depende_de ? lista.find((x) => x.id === t.depende_de) : null;
    const travada = pai && !pai.feita;
    const atrasada = !t.feita && t.prazo && paraData(t.prazo) < HOJE;

    return `
      <li class="${t.feita ? 'feita' : ''}${travada ? ' travada' : ''}">
        <input type="checkbox" class="tarefa-check" data-tarefa="${t.id}"
               ${t.feita ? 'checked' : ''} ${!dono || travada ? 'disabled' : ''}
               title="${travada ? 'Depende de: ' + esc(pai.titulo) : 'Marcar como concluída'}">
        <div class="tarefa-corpo">
          <span class="tarefa-titulo">${textoComMencoes(t.titulo)}</span>
          <span class="tarefa-meta">
            ${t.responsavel ? `<b>${esc(t.responsavel)}</b>` : '<i>sem responsável</i>'}
            ${t.prazo ? `<span class="${atrasada ? 'venceu' : ''}">${fmtData(t.prazo)}</span>` : ''}
            ${pai ? `<span class="tarefa-dep">depois de: ${esc(pai.titulo)}</span>` : ''}
            ${t.feita && t.feita_por ? `<span>✓ ${esc(t.feita_por)}</span>` : ''}
          </span>
        </div>
        ${dono ? `
          <select class="tarefa-dep-sel" data-dep="${t.id}" title="Esta tarefa só pode fechar depois de…">
            <option value="">sem dependência</option>
            ${lista.filter((o) => o.id !== t.id)
              .map((o) => `<option value="${o.id}"${o.id === t.depende_de ? ' selected' : ''}>depois de: ${esc(o.titulo.slice(0, 40))}</option>`).join('')}
          </select>
          <button type="button" class="tarefa-apagar" data-apagar-tarefa="${t.id}" title="Remover">×</button>` : ''}
      </li>`;
  }).join('')
    : '<li class="vazio">Nenhuma tarefa. Quebre o projeto em passos para acompanhar de perto.</li>';

  $('#form-tarefa').hidden = !dono;
  $('#linha-modelo').hidden = !dono || !estado.modelos.length;

  $('#sel-modelo').innerHTML = '<option value="">Preencher a partir de um modelo…</option>' +
    estado.modelos.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
}

$('#form-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = $('#tarefa-titulo').value.trim();
  if (!titulo || !estado.editando) return;

  const irmas = tarefasDe(estado.editando);
  const { error } = await sb.from('tarefas').insert({
    projeto_id: estado.editando,
    titulo,
    responsavel: $('#tarefa-resp').value.trim() || null,
    prazo: $('#tarefa-prazo').value || null,
    ordem: irmas.length ? Math.max(...irmas.map((t) => t.ordem)) + 1 : 0,
    criado_por: estado.nome,
  });
  if (error) return toast('Não consegui criar a tarefa: ' + error.message, true);

  await enfileirarMencoes(titulo, estado.editando, 'tarefa');
  $('#tarefa-titulo').value = '';
  $('#tarefa-prazo').value = '';
  const id = estado.editando;
  await carregarTudo();
  renderTarefas(id);
});

$('#lista-tarefas').addEventListener('change', async (e) => {
  const chk = e.target.closest('[data-tarefa]');
  if (chk) {
    const id = chk.dataset.tarefa;
    const r = await sb.from('tarefas')
      .update({ feita: chk.checked, feita_por: chk.checked ? estado.nome : null })
      .eq('id', id);
    if (r.error) {
      chk.checked = !chk.checked;
      return toast(r.error.message.replace('Conclua antes a tarefa', 'Primeiro conclua'), true);
    }
    const proj = estado.editando;
    await carregarTudo();
    renderTarefas(proj);

    return;
  }

  const dep = e.target.closest('[data-dep]');
  if (dep) {
    const r = await sb.from('tarefas')
      .update({ depende_de: dep.value || null }).eq('id', dep.dataset.dep);
    if (r.error) return toast('Erro na dependência: ' + r.error.message, true);
    const proj = estado.editando;
    await carregarTudo();
    renderTarefas(proj);
  }
});

$('#lista-tarefas').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-apagar-tarefa]');
  if (!btn) return;
  const t = estado.tarefas.find((x) => x.id === btn.dataset.apagarTarefa);
  if (!t) return;

  const ok = await confirmar({
    titulo: 'Remover tarefa',
    texto: `A tarefa "${t.titulo}" será apagada do projeto.`,
    perdas: estado.tarefas.some((x) => x.depende_de === t.id)
      ? ['Outra tarefa depende desta e ficará sem dependência'] : [],
    rotulo: 'Remover tarefa',
  });
  if (!ok) return;

  const r = await sb.from('tarefas').delete().eq('id', t.id);
  if (r.error) return toast('Erro ao remover: ' + r.error.message, true);
  const proj = estado.editando;
  await carregarTudo();
  renderTarefas(proj);
});

// ------------------------------------------------- MODELOS DE PROJETO
// Cria as tarefas do modelo em cadeia: cada uma depende da anterior, e o
// prazo sai do início do projeto mais os dias previstos no modelo.
async function aplicarModelo(modeloId, projetoId, projetoRecemCriado) {
  const modelo = estado.modelos.find((m) => m.id === modeloId);
  // num projeto recém-criado ele ainda não está no estado: usamos o que voltou do banco
  const projeto = projetoRecemCriado || estado.projetos.find((p) => p.id === projetoId);
  if (!modelo || !projeto) return;

  // Conta a partir de hoje quando o projeto já começou há tempos: um
  // modelo aplicado agora não deve nascer com todas as tarefas vencidas.
  const inicio = paraData(projeto.data_inicio);
  const base = !inicio || inicio < HOJE ? HOJE : inicio;
  const jaTem = tarefasDe(projetoId).length;
  let anterior = null;

  for (const [i, passo] of (modelo.tarefas || []).entries()) {
    const prazo = new Date(base);
    prazo.setDate(prazo.getDate() + (Number(passo.dias) || 0));

    const r = await sb.from('tarefas').insert({
      projeto_id: projetoId,
      titulo: passo.titulo,
      prazo: `${prazo.getFullYear()}-${String(prazo.getMonth() + 1).padStart(2, '0')}-${String(prazo.getDate()).padStart(2, '0')}`,
      responsavel: projeto.responsavel || null,
      ordem: jaTem + i,
      depende_de: anterior,
      criado_por: estado.nome,
    }).select().single();

    if (r.error) { toast('Erro ao aplicar o modelo: ' + r.error.message, true); break; }
    anterior = r.data.id;
  }
}

$('#btn-aplicar-modelo').addEventListener('click', async () => {
  const id = $('#sel-modelo').value;
  if (!id || !estado.editando) return toast('Escolha um modelo primeiro.', true);
  const proj = estado.editando;
  await aplicarModelo(id, proj);
  await carregarTudo();
  renderTarefas(proj);
  $('#sel-modelo').value = '';
  toast('Modelo aplicado');
});

// ---------------------------------------------------- lista de anexos
function renderAnexos(projetoId) {
  const lista = estado.anexos.filter((a) => a.projeto_id === projetoId);
  const dono = podeEditar();
  $('#lista-anexos').innerHTML = lista.length ? lista.map((a) => `
    <li>
      <button type="button" class="anexo-nome" data-baixar="${a.id}" title="Abrir o arquivo">
        ${esc(a.nome)}
      </button>
      <span class="anexo-info">${fmtTamanho(a.tamanho)} · ${esc(a.autor || '—')} · ${fmtQuando(a.criado_em)}</span>
      ${dono ? `<button type="button" class="anexo-apagar" data-apagar-anexo="${a.id}" title="Remover">×</button>` : ''}
    </li>`).join('')
    : '<li class="vazio">Nenhum arquivo anexado.</li>';
}

function fmtTamanho(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function fecharModal() {
  pararDitado();                 // não deixa o microfone ligado depois de fechar
  $('#modal').hidden = true;
  estado.editando = null;
  document.body.style.overflow = '';
}

$('#f-progresso').addEventListener('input', (e) => {
  $('#out-progresso').textContent = e.target.value + '%';
});

// O status manda: Entregue já joga o progresso para 100 e o campo de
// motivo só aparece quando o projeto sai do fluxo.
$('#f-status').addEventListener('change', (e) => {
  const status = e.target.value;
  $('#campo-motivo').hidden = !FORA_DO_FLUXO.includes(status);

  if (ENTREGUES.includes(status)) {
    $('#f-progresso').value = 100;
    $('#out-progresso').textContent = '100%';
    $('#f-etapa').value = ETAPA_ENTREGUE;
  } else if (FORA_DO_FLUXO.includes(status)) {
    $('#f-etapa').value = ETAPA_PARADA;
    setTimeout(() => $('#f-motivo-parada').focus(), 60);
  } else if ([ETAPA_ENTREGUE, ETAPA_PARADA].includes($('#f-etapa').value)) {
    // voltou ao trabalho: a coluna acompanha, e você vê isso antes de salvar
    $('#f-etapa').value = primeiraEtapaDeFluxo();
  }
});

$('#form-projeto').addEventListener('blur', (e) => {
  if (e.target.matches?.('[data-formato]')) formatarCampoNumero(e.target);
  mostrarGanho();
}, true);

$('#form-projeto').addEventListener('input', (e) => {
  if (e.target.matches?.('[data-formato]')
      || e.target.name === 'data_entrega' || e.target.name === 'data_prevista') mostrarGanho();
});

$('#f-sem_ganho_financeiro').addEventListener('change', (e) => {
  $('#campo-medimos').hidden = !e.target.checked;
  if (e.target.checked) setTimeout(() => $('#f-como_medimos').focus(), 60);
  mostrarGanho();
});

// Entregar em outubro não economiza doze meses: economiza três. A quebra
// aparece aqui para a decisão de data ser tomada vendo o efeito dela.
function quebraPorAno(anual) {
  const total = anual + (numBR($('#f-custo_direto_ano').value) || 0);
  const entrega = $('#f-data_entrega')?.value || '';
  const prevista = $('#f-data_prevista')?.value || '';
  const iso = entrega || prevista;
  if (!iso || !total) return '';

  const ano = HOJE.getFullYear();
  const meses = mesesDeData(iso, ano);
  const rotulo = entrega ? 'entregue' : 'previsto';

  return `<span class="porano">`
    + `<span><b>${fmtReal(total * meses / 12)}</b> em ${ano}`
    + `<i>${meses} de 12 meses · ${rotulo} em ${fmtData(iso)}</i></span>`
    + `<span><b>${fmtReal(total)}</b> em ${ano + 1}<i>ano cheio</i></span>`
    + `</span>`;
}

// O número que a conta produz, à vista, antes de salvar.
function mostrarGanho() {
  const h = numBR($('#f-horas_mes').value);
  const t = numBR($('#f-custo_hora').value);
  const g = ganhoAnual(h, t);
  const el = $('#calc-ganho');

  // marcado como sem ganho financeiro: o bloco para de cobrar número
  if ($('#f-sem_ganho_financeiro').checked) {
    el.className = 'calculado outro';
    el.innerHTML = 'Sem ganho financeiro direto'
      + '<small>este projeto é medido por outro critério, não por R$</small>';
    return;
  }

  if (g !== null) {
    el.className = 'calculado tem';
    el.innerHTML = `Ganho anual: <b>${fmtReal(g)}</b>/ano`
      + `<small>${fmtNum(h, 1)} h/mês × ${fmtReal2(t)}/hora × 12 meses</small>`
      + quebraPorAno(g);
    return;
  }

  // Projeto antigo: tem valor anual digitado à mão, mas não dá para
  // recalcular. Mostrar o valor deixa claro que ele continua valendo.
  const p = estado.projetos.find((x) => x.id === estado.editando);
  if (p && porHoras(p)) {
    el.className = 'calculado antigo';
    el.innerHTML = `Ganho anual: <b>${fmtReal(p.custo_ano)}</b>/ano`
      + '<small>valor antigo, digitado à mão — continua valendo. Informe as horas'
      + ' e o custo da hora para o sistema passar a calcular sozinho.</small>';
    return;
  }

  el.className = 'calculado';
  el.textContent = 'Informe as horas e o custo da hora para o sistema calcular o ganho.';
}

$('#form-projeto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const num = (v) => (v === '' ? null : Number(v));
  const txt = (v) => (v.trim() === '' ? null : v.trim());

  const campos = {
    nome: f.elements.nome.value.trim(),
    descricao: txt(f.elements.descricao.value),
    codigo: txt(f.elements.codigo.value),
    responsavel: txt(f.elements.responsavel.value),
    solicitante: txt(f.elements.solicitante.value),
    motivo_parada: txt(f.elements.motivo_parada.value),
    etapa: f.elements.etapa.value,
    status: f.elements.status.value,
    data_inicio: f.elements.data_inicio.value || null,
    data_prevista: f.elements.data_prevista.value || null,
    data_entrega: f.elements.data_entrega.value || null,
    prioridade: num(f.elements.prioridade.value) || 3,
    pilar: txt(f.elements.pilar.value),
    programa_id: estado.programaAtivo
      || estado.programas.find((pr) => pr.nome === 'Programa de IA')?.id
      || estado.programas[0]?.id || null,
    horas_mes: numBR(f.elements.horas_mes.value),
    custo_hora: numBR(f.elements.custo_hora.value),
    custo_direto_ano: numBR(f.elements.custo_direto_ano.value),
    executante: txt(f.elements.executante.value),
    nps: numBR(f.elements.nps.value),
    sem_ganho_financeiro: f.elements.sem_ganho_financeiro.checked,
    como_medimos: txt(f.elements.como_medimos.value),
    progresso: num(f.elements.progresso.value) || 0,
    proximo_passo: txt(f.elements.proximo_passo.value),
    observacoes: txt(f.elements.observacoes.value),
  };

  // O ganho anual não é digitado: é a conta. Quando dá para calcular, o
  // valor é gravado; quando NÃO dá, custo_ano simplesmente não entra no
  // update e o que estava lá continua lá.
  //
  // Isso não é detalhe: há projeto antigo com valor anual e sem horas
  // (Gestão de Desempenho, R$ 114 mil). Zerar o campo nesse caso apagaria
  // um quarto do portfólio só por alguém abrir a ficha e salvar.
  const anterior = estado.projetos.find((x) => x.id === estado.editando);
  const calculado = ganhoAnual(campos.horas_mes, campos.custo_hora);
  if (calculado !== null) campos.custo_ano = calculado;

  // Regras que o status impõe, iguais às do Quadro
  const entregando = ENTREGUES.includes(campos.status) && !ENTREGUES.includes(anterior?.status);

  if (ENTREGUES.includes(campos.status)) {
    campos.progresso = 100;
    campos.etapa = ETAPA_ENTREGUE;
    if (!campos.data_entrega) campos.data_entrega = isoHoje();
  } else if (FORA_DO_FLUXO.includes(campos.status)) {
    campos.etapa = ETAPA_PARADA;
    campos.data_entrega = null;
  } else if ([ETAPA_ENTREGUE, ETAPA_PARADA].includes(campos.etapa)) {
    // Mesma regra do Quadro: o status manda na coluna. Sem isto, trocar
    // "Entregue" por "Em construção" na ficha deixava o card na coluna de
    // entregues — status dizendo uma coisa, coluna dizendo outra.
    campos.etapa = primeiraEtapaDeFluxo();
    campos.data_entrega = null;
    if (FORA_DO_FLUXO.includes(anterior?.status)) campos.motivo_parada = null;
  }

  const ehNovo = !estado.editando;
  const modeloEscolhido = ehNovo ? $('#f-modelo').value : '';

  try {
    const salvo = await salvarProjeto(estado.editando, campos);

    // as menções escritas nos campos do projeto viram aviso por e-mail
    await enfileirarMencoes(
      [campos.proximo_passo, campos.descricao, campos.observacoes].filter(Boolean).join(' '),
      salvo?.id, 'projeto');

    if (modeloEscolhido && salvo?.id) await aplicarModelo(modeloEscolhido, salvo.id, salvo);

    fecharModal();

    // Projeto novo nasce na Fila, que é a 3ª coluna. Em vez de deixar
    // você procurar, o sistema diz onde ele foi parar e pisca o card.
    if (ehNovo && salvo?.id) {
      estado.destacar = salvo.id;
      setTimeout(() => { estado.destacar = null; renderQuadro(); }, 4000);
    }

    await carregarTudo();
    toast(ehNovo ? `Projeto criado na coluna "${campos.etapa}"` : 'Projeto salvo');
    if (entregando) soltarConfete();
  } catch (err) {
    $('#modal-erro').textContent = 'Não foi possível salvar: ' + err.message;
    $('#modal-erro').hidden = false;
  }
});

$('#btn-excluir').addEventListener('click', async () => {
  const p = estado.projetos.find((x) => x.id === estado.editando);
  if (!p) return;

  // diz o que vai junto antes de perguntar
  const nAnexos = estado.anexos.filter((a) => a.projeto_id === p.id).length;
  const nComent = estado.comentarios.filter((c) => c.projeto_id === p.id).length;
  const nHist = estado.historico.filter((h) => h.projeto_id === p.id).length;
  const perdas = [];
  if (nAnexos) perdas.push(`${nAnexos} arquivo${nAnexos > 1 ? 's' : ''} anexado${nAnexos > 1 ? 's' : ''}`);
  if (nComent) perdas.push(`${nComent} comentário${nComent > 1 ? 's' : ''}`);
  if (nHist) perdas.push(`${nHist} registro${nHist > 1 ? 's' : ''} de histórico`);

  const ok = await confirmar({
    titulo: 'Excluir projeto',
    texto: `Excluir "${p.nome}" apaga o projeto e tudo que está ligado a ele.`,
    perdas,
    rotulo: 'Excluir projeto',
  });
  if (!ok) return;
  const { error } = await sb.from('projetos').delete().eq('id', p.id);
  if (error) return toast('Erro ao excluir: ' + error.message, true);
  fecharModal();
  await carregarTudo();
  toast('Projeto excluído');
});

$('#form-comentario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#comentario-texto').value.trim();
  if (!texto || !estado.editando) return;
  const { error } = await sb.from('comentarios')
    .insert({ projeto_id: estado.editando, autor: estado.nome, texto });
  if (error) return toast('Erro ao comentar: ' + error.message, true);
  await enfileirarMencoes(texto, estado.editando, 'comentario');
  $('#comentario-texto').value = '';
  const id = estado.editando;
  await carregarTudo();
  const lista = estado.comentarios.filter((c) => c.projeto_id === id);
  $('#lista-comentarios').innerHTML = lista.map(itemRecado).join('');
});

$('#btn-novo').addEventListener('click', () => abrirProjeto(null));

// =====================================================================
// EXPORTAR EXCEL — leva o que está filtrado na tela, com TODOS os campos
// (inclusive os que o card não mostra: custo, datas, observações)
// =====================================================================
$('#btn-excel').addEventListener('click', async () => {
  const lista = ordenarCards(projetosFiltrados());
  if (!lista.length) return toast('Nada para exportar com esse filtro.', true);

  toast('Montando a planilha…');
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const XLSX = mod.default || mod;
    const data = (v) => (v ? fmtData(v) : '');

    const linhas = lista.map((p) => {
      const r = calcRag(p);
      const ck = compChave(p.compliance_necessario);
      return {
        'Programa': estado.programas.find((pr) => pr.id === p.programa_id)?.nome || '',
        'Código': p.codigo || '',
        'Projeto': p.nome,
        'Pilar': p.pilar || '',
        'Etapa': p.etapa,
        'Status': p.status,
        'Semáforo': RAG[r.k].nome,
        'Situação': r.motivo,
        'Responsável': p.responsavel || '',
        'Quem executa hoje': p.executante || '',
        'Solicitante': p.solicitante || '',
        'Horas/mês': p.horas_mes ?? '',
        'Custo da hora (R$)': p.custo_hora ?? '',
        'Ganho por horas (R$/ano)': p.custo_ano ?? '',
        'Custo direto evitado (R$/ano)': p.custo_direto_ano ?? '',
        'Ganho anual total (R$)': valorAno(p) || '',
        'Sem ganho financeiro': p.sem_ganho_financeiro ? 'Sim' : '',
        'Como medimos': p.como_medimos || '',
        'NPS': p.nps ?? '',
        [`Capturado em ${HOJE.getFullYear()} (R$)`]:
          Math.round(capturadoNoAno(p, HOJE.getFullYear(), false) * 100) / 100,
        'Meses rodando no ano': mesesNoAno(p, HOJE.getFullYear(), false),
        'Início': data(p.data_inicio),
        'Previsão de entrega': data(p.data_prevista),
        'Entregue em': data(p.data_entrega),
        'Progresso (%)': p.progresso,
        'Prioridade': p.prioridade,
        'Próximo passo': p.proximo_passo || '',
        'Motivo da parada': p.motivo_parada || '',
        'Compliance': ck ? COMPLIANCE[ck].rot : 'a definir',
        'Observação do Compliance': p.compliance_obs || '',
        'Anexos': estado.anexos.filter((a) => a.projeto_id === p.id).length,
        'Comentários': estado.comentarios.filter((c) => c.projeto_id === p.id).length,
        'Observações': p.observacoes || '',
        'Atualizado em': p.atualizado_em ? new Date(p.atualizado_em).toLocaleString('pt-BR') : '',
        'Atualizado por': p.atualizado_por || '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = Object.keys(linhas[0]).map((k) => ({
      wch: ['Projeto', 'Próximo passo', 'Observações', 'Observação do Compliance', 'Motivo da parada']
        .includes(k) ? 42 : Math.max(12, k.length + 3),
    }));
    ws['!autofilter'] = { ref: ws['!ref'] };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projetos');
    XLSX.writeFile(wb, `Projetos CIMED ${isoHoje()}.xlsx`);
    toast(`Planilha gerada com ${linhas.length} projetos`);
  } catch (err) {
    toast('Não consegui gerar a planilha: ' + err.message, true);
  }
});

// =====================================================================
// COMPLIANCE — o bloco que o time de Controles responde
// =====================================================================
$('#btn-salvar-compliance').addEventListener('click', async () => {
  if (!estado.editando) return;
  const campos = camposCompliance($('#f-compliance').value);
  campos.compliance_obs = $('#f-compliance-obs').value.trim() || null;
  await mudarCampo(estado.editando, campos);
  $('#compliance-quem').textContent = `${estado.nome} · agora`;
  toast('Compliance atualizado');
});

// =====================================================================
// ANEXOS — arquivos e transcrições de cada projeto
// O bucket é privado: o download passa por um link temporário de 60 s.
// =====================================================================
const nomeSeguro = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);

$('#input-anexo').addEventListener('change', async (e) => {
  const arquivos = [...e.target.files];
  e.target.value = '';
  if (!arquivos.length || !estado.editando) return;

  const st = $('#anexo-status');
  const limite = LIMITE_ANEXO_MB * 1048576;
  const projeto = estado.editando;
  let enviados = 0;

  for (const arq of arquivos) {
    st.hidden = false;
    st.className = 'anexo-status';
    st.textContent = `Enviando "${arq.name}"…`;

    if (arq.size > limite) {
      st.className = 'anexo-status erro';
      st.textContent = `"${arq.name}" tem ${fmtTamanho(arq.size)} e o limite é ${LIMITE_ANEXO_MB} MB.`;
      continue;
    }

    const caminho = `${projeto}/${Date.now()}-${nomeSeguro(arq.name)}`;
    const up = await sb.storage.from(BUCKET).upload(caminho, arq);
    if (up.error) {
      st.className = 'anexo-status erro';
      st.textContent = up.error.message.includes('Bucket not found')
        ? 'O armazenamento ainda não existe. Rode o 03-anexos-e-controles.sql no Supabase.'
        : `Falhou o envio de "${arq.name}": ${up.error.message}`;
      continue;
    }

    const reg = await sb.from('anexos').insert({
      projeto_id: projeto, nome: arq.name, caminho,
      tamanho: arq.size, tipo: arq.type || null, autor: estado.nome,
    });
    if (reg.error) {
      await sb.storage.from(BUCKET).remove([caminho]);   // não deixa arquivo órfão
      st.className = 'anexo-status erro';
      st.textContent = `Não registrei "${arq.name}": ${reg.error.message}`;
      continue;
    }
    enviados++;
  }

  await carregarTudo();
  renderAnexos(projeto);
  if (enviados) {
    st.className = 'anexo-status ok';
    st.textContent = enviados === 1 ? '1 arquivo anexado.' : `${enviados} arquivos anexados.`;
  }
});

$('#lista-anexos').addEventListener('click', async (e) => {
  const abrir = e.target.closest('[data-baixar]');
  if (abrir) {
    const a = estado.anexos.find((x) => x.id === abrir.dataset.baixar);
    if (!a) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.caminho, 60);
    if (error || !data?.signedUrl) return toast('Não consegui abrir: ' + (error?.message || 'link inválido'), true);
    window.open(data.signedUrl, '_blank', 'noopener');
    return;
  }

  const apagar = e.target.closest('[data-apagar-anexo]');
  if (apagar) {
    const a = estado.anexos.find((x) => x.id === apagar.dataset.apagarAnexo);
    if (!a) return;
    const ok = await confirmar({
      titulo: 'Remover anexo',
      texto: `O arquivo "${a.nome}" será apagado do armazenamento.`,
      perdas: [`${fmtTamanho(a.tamanho)} · enviado por ${a.autor || '—'}`],
      rotulo: 'Remover arquivo',
    });
    if (!ok) return;
    const rm = await sb.storage.from(BUCKET).remove([a.caminho]);
    if (rm.error) return toast('Erro ao remover o arquivo: ' + rm.error.message, true);
    const del = await sb.from('anexos').delete().eq('id', a.id);
    if (del.error) return toast('Erro ao remover o registro: ' + del.error.message, true);
    const projeto = a.projeto_id;
    await carregarTudo();
    renderAnexos(projeto);
    toast('Anexo removido');
  }
});

// =====================================================================
// DITADO — fala vira texto nos campos grandes (Descrição e Observações)
// Usa o reconhecimento de voz do próprio navegador.
// =====================================================================
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let ditando = null;

function ligarDitado() {
  if (!Reconhecimento) return;    // navegador sem suporte: o botão fica escondido
  $$('[data-ditar]').forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener('click', () => (ditando ? pararDitado() : comecarDitado(btn)));
  });
}

function comecarDitado(btn) {
  const campo = $('#' + btn.dataset.ditar);
  if (campo.disabled) return;

  const rec = new Reconhecimento();
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = true;

  const base = campo.value;
  let firme = '';
  const junta = (a, b) => (a && b ? a.replace(/\s+$/, '') + ' ' + b.replace(/^\s+/, '') : a + b);

  rec.onresult = (ev) => {
    let parcial = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const trecho = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) firme += trecho; else parcial += trecho;
    }
    campo.value = junta(junta(base, firme), parcial);
    campo.scrollTop = campo.scrollHeight;
  };

  rec.onerror = (ev) => {
    toast(ev.error === 'not-allowed'
      ? 'Permita o microfone na barra de endereço do Chrome.'
      : 'Ditado interrompido: ' + ev.error, true);
    pararDitado();
  };
  rec.onend = () => { if (ditando) pararDitado(); };

  ditando = { rec, btn };
  btn.classList.add('gravando');
  btn.querySelector('.rot').textContent = 'Gravando · clique para parar';
  try { rec.start(); } catch { pararDitado(); }
}

function pararDitado() {
  if (!ditando) return;
  const { rec, btn } = ditando;
  ditando = null;
  try { rec.stop(); } catch { /* já estava parado */ }
  btn.classList.remove('gravando');
  btn.querySelector('.rot').textContent = 'Ditar';
}

ligarDitado();

// =====================================================================
// APP INSTALÁVEL (PWA)
// Guarda só a casca do site para abrir rápido no celular. Dado de
// projeto nunca fica no cache: sem rede o app diz que não conectou,
// em vez de mostrar número velho como se fosse o de agora.
// =====================================================================
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => console.warn('Service worker não registrado:', err.message));
  });
}

// ------------------------------------------------- abrir/fechar genéricos
// A tabela também responde o Compliance, sem abrir a ficha.
document.addEventListener('click', (e) => {
  // a confirmação vem antes de tudo: enquanto ela estiver aberta,
  // nenhum outro clique da tela deve valer
  if (e.target.closest('[data-cancelar-confirma]')) return fecharConfirma(false);
  if (!$('#confirmar').hidden) return;

  // clique em campo de formulário nunca abre a ficha: senão mexer no
  // seletor de Compliance ou de etapa abriria o modal junto
  if (e.target.closest('select, input, textarea')) return;

  // o clique que o navegador dispara ao fim de um arrasto não conta
  if (estado.arrastouAgora && Date.now() - estado.arrastouAgora < 400) return;

  if (e.target.closest('[data-fechar]')) return fecharModal();

  const alvo = e.target.closest('[data-abrir]');
  if (alvo) { abrirProjeto(alvo.dataset.abrir); return; }

});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#confirmar').hidden) return fecharConfirma(false);
  if (!$('#modal').hidden) fecharModal();
});
