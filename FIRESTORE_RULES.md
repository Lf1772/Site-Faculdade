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

## Limitação importante

O `index.html` continua sendo um arquivo estático publicado no GitHub
Pages — o HTML/JS em si é público para quem souber onde procurar (ex.:
"ver código-fonte" do navegador). O login com aprovação impede o acesso
casual pela tela do site, mas não é criptografia: alguém tecnicamente
capaz de inspecionar o código consegue ler o conteúdo das aulas sem
passar pelo login. Para o uso pretendido (controlar quem entra pela
interface normal do site), isso é suficiente; não trate o conteúdo como
confidencial.
