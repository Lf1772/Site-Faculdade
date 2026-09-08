# Configurar login (Firebase Authentication)

O site já está pronto para exigir e-mail e senha. Falta só criar o projeto
Firebase (gratuito) e preencher duas coisas no `index.html`. Leva uns 10
minutos.

## 1. Criar o projeto

1. Acesse https://console.firebase.google.com e crie um projeto novo
   (pode desmarcar o Google Analytics, não é necessário).
2. No menu lateral, vá em **Build → Authentication** → **Get started**.
3. Na aba **Sign-in method**, ative o provedor **E-mail/senha**.
4. No menu lateral, vá em **Build → Firestore Database** → **Create database**.
   Escolha o modo **produção** (não "modo de teste") e a região mais próxima.

## 2. Colar as regras de segurança

Em **Firestore Database → Regras**, apague o conteúdo padrão e cole isto,
**trocando `SEU_EMAIL_ADMIN` pelo e-mail que você vai usar como host**
(tem que ser o mesmo e-mail configurado como `ADMIN_EMAIL` no `index.html`,
no passo 4):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null &&
        (request.auth.uid == userId || request.auth.token.email == "SEU_EMAIL_ADMIN");
      allow create: if request.auth != null && request.auth.uid == userId &&
        request.resource.data.email == request.auth.token.email &&
        request.resource.data.approved == (request.auth.token.email == "SEU_EMAIL_ADMIN");
      allow update: if request.auth != null && request.auth.token.email == "SEU_EMAIL_ADMIN";
      allow delete: if request.auth != null && request.auth.token.email == "SEU_EMAIL_ADMIN";
    }
    match /content/{subjectId} {
      allow read: if request.auth != null &&
        (request.auth.token.email == "SEU_EMAIL_ADMIN" ||
         (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approved == true &&
          request.time < timestamp.date(2026,12,14) + duration.value(3,'h')));
      allow write: if false;
    }
    match /users/{userId}/sessions/{sessionId} {
      allow read: if request.auth != null &&
        (request.auth.uid == userId || request.auth.token.email == "SEU_EMAIL_ADMIN");
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /meta/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.token.email == "SEU_EMAIL_ADMIN";
    }
  }
}
```

O que essas regras garantem (isso roda no servidor do Firebase, não no
navegador — ninguém consegue burlar editando o código do site):

- Cada pessoa só lê o próprio cadastro; só o e-mail admin lê todos.
- Ao se cadastrar, a pessoa só cria o próprio documento, e `approved` é
  sempre `false` — **exceto** para o e-mail admin, que já entra aprovado.
  Ninguém consegue se auto-aprovar adulterando a chamada.
- Só o e-mail admin pode aprovar (`update`) ou remover (`delete`) acessos.
- O material das aulas (coleção `content`) só pode ser lido por quem está
  logado **e** aprovado (ou é o admin) **e** dentro do prazo (até
  13/12/2026, fim do semestre — depois disso, ninguém além do e-mail
  admin consegue ler, mesmo com a conta ainda marcada como aprovada; o
  bloqueio é automático, sem precisar revogar ninguém manualmente) — e
  ninguém, nem o admin, escreve nela pelo navegador (`allow write: if
  false`); o conteúdo é carregado ali por um script de administração,
  fora do site.
- Cada conta gerencia livremente sua própria subcoleção `sessions` (usada
  para o controle de dispositivos simultâneos); só o e-mail admin consegue
  ler a de outras contas, para o painel de Aprovações.
- Qualquer pessoa logada (mesmo pendente de aprovação) pode ler `meta/pricing`
  — é o contador usado para mostrar o preço promocional/normal do Pix na tela
  de pagamento — mas só o e-mail admin pode alterá-lo (isso acontece
  automaticamente a cada aprovação, no painel de Administração).

Clique em **Publicar**.

## 3. Registrar o app da Web e pegar as chaves

1. No ícone de engrenagem → **Configurações do projeto** → aba **Geral**.
2. Em "Seus apps", clique no ícone `</>` (Web) e registre um app (qualquer
   nome, não precisa de Firebase Hosting).
3. Copie o objeto `firebaseConfig` que aparece — são valores públicos
   (identificam o projeto, não são senha de nada).

## 4. Editar o `index.html`

Procure por `const firebaseConfig` perto do início do `<script>` e troque
pelos valores copiados. Logo abaixo, troque:

```js
const ADMIN_EMAIL = "SEU_EMAIL_ADMIN";
```

pelo e-mail que você vai usar para logar como host — **o mesmo** que você
colocou nas regras do Firestore no passo 2.

Pronto: dê `git push`, e o site passa a pedir login. Crie sua própria conta
usando esse e-mail admin — ela entra liberada na hora. Qualquer outra
pessoa que se cadastrar fica pendente até você aprovar em **Menu →
Administração → Aprovações**.

## Controle de dispositivos simultâneos

Cada conta pode ficar logada em até `MAX_SESSIONS` dispositivos ao mesmo
tempo (hoje configurado como **2**, perto do início do `<script>` no
`index.html`). Ao logar num dispositivo a mais, o mais antigo (por tempo
sem atividade) é desconectado automaticamente, com um aviso na tela.

No painel **Administração → Aprovações**, cada usuário aprovado tem um
botão **Ver dispositivos**, que mostra os aparelhos que já usaram aquela
conta e há quanto tempo. Isso ajuda a notar padrões de compartilhamento de
login mesmo quando estão dentro do limite simultâneo (ex.: a conta troca de
aparelho o tempo todo).

## Pagamento por Pix

Quem se cadastra e ainda não foi aprovado vê uma tela com **QR code Pix**
(gerado no próprio navegador, sem serviço externo) e o código "copia e
cola", com o valor já preenchido. Ela paga, manda o comprovante pro e-mail
do admin, e você aprova manualmente — o mesmo fluxo de sempre.

As configurações ficam perto do início do `<script>` no `index.html`:

```js
const PIX_KEY = '15877661752';       // sua chave Pix (só dígitos, sem pontuação)
const PIX_NAME = 'Luiz Felipe Mattos'; // seu nome no Pix (máx. 25 caracteres)
const PIX_CITY = 'Rio de Janeiro';     // sua cidade (máx. 15 caracteres)
const PIX_TIER_LIMIT = 9;   // quantas pessoas pagam o preço promocional
const PIX_PRICE_EARLY = 40; // preço para as primeiras PIX_TIER_LIMIT pessoas aprovadas
const PIX_PRICE_LATER = 50; // preço para as demais
```

O preço muda sozinho: cada aprovação no painel de Administração soma 1 no
contador `meta/pricing.approvedCount` no Firestore, e a tela de pagamento
sempre calcula o preço da vez com base nesse contador — a partir da 10ª
aprovação, o valor mostrado passa automaticamente para `PIX_PRICE_LATER`.

Se o preço ou a chave Pix mudarem no futuro, é só editar essas constantes e
dar `git push` — não precisa mexer no Firestore.

## Fim do semestre (13/12/2026)

O acesso de qualquer conta que não seja a sua (o e-mail admin) vale até o
fim do dia 13/12/2026, horário de Brasília. Isso é aplicado em dois
lugares:

- **No Firestore** (a proteção que vale de verdade): a regra de
  `content/{subjectId}` só libera a leitura pra quem está aprovado **e**
  dentro do prazo. No dia seguinte, o bloqueio acontece sozinho — você
  não precisa revogar ninguém manualmente.
- **No site**: quem tentar entrar depois do prazo vê uma tela avisando que
  o acesso encerrou, em vez de um erro genérico.

As contas continuam marcadas como `approved: true` no Firestore mesmo
depois do prazo (não são revogadas de fato) — isso é só cosmético, o
acesso ao conteúdo já está bloqueado pela regra. Se quiser reabrir pra um
próximo semestre, edite a data em dois lugares: a constante
`SEMESTER_END` no `index.html`, e a data (`timestamp.date(2026,12,14)`)
na regra do `content` no Firestore.

## Limitação importante

O material das aulas (aulas, questões, flashcards, mapa mental) fica no
Firestore, não mais embutido no `index.html` — quem não estiver logado e
aprovado não consegue baixar esse conteúdo de jeito nenhum, nem inspecionando
o código do site. Isso fecha o principal buraco de um site estático.

O que continua não sendo possível evitar: uma pessoa **logada e aprovada**,
vendo a aula normalmente na tela, sempre consegue selecionar e copiar o
texto — isso é inerente a qualquer conteúdo exibido num navegador, não tem
como bloquear sem prejudicar a leitura. Para o uso pretendido (impedir
acesso de quem não pagou/não foi aprovado), o que foi implementado é
suficiente; não existe proteção de conteúdo 100% à prova de cópia num
site assim, sem soluções de DRM.
