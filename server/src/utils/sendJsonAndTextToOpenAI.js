const openai = require('./openaiClient');

function safeStringify(obj, max = 50000) {
  const s = JSON.stringify(obj, null, 2);
  return s.length > max ? s.slice(0, max) + '\n...<truncated>...' : s;
}

function clip(text, max = 50000) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '\n...<truncated>...' : text;
}

/**
 * Sends a jsonObject and a string to OpenAI and returns text.
 * @param {{ jsonObject: any, text?: string, systemPrompt?: string, model?: string }} p
 */
async function sendJsonAndTextToOpenAI({
  jsonObject,
  text = '',//User prompt
  systemPrompt,
  model = 'gpt-4o-mini'//TODO check if best model to use 
}) {
  const sys = systemPrompt ||
    'You are a senior data engineer. Given JSON and extra text, produce a concise, useful analysis.';

  const userContent = [
    '=== Extra Text ===',
    clip(text),
    '\n=== JSON ===\n',
    safeStringify(jsonObject)
  ].join('\n');

  const response = await openai.responses.create({
    model,
    input: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent }
    ]
  });

  const out = response.output_text
    || response.output?.[0]?.content?.[0]?.text
    || response.choices?.[0]?.message?.content
    || 'No content returned.';
  return out;
}

module.exports = { sendJsonAndTextToOpenAI };
