// =====================================================================
// CIMED · Sistema de Gestão de Projetos
// Front-end estático (GitHub Pages) + Supabase (banco e login).
// Nenhuma configuração aqui: edite config.js.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PESSOAS, REGRAS, LIMITE_ANEXO_MB } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------- CONSTANTES
// A ordem manda no Quadro: o que exige ação primeiro, o que saiu do fluxo no fim.
const ETAPAS = ['Prioritário', 'Protótipo e ajustes', 'Fila', 'Entregue', 'Congelado / Cancelado'];
const STATUS = ['Não iniciado', 'Em mapeamento', 'Em construção', 'Em ajustes',
                'Entregue', 'Congelado', 'Cancelado', 'Descontinuado'];

// Status que tiram o projeto do fluxo: não cobram prazo e vivem na
// última coluna do Quadro.
const CONGELADOS = ['Congelado'];
const ENCERRADOS = ['Cancelado', 'Descontinuado'];
const FORA_DO_FLUXO = [...CONGELADOS, ...ENCERRADOS];
const ETAPA_PARADA = 'Congelado / Cancelado';
const ETAPA_ENTREGUE = 'Entregue';

const RAG = {
  r: { nome: 'Atrasado',  cls: 'r', cor: 'var(--vermelho)' },
  a: { nome: 'Atenção',   cls: 'a', cor: 'var(--ambar)' },
  v: { nome: 'No prazo',  cls: 'v', cor: 'var(--verde)' },
  c: { nome: 'Entregue',  cls: 'c', cor: 'var(--entregue)' },
  s: { nome: 'Sem prazo', cls: 'n', cor: 'var(--cinza-claro)' },
  z: { nome: 'Congelado', cls: 'z', cor: 'var(--congelado)' },
  x: { nome: 'Cancelado', cls: 'x', cor: 'var(--cancelado)' },
};
const ORDEM_RAG = ['r', 'a', 'v', 's', 'c', 'z', 'x'];

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
  gestao:    { abas: ['visao', 'quadro', 'cronograma', 'projetos', 'notificacoes'], editaProjeto: true },
  controles: { abas: ['quadro', 'projetos'],                                       editaProjeto: false },
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
  lidoAte: null,
  view: 'visao',
  filtroRag: '',
  ordem: { campo: 'prioridade', asc: true },
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

  if (p.status === 'Entregue' || p.data_entrega) return { k: 'c', motivo: 'Entregue' };
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
    .select('papel').eq('user_id', user.id).maybeSingle();

  if (error) {
    console.warn('Tabela perfis indisponível, usando o config.js:', error.message);
    return PESSOAS[user.email]?.papel || null;
  }
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

// Esconde as abas que o papel não alcança e trava o que ele não edita.
function aplicarPapel() {
  const abas = PAPEIS[estado.papel]?.abas || PAPEIS.gestao.abas;
  $$('.nav-item').forEach((b) => { b.hidden = !abas.includes(b.dataset.view); });
  if (!abas.includes(estado.view)) irPara(abas[0]);

  const dono = podeEditar();
  $('#btn-novo').hidden = !dono;
  document.body.classList.toggle('somente-compliance', !dono);
}

// =====================================================================
// DADOS
// =====================================================================
async function carregarTudo() {
  const [proj, com, hist, anx, leit] = await Promise.all([
    sb.from('projetos').select('*').eq('arquivado', false),
    sb.from('comentarios').select('*').order('criado_em', { ascending: false }).limit(200),
    sb.from('historico').select('*').order('criado_em', { ascending: false }).limit(200),
    sb.from('anexos').select('*').order('criado_em', { ascending: false }),
    sb.from('leituras').select('lido_ate').eq('user_id', estado.usuario.id).maybeSingle(),
  ]);

  const falha = proj.error || com.error || hist.error;
  $('#sync').className = 'sync ' + (falha ? 'erro' : 'ok');
  $('#sync').title = falha ? 'Erro de conexão: ' + falha.message : 'Conectado ao banco';
  if (falha) { toast('Erro ao carregar dados: ' + falha.message, true); return; }

  estado.projetos = proj.data || [];
  estado.comentarios = com.data || [];
  estado.historico = hist.data || [];
  estado.anexos = anx.data || [];     // sem erro fatal: se a tabela ainda não existe, só não lista
  estado.lidoAte = leit.data?.lido_ate || null;

  if (anx.error) console.warn('Anexos indisponíveis — rode o 03-anexos-e-controles.sql:', anx.error.message);

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
  if (!b) return;
  irPara(b.dataset.view);
});

