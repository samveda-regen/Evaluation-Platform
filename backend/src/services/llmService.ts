interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface LLMConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

const defaultConfig: Partial<LLMConfig> = {
  maxTokens: 4096,
  temperature: 0.7
};

export async function callLLM(
  messages: Message[],
  config?: Partial<LLMConfig>
): Promise<LLMResponse> {
  const provider = config?.provider || process.env.LLM_PROVIDER || 'openai';
  const apiKey = config?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('LLM API key not configured. Set LLM_API_KEY or OPENAI_API_KEY environment variable.');
  }

  const finalConfig: LLMConfig = {
    provider: provider as 'openai' | 'anthropic',
    model: config?.model || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'),
    apiKey,
    maxTokens: config?.maxTokens || defaultConfig.maxTokens!,
    temperature: config?.temperature ?? defaultConfig.temperature!
  };

  if (finalConfig.provider === 'anthropic') {
    return callAnthropic(messages, finalConfig);
  } else {
    return callOpenAI(messages, finalConfig);
  }
}

async function callOpenAI(messages: Message[], config: LLMConfig): Promise<LLMResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    } : undefined
  };
}

async function callAnthropic(messages: Message[], config: LLMConfig): Promise<LLMResponse> {
  // Extract system message if present
  const systemMessage = messages.find(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemMessage?.content,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: m.content
      }))
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content[0]?.text || '',
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens
    } : undefined
  };
}

// Models occasionally emit a literal newline/tab inside a JSON string value (most often in a
// multi-line code sample or description) instead of escaping it as \n/\t, which makes the string
// "unterminated" as far as JSON.parse is concerned. This walks the text tracking string/escape
// state and escapes stray control characters found ONLY inside string literals — structural
// whitespace between tokens is left untouched.
function escapeStrayControlCharsInStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      continue;
    }
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = false;
      result += ch;
      continue;
    }
    if (ch === '\n') { result += '\\n'; continue; }
    if (ch === '\r') { result += '\\r'; continue; }
    if (ch === '\t') { result += '\\t'; continue; }
    result += ch;
  }
  return result;
}

// Tries each candidate as-is first, then with control-char escaping as a fallback, so a single
// malformed field doesn't sink parsing of an otherwise-valid response.
function tryParse(candidate: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    try {
      return { ok: true, value: JSON.parse(escapeStrayControlCharsInStrings(candidate)) };
    } catch {
      return { ok: false, error: err };
    }
  }
}

export function parseJSONFromLLM(content: string): unknown {
  const candidates: string[] = [];

  // Markdown code block, if present
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) candidates.push(jsonMatch[1].trim());

  // The whole response, trimmed
  candidates.push(content.trim());

  // Whatever looks like the outermost JSON object/array in the text
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);

  let lastError: unknown = new Error('Could not parse JSON from LLM response');
  for (const candidate of candidates) {
    const result = tryParse(candidate);
    if (result.ok) return result.value;
    lastError = result.error;
  }

  throw lastError;
}
