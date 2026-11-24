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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  const apiBaseUrl = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 55000;
  // Vercel Serverless Functions têm limite padrão de 4.5 MB por requisição
  const maxUploadMb = Math.min(Number(process.env.MAX_UPLOAD_MB) || 4, 4.5);
  const maxUploadBytes = Math.floor(maxUploadMb * 1024 * 1024);
  const apiKey = process.env.API_KEY || "";

  if (!apiBaseUrl) {
    return res.status(500).json({
      erro: "Variável de ambiente API_BASE_URL não configurada no servidor.",
    });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return res.status(400).json({
      erro: "Formato inválido. Envie a imagem como multipart/form-data no campo 'file'.",
    });
  }

  let body;
  try {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > maxUploadBytes) {
        throw Object.assign(new Error("LIMIT_EXCEEDED"), { code: "LIMIT_EXCEEDED" });
      }
      body = req.body;
    } else {
      body = await readRequestBody(req, maxUploadBytes);
    }
  } catch (err) {
    if (err.code === "LIMIT_EXCEEDED") {
      return res.status(413).json({
        erro: `A imagem excede o limite máximo permitido de ${maxUploadMb} MB.`,
      });
    }
    return res.status(400).json({ erro: "Erro ao ler o arquivo enviado." });
  }

  if (!body || body.length === 0) {
    return res.status(400).json({ erro: "Nenhum dado de imagem recebido." });
  }

  const headers = {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(`${apiBaseUrl}/predict`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return res.status(upstream.status).json(data);
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    return res.status(isTimeout ? 504 : 502).json({
      erro: isTimeout
        ? "A requisição demorou demais. Se o serviço estava hibernando, tente novamente."
        : "Falha ao comunicar com o serviço de IA.",
    });
  }
};
