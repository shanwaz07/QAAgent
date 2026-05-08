import 'dotenv/config';
import { embed } from './lib/embedder';
import { createCollection, upsert, query, collectionCount } from './lib/vectorStore';
import { chat } from './lib/llmClient';

const COLLECTION = 'infra_validation_test';

async function run() {
  console.log('\n── Phase 1 Infrastructure Validation ──\n');

  // 1.2 — Gemini embeddings
  process.stdout.write('1. Gemini embeddings... ');
  const vec = await embed('Playwright test for OrangeHRM login page');
  if (vec.length < 256) throw new Error(`Unexpectedly small vector: ${vec.length} dims`);
  console.log(`✅  ${vec.length}-dimension vector returned`);

  // 1.1 — Qdrant round-trip
  process.stdout.write('2. Qdrant upsert + query... ');
  await createCollection(COLLECTION);
  await upsert(COLLECTION, 1, vec, { text: 'login test', type: 'validation' });
  const secondVec = await embed('Login automation test OrangeHRM');
  const results = await query(COLLECTION, secondVec, 1);
  const topResult = results[0];
  if (!topResult || topResult.score < 0.5) throw new Error('Query returned no relevant result');
  const count = await collectionCount(COLLECTION);
  console.log(`✅  Upserted 1 point, queried top-1 (score: ${topResult.score.toFixed(3)}), count: ${count}`);

  // 1.3 — LLM (OpenRouter)
  process.stdout.write('3. LLM chat (OpenRouter)... ');
  const reply = await chat([
    { role: 'system', content: 'You are a Playwright test engineer. Reply in one sentence only.' },
    { role: 'user', content: 'Write a one-sentence description of what getByRole does in Playwright.' },
  ]);
  if (!reply || reply.length < 10) throw new Error('LLM returned empty response');
  console.log(`✅  Response: "${reply.slice(0, 100)}${reply.length > 100 ? '…' : ''}"`);

  // 1.4 — End-to-end: embed → store → retrieve
  process.stdout.write('4. End-to-end embed → store → retrieve... ');
  const jiraLike = '[CBOT-42] Login: User should be able to log in with valid credentials\nAcceptance: Given valid username/password, login succeeds and dashboard is shown';
  const jiraVec = await embed(jiraLike);
  await upsert(COLLECTION, 2, jiraVec, { jiraId: 'CBOT-42', type: 'story' });
  const queryVec = await embed('test the login feature');
  const hits = await query(COLLECTION, queryVec, 2);
  const found = hits.some(h => (h.payload as Record<string, string>)['jiraId'] === 'CBOT-42');
  if (!found) throw new Error('Login story not in top results for "test the login feature"');
  const topHit = hits[0];
  console.log(`✅  "test the login feature" → CBOT-42 in top results (score: ${topHit?.score.toFixed(3)})`);

  console.log('\n✅  All infrastructure checks passed. Phase 1 complete.\n');
}

run().catch(err => {
  console.error('\n❌ Validation failed:', err.message);
  process.exit(1);
});