function irPara(view) {
  estado.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('ativo', b.dataset.view === view));
  $$('.view').forEach((s) => s.classList.toggle('ativa', s.id === 'view-' + view));
  if (view === 'cronograma') renderGantt();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// A lista suspensa de Responsável e Solicitante: quem já é responsável por
// algum projeto, mais todo mundo com login. Continua aceitando nome novo.
function montarListaPessoas() {
  const nomes = [...new Set([
    ...MENCIONAVEIS,
    ...estado.projetos.map((p) => p.responsavel).filter(Boolean),
    ...estado.projetos.map((p) => p.solicitante).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#lista-pessoas').innerHTML = nomes.map((n) => `<option value="${esc(n)}"></option>`).join('');
}

function renderTudo() {
  renderVisao();
  renderFiltros();
  montarListaPessoas();
  renderTabela();
  renderNotificacoes();
  if (estado.view === 'cronograma') renderGantt();
  $('#rodape-atualizacao').textContent = 'Atualizado ' + fmtQuando(new Date().toISOString());
}

// =====================================================================
// VISÃO GERAL
// =====================================================================
function renderVisao() {
  const ps = estado.projetos;
  const cont = { r: 0, a: 0, v: 0, s: 0, c: 0 };
  ps.forEach((p) => cont[calcRag(p).k]++);

  const ativos = ps.filter((p) => p.status !== 'Entregue');
  const horas = ativos.reduce((s, p) => s + Number(p.horas_mes || 0), 0);
  const custo = ps.reduce((s, p) => s + Number(p.custo_ano || 0), 0);

  $('#visao-sub').textContent =
    `${ps.length} projetos no portfólio · ${ativos.length} em andamento · ${cont.c} entregues`;

  $('#kpis').innerHTML = [
    ['destaque', 'Projetos ativos', ativos.length, 'de ' + ps.length + ' no portfólio'],
    ['r', 'Atrasados', cont.r, 'prazo vencido'],
    ['a', 'Em atenção', cont.a, 'vencem em até ' + REGRAS.diasAtencao + ' dias'],
    ['v', 'No prazo', cont.v, 'sem risco de data'],
    ['', 'Horas/mês devolvidas', fmtNum(horas, 1), 'quando as frentes ativas entrarem'],
    ['', 'Custo evitado/ano', fmtReal(custo), 'somatório do portfólio'],
  ].map(([cls, rot, num, pe]) => `
    <div class="kpi ${cls}">
      <div class="kpi-rot">${esc(rot)}</div>
      <div class="kpi-num">${esc(num)}</div>
      <div class="kpi-pe">${esc(pe)}</div>
    </div>`).join('');

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

// =====================================================================
// QUADRO (Kanban) — arrastar muda a etapa; status e progresso mudam no
// próprio card. A ficha completa só abre quando você clica no nome.
// =====================================================================
function renderQuadro() {
  const cont = { r: 0, a: 0, v: 0, s: 0, c: 0 };
  estado.projetos.forEach((p) => cont[calcRag(p).k]++);

  $('#filtros-rag').innerHTML =
    `<button class="chip ${estado.filtroRag === '' ? 'ativo' : ''}" data-rag="">Todos</button>` +
    ORDEM_RAG.filter((k) => cont[k]).map((k) =>
      `<button class="chip ${estado.filtroRag === k ? 'ativo' : ''}" data-rag="${k}">${RAG[k].nome} (${cont[k]})</button>`).join('');

  const lista = estado.filtroRag
    ? estado.projetos.filter((p) => calcRag(p).k === estado.filtroRag)
    : estado.projetos;

  $('#kanban').innerHTML = ETAPAS.map((etapa) => {
    const ps = lista.filter((p) => p.etapa === etapa)
      .sort((a, b) => (a.prioridade - b.prioridade) || (a.codigo || '').localeCompare(b.codigo || ''));
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
  }).join('');
}

function cardKanban(p) {
  const r = calcRag(p);
  const dono = podeEditar();
  const coments = estado.comentarios.filter((c) => c.projeto_id === p.id);
  const nAnexos = estado.anexos.filter((a) => a.projeto_id === p.id).length;
  const corte = estado.lidoAte ? new Date(estado.lidoAte) : new Date(0);
  const chamou = coments.some((c) =>
    c.autor !== estado.nome && mencionaMim(c.texto) && new Date(c.criado_em) > corte);
  const ck = compChave(p.compliance_necessario);

  const parado = FORA_DO_FLUXO.includes(p.status);

  // O card inteiro abre a ficha. Os controles internos param o clique
  // antes de chegar aqui, então mexer no status não abre nada.
  return `
    <article class="kcard ${RAG[r.k].cls}${estado.destacar === p.id ? ' novinho' : ''}"
             ${dono ? 'draggable="true"' : ''}
             data-id="${p.id}" data-abrir="${p.id}" title="Abrir a ficha completa">
      <div class="kcard-topo">
        <span class="pill ${RAG[r.k].cls}" title="${esc(r.motivo)}">${RAG[r.k].nome}</span>
        ${dono && ck === 'sim' ? '<span class="kcomp sim">Compliance</span>' : ''}
      </div>
      <h5>${esc(p.nome)}</h5>
      <div class="kcard-meta">
        <span>${esc(p.responsavel || 'sem responsável')}</span>
        ${p.horas_mes ? `<span>${fmtNum(p.horas_mes, 1)} h/mês</span>` : ''}
        ${parado ? '' : `<span>${fmtData(p.data_prevista)}</span>`}
        ${nAnexos ? `<span class="kanexo">${nAnexos} anexo${nAnexos > 1 ? 's' : ''}</span>` : ''}
        ${chamou ? '<span class="kmencao">@você</span>'
          : coments.length ? `<span class="kcoment">${coments.length} coment.</span>` : ''}
      </div>
      ${dono ? `
        <select class="kcard-status" data-status="${p.id}" draggable="false" title="Mudar o status">
          ${STATUS.map((s) => `<option${s === p.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}
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
        : p.proximo_passo ? `<p class="kcard-passo">→ ${textoComMencoes(p.proximo_passo)}</p>` : ''}
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
let arrastando = null;

function ligarQuadro() {
  const kb = $('#kanban');

  kb.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kcard');
    if (!card) return;
    arrastando = card.dataset.id;
    card.classList.add('arrastando');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', arrastando);
  });

  kb.addEventListener('dragend', () => {
    $$('.kcard').forEach((c) => c.classList.remove('arrastando'));
    $$('.kcol').forEach((c) => c.classList.remove('alvo'));
    arrastando = null;
  });

  kb.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kcol');
    if (!col || !arrastando) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.kcol').forEach((c) => c.classList.toggle('alvo', c === col));
  });

  kb.addEventListener('drop', (e) => {
    const col = e.target.closest('.kcol');
    if (!col || !arrastando) return;
    e.preventDefault();
    const id = arrastando;
    arrastando = null;
    $$('.kcol').forEach((c) => c.classList.remove('alvo'));
    const p = estado.projetos.find((x) => x.id === id);
    if (p) mudarCampo(id, camposParaEtapa(p, col.dataset.etapa));
  });

  // status e compliance mudam direto no card
  kb.addEventListener('change', async (e) => {
    const st = e.target.closest('[data-status]');
    if (st) {
      const p = estado.projetos.find((x) => x.id === st.dataset.status);
      if (!p) return;
      const entregando = st.value === 'Entregue' && p.status !== 'Entregue';
      await mudarCampo(p.id, camposParaStatus(p, st.value));
      if (entregando) soltarConfete();
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

// Soltar na coluna "Entregue" é dizer que o projeto saiu — então o card
// passa a 100%, ganha data de entrega e o semáforo acompanha. Tirar de lá
// desfaz isso, senão ele ficaria verde para sempre.
const isoHoje = () =>
  `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, '0')}-${String(HOJE.getDate()).padStart(2, '0')}`;

function camposParaEtapa(p, etapa) {
  const campos = { etapa };

  if (etapa === ETAPA_ENTREGUE && p.etapa !== ETAPA_ENTREGUE) {
    campos.status = 'Entregue';
    campos.progresso = 100;
    if (!p.data_entrega) campos.data_entrega = isoHoje();

  } else if (etapa === ETAPA_PARADA && p.etapa !== ETAPA_PARADA) {
    // entrou na coluna de parados: congelado é o padrão, cancelar é decisão
    if (!FORA_DO_FLUXO.includes(p.status)) campos.status = 'Congelado';
    campos.data_entrega = null;

  } else if (etapa !== ETAPA_ENTREGUE && p.etapa === ETAPA_ENTREGUE) {
    campos.data_entrega = null;
    if (p.status === 'Entregue') campos.status = 'Em construção';

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

  if (status === 'Entregue') {
    campos.progresso = 100;
    campos.etapa = ETAPA_ENTREGUE;
    if (!p.data_entrega) campos.data_entrega = isoHoje();

  } else if (FORA_DO_FLUXO.includes(status)) {
    campos.etapa = ETAPA_PARADA;
    campos.data_entrega = null;

  } else {
    if (p.status === 'Entregue') campos.data_entrega = null;
    if (p.etapa === ETAPA_ENTREGUE || p.etapa === ETAPA_PARADA) campos.etapa = 'Prioritário';
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
  const ps = estado.projetos
    .filter((p) => p.data_prevista)
    .sort((a, b) => paraData(a.data_prevista) - paraData(b.data_prevista));

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
// TABELA DE PROJETOS
// =====================================================================
function projetosFiltrados() {
  const busca = $('#busca').value.trim().toLowerCase();
  const fE = $('#filtro-etapa').value;
  const fS = $('#filtro-status').value;
  const fR = $('#filtro-resp').value;

  let lista = estado.projetos.filter((p) => {
    if (fE && p.etapa !== fE) return false;
    if (fS && p.status !== fS) return false;
    if (fR && p.responsavel !== fR) return false;
    if (busca) {
      const alvo = [p.nome, p.codigo, p.responsavel, p.proximo_passo, p.descricao].join(' ').toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  const { campo, asc } = estado.ordem;
  const valor = (p) => {
    if (campo === 'rag') return ORDEM_RAG.indexOf(calcRag(p).k);
    // "acompanhar" primeiro, depois "a definir", depois "não precisa"
    if (campo === 'compliance') return p.compliance_necessario === true ? 0
      : p.compliance_necessario === null || p.compliance_necessario === undefined ? 1 : 2;
    return p[campo];
  };
  lista.sort((a, b) => {
    let x = valor(a);
    let y = valor(b);
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'string') return asc ? x.localeCompare(y, 'pt-BR') : y.localeCompare(x, 'pt-BR');
    return asc ? x - y : y - x;
  });
  return lista;
}

// Os selects só são reconstruídos quando os dados mudam — nunca durante a
// digitação, para não fechar o dropdown nem perder o foco.
function renderFiltros() {
  const opcoes = (sel, vals, rot) => {
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rot}</option>` +
      vals.map((v) => `<option${v === atual ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  opcoes($('#filtro-etapa'), ETAPAS, 'Todas as etapas');
  opcoes($('#filtro-status'), STATUS, 'Todos os status');
  opcoes($('#filtro-resp'),
    [...new Set(estado.projetos.map((p) => p.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    'Todos os responsáveis');
}

function renderTabela() {
  const lista = projetosFiltrados();

  $('#tabela-corpo').innerHTML = lista.length ? lista.map((p) => {
    const r = calcRag(p);
    return `
      <tr data-abrir="${p.id}">
        <td class="t-cod">${esc(p.codigo || '—')}</td>
        <td class="t-nome">${esc(p.nome)}</td>
        <td>${esc(p.etapa)}</td>
        <td>${esc(p.status)}</td>
        <td>${esc(p.responsavel || '—')}</td>
        <td class="num">${fmtNum(p.horas_mes, 1)}</td>
        <td>${fmtData(p.data_prevista)}</td>
        <td class="num">
          <div class="mini-prog">
            <div class="barra"><span style="width:${p.progresso}%"></span></div>
            <span>${p.progresso}%</span>
          </div>
        </td>
        <td><span class="pill ${RAG[r.k].cls}" title="${esc(r.motivo)}">${RAG[r.k].nome}</span></td>
        <td>${podeEditar()
          ? (compChave(p.compliance_necessario)
              ? `<span class="pill comp ${COMPLIANCE[compChave(p.compliance_necessario)].cls}"
                       title="${esc(p.compliance_obs || '')}">${COMPLIANCE[compChave(p.compliance_necessario)].rot}</span>`
              : '<span class="comp-vazio">a definir</span>')
          : selectCompliance(p, 'tabela-compliance')}</td>
      </tr>`;
  }).join('') : '<tr><td colspan="10" class="vazio">Nenhum projeto encontrado com esses filtros.</td></tr>';

  $('#contagem').textContent = `${lista.length} de ${estado.projetos.length} projetos`;
}

['#busca', '#filtro-etapa', '#filtro-status', '#filtro-resp'].forEach((s) =>
  $(s).addEventListener('input', renderTabela));

$('#limpar-filtros').addEventListener('click', () => {
  $('#busca').value = '';
  ['#filtro-etapa', '#filtro-status', '#filtro-resp'].forEach((s) => { $(s).value = ''; });
  renderTabela();
});

$$('.tabela th').forEach((th) => th.addEventListener('click', () => {
  const campo = th.dataset.ord;
  estado.ordem = { campo, asc: estado.ordem.campo === campo ? !estado.ordem.asc : true };
  renderTabela();
}));

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
  $('#f-status').innerHTML = STATUS.map((v) => `<option>${esc(v)}</option>`).join('');
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
  ['nome', 'descricao', 'codigo', 'responsavel', 'solicitante', 'etapa', 'status',
   'data_inicio', 'data_prevista', 'data_entrega', 'prioridade', 'horas_mes',
   'custo_ano', 'progresso', 'proximo_passo', 'motivo_parada', 'observacoes'].forEach((campo) => {
    f.elements[campo].value = vals[campo] ?? '';
  });
  $('#out-progresso').textContent = (vals.progresso || 0) + '%';
  $('#campo-motivo').hidden = !FORA_DO_FLUXO.includes(vals.status);

  // comentários do projeto
  const doProjeto = estado.comentarios.filter((c) => c.projeto_id === id);
  $('.modal-comentarios').hidden = !p;
  $('#lista-comentarios').innerHTML = doProjeto.length ? doProjeto.map(itemRecado).join('')
    : '<li class="vazio">Nenhum comentário neste projeto.</li>';

  // ------------------------------------------------------- compliance
  const dono = podeEditar();
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

  if (status === 'Entregue') {
    $('#f-progresso').value = 100;
    $('#out-progresso').textContent = '100%';
    $('#f-etapa').value = ETAPA_ENTREGUE;
  } else if (FORA_DO_FLUXO.includes(status)) {
    $('#f-etapa').value = ETAPA_PARADA;
    setTimeout(() => $('#f-motivo-parada').focus(), 60);
  }
});

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
    horas_mes: num(f.elements.horas_mes.value),
    custo_ano: num(f.elements.custo_ano.value),
    progresso: num(f.elements.progresso.value) || 0,
    proximo_passo: txt(f.elements.proximo_passo.value),
    observacoes: txt(f.elements.observacoes.value),
  };

  // Regras que o status impõe, iguais às do Quadro
  const anterior = estado.projetos.find((x) => x.id === estado.editando);
  const entregando = campos.status === 'Entregue' && anterior?.status !== 'Entregue';

  if (campos.status === 'Entregue') {
    campos.progresso = 100;
    campos.etapa = ETAPA_ENTREGUE;
    if (!campos.data_entrega) campos.data_entrega = isoHoje();
  } else if (FORA_DO_FLUXO.includes(campos.status)) {
    campos.etapa = ETAPA_PARADA;
    campos.data_entrega = null;
  }

  const ehNovo = !estado.editando;

  try {
    const salvo = await salvarProjeto(estado.editando, campos);
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
  $('#comentario-texto').value = '';
  const id = estado.editando;
  await carregarTudo();
  const lista = estado.comentarios.filter((c) => c.projeto_id === id);
  $('#lista-comentarios').innerHTML = lista.map(itemRecado).join('');
});

$('#btn-novo').addEventListener('click', () => abrirProjeto(null));

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

// ------------------------------------------------- abrir/fechar genéricos
// A tabela também responde o Compliance, sem abrir a ficha.
$('#tabela').addEventListener('change', (e) => {
  const cp = e.target.closest('[data-compliance]');
  if (cp) mudarCampo(cp.dataset.compliance, camposCompliance(cp.value));
});

document.addEventListener('click', (e) => {
  // a confirmação vem antes de tudo: enquanto ela estiver aberta,
  // nenhum outro clique da tela deve valer
  if (e.target.closest('[data-cancelar-confirma]')) return fecharConfirma(false);
  if (!$('#confirmar').hidden) return;

  // clique em campo de formulário nunca abre a ficha: senão mexer no
  // seletor de Compliance dentro de uma linha da tabela abriria o modal
  if (e.target.closest('select, input, textarea')) return;

  if (e.target.closest('[data-fechar]')) return fecharModal();

  const alvo = e.target.closest('[data-abrir]');
  if (alvo) { abrirProjeto(alvo.dataset.abrir); return; }

  const chip = e.target.closest('[data-rag]');
  if (chip) { estado.filtroRag = chip.dataset.rag; renderVisao(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#confirmar').hidden) return fecharConfirma(false);
  if (!$('#modal').hidden) fecharModal();
});
