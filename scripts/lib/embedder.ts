import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const MODEL = process.env.GEMINI_EMBED_MODEL || 'models/gemini-embedding-001';

async function embedWithRetry(text: string, taskType: TaskType, retries = 10): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: MODEL });
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.embedContent({ content: { parts: [{ text }], role: 'user' }, taskType });
      return result.embedding.values;
    } catch (err: unknown) {
      if (attempt === retries) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit) {
        const delayMatch = msg.match(/retry in (\d+)\.?\d*s/i);
        const delay = delayMatch ? (parseInt(delayMatch[1]!) + 2) * 1000 : 65000;
        process.stdout.write(`\n[Embedder] Rate limited — waiting ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        const delay = Math.min((attempt + 1) * 5000, 30000);
        process.stdout.write(`\n[Embedder] Network error — retry ${attempt + 1}/${retries} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error('Embedding failed after max retries');
}

// Use for indexing Jira issues into Qdrant
export async function embedDocument(text: string): Promise<number[]> {
  return embedWithRetry(text, TaskType.RETRIEVAL_DOCUMENT);
}

// Use for user queries / search
export async function embedQuery(text: string): Promise<number[]> {
  return embedWithRetry(text, TaskType.RETRIEVAL_QUERY);
}

// Legacy — kept for any callers not yet updated
export async function embed(text: string): Promise<number[]> {
  return embedWithRetry(text, TaskType.RETRIEVAL_DOCUMENT);
}
