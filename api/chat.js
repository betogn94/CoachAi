import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
    res.status(500).json({ error: error.message });
  }
}
