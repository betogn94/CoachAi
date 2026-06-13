import Anthropic from '@anthropic-ai/sdk';
import { isAllowedOrigin } from './_origin.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // El SDK reintenta solo (con backoff exponencial) los errores transitorios:
  // 429 (rate limit), 529 (overloaded) y 5xx. Subimos a 4 para aguantar picos
  // cuando hay muchos clientes usando la IA a la vez (escala a ~70 usuarios).
  maxRetries: 4,
});

// Modo híbrido: Sonnet para lo que requiere calidad (generar planes, análisis
// de cierre), Haiku para lo liviano (chat casual, estimar macros, formatear).
// El cliente manda un alias ('sonnet'/'haiku'); acá lo mapeamos al id real.
// Default Haiku (retrocompat + barato). NUNCA aceptamos un model id arbitrario
// del cliente — solo estos dos alias — para no exponer la cuenta a modelos
// caros si alguien manipula el request.
const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Origin allowlist — el endpoint de IA es público y caro; bloqueamos llamadas
  // cross-site / scripts ingenuos para proteger el saldo de Anthropic. Las
  // llamadas legítimas de la app (fetch POST same-origin) siempre mandan Origin.
  // No es retryable: un 403 corta, no reintenta.
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'forbidden_origin' });
  }

  try {
    const { system, messages, model } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }
    if (messages[0]?.role !== 'user') {
      return res.status(400).json({ error: 'First message must have role: user' });
    }

    const modelId = MODELS[model] || MODELS.haiku;

    // Prompt caching: el "instructivo" (system prompt) de generar planes / chatear
    // es grande (~8k tokens) y se repite entre mensajes del mismo cliente. Lo
    // marcamos como cacheable para pagar ~90% menos en los reusos (ventana de
    // 5 min de Anthropic). Solo cuando supera el mínimo cacheable (~1k tokens ≈
    // 4000 chars); los prompts chicos (estimar macros, formatear) van como
    // string normal — cachearlos no aporta y la API los rechazaría.
    const systemText = system || '';
    const systemParam = systemText.length > 4000
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : systemText;

    const response = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: systemParam,
      messages,
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('API Error:', error);
    // 429 (rate limit) y 529 (overloaded) son transitorios: tras agotar los
    // reintentos del SDK, le avisamos al cliente que puede reintentar (retryable),
    // así muestra "mucha demanda, probá de nuevo" en vez de un error crudo.
    const status = Number(error?.status) || 0;
    const overloaded = status === 429 || status === 529;
    res.status(overloaded ? 503 : 500).json({
      error: error.message,
      retryable: overloaded,
    });
  }
}
