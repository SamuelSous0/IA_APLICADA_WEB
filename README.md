# IA_APLICADA_WEB

Aplicação web simples em HTML para **tirar uma foto pela câmera** ou **enviar uma imagem (JPEG/PNG)** para o serviço de classificação por IA e exibir o resultado na tela.

## Segurança com `.env`

Um arquivo `.html` puro rodando direto no navegador não consegue proteger variáveis de ambiente (tudo no front-end é visível pelo DevTools). Por isso, este projeto mantém as configurações sensíveis apenas no back-end:

- **Localmente:** `server.js` lê o `.env` e faz proxy de `/api/health` e `/api/predict`.
- **Na Vercel:** as Serverless Functions em `api/health.js` e `api/predict.js` leem as *Environment Variables* configuradas no painel da Vercel.
- O arquivo `.env` está no `.gitignore` para nunca ser enviado ao Git.

## Como executar localmente

1. Copie `.env.example` para `.env` (caso ainda não exista):
   ```bash
   cp .env.example .env
   ```
2. Inicie o servidor (requer Node.js 18+):
   ```bash
   npm start
   ```
3. Acesse `http://localhost:3000`.

## Como publicar na Vercel

1. Suba o repositório para o GitHub (o `.env` será ignorado automaticamente pelo `.gitignore`).
2. Acesse [vercel.com](https://vercel.com/), clique em **Add New → Project** e importe o repositório.
3. Em **Framework Preset**, deixe **Other** (a Vercel serve `public/` e reconhece automaticamente `api/health.js`, `api/predict.js` e `vercel.json`).
4. Em **Environment Variables**, adicione:
   - `API_BASE_URL` = `https://projeto-harduino-ia.onrender.com`
   - *(opcional)* `REQUEST_TIMEOUT_MS` = `55000`
   - *(opcional)* `MAX_UPLOAD_MB` = `4`
   - *(opcional)* `API_KEY` = sua chave, caso a API passe a exigir autenticação
5. Clique em **Deploy**.

> Como a Vercel publica em **HTTPS** automaticamente, o acesso à câmera no celular e no computador funciona normalmente.
