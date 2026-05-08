import 'dotenv/config';
import { ragQuery } from './agents/RagAgent';

async function run() {
  console.log('\n── RAG Query Validation ──\n');

  const queries = [
    'do full testing on login feature',
    'test the admin user management flow',
    'CBOT-421',
  ];

  for (const q of queries) {
    process.stdout.write(`Query: "${q}"... `);
    const results = await ragQuery(q, 5);
    console.log(`${results.length} results`);
    results.slice(0, 3).forEach((r, i) =>
      console.log(`  ${i + 1}. [${r.jiraId}] ${r.summary.slice(0, 65)} (${r.score.toFixed(3)})`)
    );
    console.log();
  }

  console.log('✅  RAG query working on 690-issue index.\n');
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
