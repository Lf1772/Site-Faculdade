# Ativar o Tutor IA

O botão **Tutor IA** já está no site. Para ele responder, falta publicar o
servidor que fica na pasta `functions/` (uma Firebase Function). Isso leva
uns 15 minutos e só precisa ser feito uma vez.

## Como funciona

1. O aluno pergunta no chat do site.
2. O site envia a pergunta, junto com o token de login do Firebase, para a
   função `tutor`.
3. A função confere se a pessoa está logada e **aprovada**, e se o semestre
   ainda não acabou. Ela também conta as perguntas do dia (limite de 30 por
   aluno; o e-mail admin não tem limite).
4. A função lê o conteúdo da matéria no Firestore (`content/<matéria>`),
   manda tudo para o Claude (modelo `claude-opus-5-5`) e devolve a resposta
   em tempo real.

A chave da API da Anthropic fica guardada só no Firebase (Secret Manager).
Ela nunca aparece no site nem no GitHub.

## 1. Criar a chave da Anthropic

1. Acesse https://console.anthropic.com, crie uma conta e adicione créditos
   em **Billing**.
2. Em **API Keys**, crie uma chave e copie (começa com `sk-ant-`).
3. Recomendado: em **Limits**, defina um limite mensal de gasto.

Custo estimado com o Opus 5.5: de US$ 0,01 a 0,05 por pergunta. O material
da matéria fica em cache, então as perguntas seguidas saem mais baratas.

## 2. Mudar o projeto Firebase para o plano Blaze

Functions exigem o plano **Blaze** (pago por uso). Ele inclui uma cota
gratuita grande, e para o volume de uma turma o custo do Firebase costuma
ser zero.

No console do Firebase: ⚙️ → **Uso e faturamento** → **Detalhes e
configurações** → **Modificar plano** → Blaze. Aproveite e crie um alerta
de orçamento (ex.: R$ 20).

## 3. Publicar a função

No seu computador, com o [Node.js 22](https://nodejs.org) instalado, na
pasta do repositório:

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY   # cole a chave sk-ant-... quando pedir
firebase deploy --only functions
```

O deploy mostra a URL da função. Ela deve ser:

```
https://southamerica-east1-site-faculadade.cloudfunctions.net/tutor
```

Se for diferente, troque a constante `TUTOR_URL` no `index.html`.

## 4. Testar

Entre no site, abra uma aula e clique em **Tutor IA** (canto inferior
direito) ou em **Perguntar ao tutor** no fim de uma seção.

Para ver erros e o consumo de tokens de cada pergunta:
`firebase functions:log --only tutor`.

## Ajustes comuns (em `functions/index.js`)

| O quê | Onde |
|---|---|
| Limite de perguntas por dia | `DAILY_LIMIT` |
| Modelo (ex.: `claude-sonnet-5-5`, mais barato) | `MODEL` |
| Profundidade do raciocínio (`low`, `medium`, `high`) | `output_config.effort` |
| Tom e regras do tutor | `systemPrompt()` |
| Domínios que podem chamar a função | `ALLOWED_ORIGINS` |

Depois de mudar qualquer coisa, rode `firebase deploy --only functions`
de novo.

O uso diário fica na coleção `tutorUsage` do Firestore. Só a função mexe
nela: as regras atuais do Firestore não têm `match` para essa coleção,
então os alunos não conseguem ler nem alterar.
