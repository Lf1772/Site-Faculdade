/* Tutor IA do Curso·Jurídico — Firebase Function (2ª geração).
   Recebe a pergunta do aluno, confere se ele está logado e aprovado, monta o
   contexto com o conteúdo da matéria (lido do Firestore) e devolve a resposta
   do Claude em streaming. A chave da API da Anthropic fica só aqui, guardada
   como secret do Firebase — nunca vai para o navegador. Ver TUTOR_IA.md. */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/* Mesmos valores do index.html / regras do Firestore */
const ADMIN_EMAIL = 'luizflafelipe10@gmail.com';
const SEMESTER_END = new Date('2026-12-14T03:00:00Z');
const SUBJECTS = {
  trabalho: 'Direito do Trabalho',
  processo: 'Processo Civil',
  penal: 'Proteção Penal',
  obrigacoes: 'Direito das Obrigações Civis',
  licitacoes: 'Licitações e Contratos Administrativos'
};

const MODEL = 'claude-opus-5-5';
const DAILY_LIMIT = 30;          // perguntas por aluno por dia (o admin não tem limite)
const MAX_HISTORY = 12;          // mensagens anteriores enviadas ao modelo
const MAX_MSG_CHARS = 2000;      // tamanho máximo de cada mensagem do aluno

const ALLOWED_ORIGINS = [
  'https://meucursojuridico.com.br',
  'https://www.meucursojuridico.com.br',
  'https://lf1772.github.io',
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

/* ---------- conteúdo da matéria → texto puro (com cache em memória) ---------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', ordm: 'º', ordf: 'ª', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»' };
function htmlToText(html = '') {
  return String(html)
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

const contentCache = new Map(); // subject -> { at, text, lessons }
async function subjectContent(subject) {
  const hit = contentCache.get(subject);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
  const snap = await db.collection('content').doc(subject).get();
  const lessons = (snap.exists && Array.isArray(snap.data().lessons)) ? snap.data().lessons : [];
  const text = lessons.map(l => {
    const parts = [`# ${(l.av || 1) === 2 ? 'AV2' : 'AV1'} · Aula ${l.id}: ${l.title}${l.subtitle ? ` — ${l.subtitle}` : ''}`];
    for (const s of l.sections || []) parts.push(`## ${s.h}\n${htmlToText(s.body)}`);
    if (l.casos?.length) parts.push('## Situações práticas\n' + l.casos.map(c => `### ${c.t}\n${htmlToText(c.resumo)}\n${htmlToText(c.detalhe)}`).join('\n\n'));
    return parts.join('\n\n');
  }).join('\n\n---\n\n');
  const entry = { at: Date.now(), text, lessons: lessons.map(l => ({ id: l.id, title: l.title, av: l.av || 1 })) };
  contentCache.set(subject, entry);
  return entry;
}

function systemPrompt(subjectName) {
  return `Você é o Tutor IA do Curso·Jurídico, um guia de estudos de Direito para alunos de graduação no Brasil. A matéria atual é ${subjectName}.

Como responder:
- Escreva em português do Brasil, com linguagem clara e didática, como um bom monitor explicaria a um colega.
- Baseie-se primeiro no material do curso (abaixo). Quando citar artigo de lei, súmula ou entendimento, diga de onde vem. Se algo não estiver no material, você pode usar seu conhecimento geral de Direito brasileiro, mas avise que aquilo vai além do material e que a legislação pode ter mudado.
- Se não tiver certeza, diga isso. Nunca invente número de artigo, súmula ou julgado.
- Seja objetivo: respostas curtas por padrão (alguns parágrafos ou uma lista). Aprofunde quando o aluno pedir.
- Para ajudar a fixar, você pode propor um exemplo prático ou uma pergunta rápida no fim, quando fizer sentido.
- Formatação: use apenas **negrito**, listas com "- " ou "1. " e parágrafos. Não use tabelas, títulos com # nem blocos de código.
- Você é uma ferramenta de estudo. Não dê consultoria jurídica para casos reais do aluno; nesses casos, explique o conceito em tese e recomende procurar um advogado ou a Defensoria Pública.
- Se pedirem para fazer uma prova ou trabalho avaliativo no lugar do aluno, ajude a entender o tema e a montar o raciocínio, sem entregar o texto pronto para ser copiado.

Material do curso desta matéria:`;
}

/* ---------- validação ---------- */
function cleanMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const msgs = raw.slice(-MAX_HISTORY).map(m => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: String(m?.content ?? '').slice(0, m?.role === 'assistant' ? 8000 : MAX_MSG_CHARS).trim()
  })).filter(m => m.content);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  // junta mensagens seguidas do mesmo papel (a API exige alternância)
  const out = [];
  for (const m of msgs) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n\n' + m.content;
    else out.push({ ...m });
  }
  return out;
}

