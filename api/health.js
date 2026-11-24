module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  const apiBaseUrl = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 55000;
  const apiKey = process.env.API_KEY || "";

  if (!apiBaseUrl) {
    return res.status(500).json({
      erro: "Variável de ambiente API_BASE_URL não configurada no servidor.",
    });
  }

  const headers = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(`${apiBaseUrl}/health`, {
      method: "GET",
      headers,
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
        ? "Tempo limite excedido ao conectar na API (o servidor pode estar acordando)."
        : "Não foi possível conectar ao serviço de IA.",
    });
  }
};
