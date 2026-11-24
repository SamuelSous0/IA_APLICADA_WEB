const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Carrega variáveis do arquivo .env sem expô-las ao navegador
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 60000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const API_KEY = process.env.API_KEY || "";

if (!API_BASE_URL) {
  console.error(
    "[ERRO] Variável API_BASE_URL não definida no arquivo .env. Copie .env.example para .env e configure."
  );
  process.exit(1);
}

const INDEX_HTML_PATH = path.join(__dirname, "public", "index.html");

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  );
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function buildUpstreamHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }
  return headers;
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        aborted = true;
        reject(Object.assign(new Error("LIMIT_EXCEEDED"), { code: "LIMIT_EXCEEDED" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

async function handleHealth(res) {
  try {
    const upstream = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      headers: buildUpstreamHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    sendJson(res, upstream.status, data);
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      erro: isTimeout
        ? "Tempo limite excedido ao conectar na API (o servidor pode estar acordando)."
        : "Não foi possível conectar ao serviço de IA.",
    });
  }
}

async function handlePredict(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return sendJson(res, 400, {
      erro: "Formato inválido. Envie a imagem como multipart/form-data no campo 'file'.",
    });
  }

  let body;
  try {
    body = await readRequestBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    if (err.code === "LIMIT_EXCEEDED") {
      return sendJson(res, 413, {
        erro: `A imagem excede o limite máximo permitido de ${MAX_UPLOAD_MB} MB.`,
      });
    }
    return sendJson(res, 400, { erro: "Erro ao ler o arquivo enviado." });
  }

  if (!body || body.length === 0) {
    return sendJson(res, 400, { erro: "Nenhum dado de imagem recebido." });
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: buildUpstreamHeaders({
        "Content-Type": contentType,
        "Content-Length": String(body.length),
      }),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    sendJson(res, upstream.status, data);
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      erro: isTimeout
        ? "A requisição demorou demais. Se o serviço estava hibernando, tente novamente."
        : "Falha ao comunicar com o serviço de IA.",
    });
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    fs.readFile(INDEX_HTML_PATH, (err, content) => {
      if (err) {
        return sendJson(res, 500, { erro: "Erro ao carregar a página inicial." });
      }
      setSecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    });
    return;
  }

  if (req.method === "GET" && urlPath === "/api/health") {
    await handleHealth(res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/predict") {
    await handlePredict(req, res);
    return;
  }

  sendJson(res, 404, { erro: "Rota não encontrada." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