async function checkAccess(req) {
  const h = req.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return { status: 401, error: 'Faça login para usar o tutor.' };
  let user;
  try { user = await getAuth().verifyIdToken(token); }
  catch { return { status: 401, error: 'Sua sessão expirou. Entre novamente.' }; }
  const admin = (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (!admin) {
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists || doc.data().approved !== true) return { status: 403, error: 'Seu acesso ao curso ainda não foi liberado.' };
    if (Date.now() >= SEMESTER_END.getTime()) return { status: 403, error: 'O acesso deste semestre terminou.' };
  }
  return { uid: user.uid, admin };
}

/* Conta uma pergunta no dia (fuso de Brasília). Retorna false se passou do limite. */
async function takeQuota(uid) {
  const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const ref = db.collection('tutorUsage').doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const count = d.day === day ? (d.count || 0) : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(ref, { day, count: count + 1, total: FieldValue.increment(1), lastAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

function friendlyError(e) {
  if (e instanceof Anthropic.RateLimitError) return 'O tutor está muito requisitado agora. Tente de novo em um minuto.';
  if (e instanceof Anthropic.AuthenticationError) return 'O tutor está com problema de configuração. Avise o administrador.';
  if (e instanceof Anthropic.BadRequestError) return 'Não consegui processar essa pergunta. Tente reformular.';
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return 'O serviço de IA está instável. Tente de novo daqui a pouco.';
  if (e instanceof Anthropic.APIConnectionError) return 'Falha de conexão com o serviço de IA. Tente de novo.';
  return 'Ocorreu um erro inesperado. Tente de novo.';
}

/* ---------- endpoint ---------- */
exports.tutor = onRequest({
  region: 'southamerica-east1',
  cors: ALLOWED_ORIGINS,
  secrets: [ANTHROPIC_API_KEY],
  timeoutSeconds: 300,
  memory: '512MiB',
  maxInstances: 10
}, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }

  const access = await checkAccess(req).catch(e => { logger.error('access', e); return { status: 500, error: 'Erro ao verificar seu acesso.' }; });
  if (access.error) { res.status(access.status).json({ error: access.error }); return; }

  const { subject, lessonId, sectionTitle } = req.body || {};
  if (!SUBJECTS[subject]) { res.status(400).json({ error: 'Matéria inválida.' }); return; }
  const messages = cleanMessages(req.body?.messages);
  if (!messages) { res.status(400).json({ error: 'Mensagem vazia.' }); return; }

  if (!access.admin && !(await takeQuota(access.uid))) {
    res.status(429).json({ error: `Você atingiu o limite de ${DAILY_LIMIT} perguntas por dia. Volte amanhã!` });
    return;
  }

  let content;
  try { content = await subjectContent(subject); }
  catch (e) { logger.error('content', e); res.status(500).json({ error: 'Não consegui carregar o material da matéria.' }); return; }

  // diz ao modelo onde o aluno está (só na última mensagem, para não mexer no prefixo em cache)
  const lesson = content.lessons.find(l => l.id === Number(lessonId));
  if (lesson) {
    const last = messages[messages.length - 1];
    last.content = `[O aluno está na ${lesson.av === 2 ? 'AV2' : 'AV1'}, Aula ${lesson.id}: ${lesson.title}${sectionTitle ? ` — seção "${String(sectionTitle).slice(0, 200)}"` : ''}]\n\n${last.content}`;
  }

  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.status(200);
  const send = obj => res.write(JSON.stringify(obj) + '\n');

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [
      { type: 'text', text: systemPrompt(SUBJECTS[subject]) },
      { type: 'text', text: content.text || '(material indisponível)', cache_control: { type: 'ephemeral' } }
    ],
    messages
  });
  res.on('close', () => { if (!res.writableFinished) stream.abort(); });

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send({ t: event.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ t: '\n\nNão posso responder a essa pergunta. Tente reformular focando no conteúdo da matéria.' });
    else if (final.stop_reason === 'max_tokens') send({ t: '\n\n(A resposta ficou longa demais e foi cortada. Peça para eu continuar.)' });
    logger.info('tutor', { uid: access.uid, subject, usage: final.usage });
    send({ done: true });
  } catch (e) {
    if (!stream.aborted) { logger.error('anthropic', e); send({ error: friendlyError(e) }); }
  }
  res.end();
});
