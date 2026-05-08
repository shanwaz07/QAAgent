import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { explorePages } from './agents/PageExplorer';

const TEST_JIRA_ID = 'PHASE4_TEST';
const APP_URL = process.env.APP_URL || 'https://leolity-qa.goarya.com/demo-staffing/home';

async function run() {
  console.log(`[Phase 4 Validation] Starting — target: ${APP_URL}`);

  const pages = [
    { url: APP_URL, pageName: 'home' },
  ];

  await explorePages(pages, TEST_JIRA_ID);

  const snapshotDir = path.join(__dirname, `../artifacts/${TEST_JIRA_ID}/page_snapshots`);
  const files = fs.readdirSync(snapshotDir);

  console.log('\n[Phase 4 Validation] Snapshots written:');
  for (const file of files) {
    const fullPath = path.join(snapshotDir, file);
    const size = fs.statSync(fullPath).size;
    console.log(`  ${file} — ${size} bytes`);
  }

  console.log('\n[Phase 4 Validation] Complete. Check artifacts/PHASE4_TEST/page_snapshots/');
}

run().catch(err => {
  console.error('[Phase 4 Validation] FAILED:', err);
  process.exit(1);
});
