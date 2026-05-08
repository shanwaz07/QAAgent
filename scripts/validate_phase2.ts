import 'dotenv/config';
import { syncProject } from './agents/JiraAgent';
import { buildIndex, ragQuery } from './agents/RagAgent';

const PROJECT = process.env.JIRA_PROJECT_KEY || 'CBOT';

async function run() {
  console.log('\n── Phase 2 Validation ──\n');

  // 2.2 Fetch issues
  process.stdout.write(`1. Fetching Jira issues for ${PROJECT}... `);
  const issues = await syncProject(PROJECT);
  console.log(`✅  ${issues.length} issues fetched and saved`);

  if (issues.length === 0) {
    console.log('⚠️  No issues found — check JIRA_PROJECT_KEY and JQL filter');
    return;
  }

  // 2.3 Build Qdrant index
  process.stdout.write('2. Building RAG index... ');
  const count = await buildIndex(PROJECT, issues);
  console.log(`✅  ${count} issues indexed in Qdrant`);

  // 2.4 Test 4-layer query
  process.stdout.write('3. Testing 4-layer RAG query... ');
  const results = await ragQuery('do full testing on login feature', 10);
  console.log(`✅  Returned ${results.length} results`);
  console.log('   Top 3:');
  results.slice(0, 3).forEach((r, i) =>
    console.log(`   ${i + 1}. [${r.jiraId}] ${r.summary.slice(0, 70)} (score: ${r.score.toFixed(3)})`)
  );

  console.log('\n✅  Phase 2 validation complete.\n');
}

run().catch(err => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
