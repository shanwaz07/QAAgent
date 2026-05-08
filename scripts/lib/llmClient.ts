import https from 'https';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

export type LLMProvider = 'openrouter' | 'groq' | 'openai' | 'google';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}

interface OpenAIProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

// ── Retry wrapper ─────────────────────────────────────────────────

const RATE_LIMIT_RE = /429|rate.?limit|resource.?exhausted|too.?many.?request|overload|quota/i;
const RETRY_DELAY_RE = /retry.*?(\d+)\s*s/i;

async function withRetry<T>(fn: () => Promise<T>, retries: number, context: string): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        logger.error(context, `Max retries (${retries}) exceeded`, { error: String(err) });
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = RATE_LIMIT_RE.test(msg);

      let delay: number;
      if (isRateLimit) {
        const m = msg.match(RETRY_DELAY_RE);
        delay = m ? (parseInt(m[1]!) + 2) * 1000 : 65000;
        logger.warn(context, `Rate limited — waiting ${delay / 1000}s (attempt ${attempt + 1}/${retries})`, { error: msg });
      } else {
        delay = Math.min((attempt + 1) * 5000, 30000);
        logger.warn(context, `Request failed — retry ${attempt + 1}/${retries} in ${delay / 1000}s`, { error: msg });
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${context}: max retries exceeded`);
}

// ── Provider config ───────────────────────────────────────────────

function getOpenAIConfig(provider: 'openrouter' | 'groq' | 'openai'): OpenAIProviderConfig {
  switch (provider) {
    case 'openrouter':
      return {
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        defaultModel: 'qwen/qwen3-coder:free',
      };
    case 'groq':
      return {
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || '',
        defaultModel: 'llama-3.3-70b-versatile',
      };
    case 'openai':
      return {
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        defaultModel: 'gpt-4o-mini',
      };
  }
}

// ── OpenAI-compatible request ─────────────────────────────────────

function openAIRequest(
  config: OpenAIProviderConfig,
  model: string,
  messages: ChatMessage[],
  options: LLMOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
    });
    const urlObj = new URL(`${config.baseUrl}/chat/completions`);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'QA Agent Family',
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { choices?: { message?: { content?: string } }[] };
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`LLM API error ${res.statusCode}: ${data}`));
            } else {
              resolve(parsed.choices?.[0]?.message?.content ?? '');
            }
          } catch {
            reject(new Error(`Failed to parse LLM response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function openAIChat(
  config: OpenAIProviderConfig,
  model: string,
  messages: ChatMessage[],
  options: LLMOptions
): Promise<string> {
  const retries = options.retries ?? 5;
  return withRetry(() => openAIRequest(config, model, messages, options), retries, `LLM[${model}]`);
}

// ── Google (Gemini/Gemma) ─────────────────────────────────────────

async function googleChatOnce(
  model: string,
  messages: ChatMessage[],
  options: LLMOptions
): Promise<string> {
  const apiKey = process.env.GOOGLE_LLM_API_KEY || '';
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxTokens ?? 4096,
    },
  });

  const systemMsg = messages.find(m => m.role === 'system');
  const isGemma = model.startsWith('gemma');

  let conversationMsgs = messages.filter(m => m.role !== 'system');
  if (systemMsg && isGemma && conversationMsgs.length > 0) {
    conversationMsgs = [
      { role: 'user', content: `${systemMsg.content}\n\n${conversationMsgs[0]!.content}` },
      ...conversationMsgs.slice(1),
    ];
  }

  const history = conversationMsgs.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const lastMsg = conversationMsgs[conversationMsgs.length - 1]?.content ?? '';

  const chatSession = genModel.startChat({
    history,
    ...(!isGemma && systemMsg
      ? { systemInstruction: { role: 'user', parts: [{ text: systemMsg.content }] } }
      : {}),
  });
  const result = await chatSession.sendMessage(lastMsg);
  return result.response.text();
}

async function googleChat(
  model: string,
  messages: ChatMessage[],
  options: LLMOptions
): Promise<string> {
  const retries = options.retries ?? 5;
  return withRetry(() => googleChatOnce(model, messages, options), retries, `LLM[${model}]`);
}

// ── Public API ────────────────────────────────────────────────────

export async function chat(messages: ChatMessage[], options: LLMOptions = {}): Promise<string> {
  const provider = (options.provider || process.env.ACTIVE_LLM_PROVIDER || 'openrouter') as LLMProvider;
  const model = options.model || process.env.ACTIVE_LLM_MODEL || '';

  logger.info('LLMClient', `chat() → provider=${provider} model=${model || '(default)'}`);

  if (provider === 'google') {
    return googleChat(model || 'gemini-2.0-flash', messages, options);
  }

  const config = getOpenAIConfig(provider);
  return openAIChat(config, model || config.defaultModel, messages, options);
}

export async function structuredOutput<T>(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<T> {
  const raw = await chat(messages, { ...options, temperature: 0 });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    logger.error('LLMClient', 'LLM did not return valid JSON', { raw: raw.slice(0, 300) });
    throw new Error(`LLM did not return valid JSON.\nRaw response:\n${raw}`);
  }
}
