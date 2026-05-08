require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Register ts-node only once (avoids double-registration if already active)
if (!process[Symbol.for('ts-node.register.instance')]) {
  require('ts-node').register({ transpileOnly: true, esm: false });
}

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const generateReport = require('./generate_report');
const { normalizeJiraIssue } = require('./lib/jiraNormalize');

// ── Lazy agent getters ────────────────────────────────────────────
let _pageExplorer = null, _ragAgent = null, _planner = null, _scriptGen = null, _jiraAgent = null;
function getPageExplorer() { if (!_pageExplorer) _pageExplorer = require('./agents/PageExplorer'); return _pageExplorer; }
function getRagAgent()     { if (!_ragAgent)     _ragAgent     = require('./agents/RagAgent');     return _ragAgent; }
function getPlanner()      { if (!_planner)      _planner      = require('./agents/PlannerAgent'); return _planner; }
function getScriptGen()    { if (!_scriptGen)    _scriptGen    = require('./agents/ScriptGenAgent'); return _scriptGen; }
function getJiraAgent()    { if (!_jiraAgent)    _jiraAgent    = require('./agents/JiraAgent');    return _jiraAgent; }

// ── Logger: console + socket so LogDrawer shows every step ───────
function makeLogger(io) {
  return {
    info:  (ctx, msg)    => { console.log(`[${ctx}] ${msg}`);              io.emit('log', { level: 'INFO',  agent: ctx, message: msg }); },
    warn:  (ctx, msg)    => { console.warn(`[${ctx}] WARN: ${msg}`);       io.emit('log', { level: 'WARN',  agent: ctx, message: msg }); },
    error: (ctx, msg, e) => { console.error(`[${ctx}] ERROR: ${msg}`);     io.emit('log', { level: 'ERROR', agent: ctx, message: msg + (e ? ` — ${JSON.stringify(e)}` : '') }); },
  };
}

async function orchestrate(jiraId, io, options = {}) {
  const emit      = (event, data) => io.emit(event, data);
  const step      = (status) => emit('status_changed', { type: 'STATUS_UPDATE', status });
  const log       = makeLogger(io);
  const topK      = options.ragTopK ?? parseInt(process.env.RAG_TOP_K ?? '10');
  const targetUrl = options.targetUrl || process.env.APP_URL || '';

  log.info('Orchestrator', `Starting workflow for ${jiraId}`);
  step('Loading requirements…');

  // ── 1. Load requirements (fetch from Jira if not cached) ─────
  const artifactDir = path.join(__dirname, `../artifacts/${jiraId}`);
  const reqPath = path.join(artifactDir, 'requirements.json');
  let requirements;

  if (fs.existsSync(reqPath)) {
    requirements = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    // If this is a raw Jira response (has .fields), normalise it
    if (requirements.fields) {
      requirements = normalizeJiraIssue(jiraId, requirements);
      fs.writeFileSync(reqPath, JSON.stringify(requirements, null, 2));
    }
  } else {
    step(`Fetching ${jiraId} from Jira…`);
    log.info('Orchestrator', `requirements.json not found — fetching ${jiraId} from Jira`);
    try {
      const issue = await getJiraAgent().getIssue(jiraId);
      requirements = normalizeJiraIssue(jiraId, issue);
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(reqPath, JSON.stringify(requirements, null, 2));
      log.info('Orchestrator', `Requirements fetched and saved for ${jiraId}`);
    } catch (err) {
      step(`Error: Failed to fetch ${jiraId} from Jira — ${err.message}`);
      log.error('Orchestrator', `Failed to fetch requirements from Jira`, { error: String(err) });
      return;
    }
  }

  log.info('Orchestrator', `Requirements loaded: ${requirements.title || jiraId}`);

  // ── Phase 5a: Test Planning ───────────────────────────────────
  const testPlanPath = path.join(artifactDir, 'test_plan.json');
  let testPlan;

  // Phase 10.A: if the caller supplied a preApprovedPlan (from interactive review gate),
  // bypass planning entirely. The plan has already been reviewed by the user.
  if (options.preApprovedPlan) {
    testPlan = options.preApprovedPlan;
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(testPlanPath, JSON.stringify(testPlan, null, 2), 'utf8');
    log.info('Orchestrator', `Using pre-approved test plan — ${testPlan.testCases.length} test cases`);
    step(`Test plan approved (${testPlan.testCases.length} test cases)`);
  } else {
  // Invalidate cached plan if a different targetUrl was supplied this run
  if (fs.existsSync(testPlanPath) && targetUrl) {
    const cached = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));
    const cachedUrl = cached.testCases?.[0]?.targetPage;
    if (cachedUrl && cachedUrl !== targetUrl) {
      log.info('Orchestrator', `targetUrl changed (${cachedUrl} → ${targetUrl}) — regenerating test plan`);
      fs.unlinkSync(testPlanPath);
    }
  }

  if (fs.existsSync(testPlanPath)) {
    testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));
    log.info('Orchestrator', `Using existing test plan — ${testPlan.testCases.length} test cases`);
    step(`Test plan loaded (${testPlan.testCases.length} test cases)`);
  } else {
    step('PlannerAgent: Querying RAG context…');
    log.info('Orchestrator', 'Querying RAG for context…');
    try {
      const ragContext = await getRagAgent().ragQuery(
        `${requirements.title || ''} ${requirements.description || ''}`.trim() || jiraId,
        topK,
      );
      log.info('Orchestrator', `RAG returned ${ragContext.length} context items`);
      step('PlannerAgent: Generating test plan with LLM…');
      testPlan = await getPlanner().generateTestPlan(jiraId, requirements, ragContext, io, targetUrl);
      step(`Test plan ready — ${testPlan.testCases.length} test cases generated`);
    } catch (err) {
      step(`PlannerAgent error: ${err.message}`);
      log.error('Orchestrator', 'PlannerAgent failed', { error: String(err) });
      throw err;
    }
  }
  } // end of else (no preApprovedPlan)

  // ── Phase 4: Page Exploration ─────────────────────────────────
  const uniqueUrls = [...new Set(
    (testPlan.testCases || []).map(tc => tc.targetPage).filter(Boolean)
  )];
  const pagesToExplore = uniqueUrls.length > 0
    ? uniqueUrls.map(url => ({
        url,
        pageName: url.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''),
      }))
    : [{ url: targetUrl || 'https://leolity-qa.goarya.com/demo-staffing/home', pageName: 'home' }];

  step(`PageExplorer: Opening browser to capture DOM snapshots (${pagesToExplore.length} page(s))…`);
  log.info('Orchestrator', `PageExplorer — exploring ${pagesToExplore.length} page(s)`);
  await getPageExplorer().explorePages(pagesToExplore, jiraId, io);
  step('PageExplorer: DOM snapshots captured');

  // ── Phase 5b: Script Generation ───────────────────────────────
  step(`ScriptGenAgent: Generating ${testPlan.testCases.length} Playwright script(s)…`);
  log.info('Orchestrator', `ScriptGenAgent — generating ${testPlan.testCases.length} script(s)`);
  let scriptPaths = [];
  try {
    scriptPaths = await getScriptGen().generateAllScripts(jiraId, testPlan.testCases, io);
    step(`Scripts ready — ${scriptPaths.length} spec file(s) written`);
    log.info('Orchestrator', `${scriptPaths.length} scripts generated`);
  } catch (err) {
    step(`ScriptGenAgent error: ${err.message}`);
    log.error('Orchestrator', 'ScriptGenAgent failed', { error: String(err) });
    throw err;
  }

  if (scriptPaths.length === 0) {
    step('No scripts generated — stopping.');
    return;
  }

  // ── Phase 6: Execute generated tests (one at a time) ──────────
  step(`Execution: Running ${scriptPaths.length} test(s) in browser…`);
  log.info('Orchestrator', `Executing ${scriptPaths.length} test(s)`);
  const screenshotDir = path.join(artifactDir, 'screenshots');
  const results = { total: scriptPaths.length, passed: 0, failed: 0, results: [] };

  for (const scriptPath of scriptPaths) {
    const tcId = path.basename(scriptPath, '.spec.ts');
    const tc = testPlan.testCases.find(t => t.id === tcId);
    const label = tc?.title || tcId;
    const testOutputDir = path.join(artifactDir, 'test-results', tcId);

    step(`Running: ${label}…`);
    log.info('Executor', `Starting ${tcId}`);
    const startMs = Date.now();

    try {
      await runPlaywrightTest(scriptPath, io, testOutputDir);
      const duration = Date.now() - startMs;
      results.passed++;
      results.results.push({ tcid: tcId, title: label, status: 'PASS', duration });
      log.info('Executor', `${tcId} PASSED (${(duration / 1000).toFixed(1)}s)`);
      emit('test_result', { jiraId, tcId, title: label, status: 'PASS', duration });
      step(`PASSED — ${label}`);
    } catch (err) {
      const duration = Date.now() - startMs;
      // Capture screenshot if playwright saved one
      const pngs = findFiles(testOutputDir, '.png');
      let screenshotRelPath = null;
      if (pngs.length > 0) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        const dest = path.join(screenshotDir, `${tcId}.png`);
        fs.copyFileSync(pngs[0], dest);
        screenshotRelPath = `screenshots/${tcId}.png`;
      }
      results.failed++;
      results.results.push({ tcid: tcId, title: label, status: 'FAIL', error: err.message, screenshot: screenshotRelPath, duration });
      log.warn('Executor', `${tcId} FAILED (${(duration / 1000).toFixed(1)}s) — ${err.message}`);
      emit('test_result', { jiraId, tcId, title: label, status: 'FAIL', error: err.message, screenshot: screenshotRelPath, duration });
      step(`FAILED — ${label}`);
    }

    emit('status_changed', {
      type: 'DATA_UPDATE',
      data: {
        totalTests: results.total,
        passed: results.passed,
        failed: results.failed,
        recentLogs: [`${tcId}: ${results.results[results.results.length - 1].status}`],
      },
    });
  }

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify(results, null, 2));

  const summary = `Workflow complete — ${results.passed}/${results.total} passed`;
  step(summary);
  log.info('Orchestrator', summary);

  try { generateReport(jiraId); } catch { /* non-fatal */ }
}

// ── Recursively find files with a given extension ─────────────────
function findFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(ext)) found.push(full);
    }
  }
  try { walk(dir); } catch { /* ignore permission errors */ }
  return found;
}

// ── Spawn a single Playwright test, stream stdout to socket ──────
function runPlaywrightTest(scriptPath, io, outputDir) {
  return new Promise((resolve, reject) => {
    // Quote paths to handle spaces in directory names (Windows)
    const quotedPath = `"${scriptPath}"`;
    const args = ['playwright', 'test', quotedPath, '--headed', '--reporter=line'];
    if (outputDir) args.push('--output', `"${outputDir}"`);
    const proc = spawn(
      'npx',
      args,
      { cwd: path.join(__dirname, '..'), shell: true },
    );

    proc.stdout.on('data', data => {
      const line = data.toString().trim();
      if (line) io.emit('log', { level: 'INFO', agent: 'Executor', message: line });
    });
    proc.stderr.on('data', data => {
      const line = data.toString().trim();
      if (line) io.emit('log', { level: 'WARN', agent: 'Executor', message: line });
    });
    proc.on('close', code => {
      code === 0 ? resolve() : reject(new Error(`Test exited with code ${code}`));
    });
  });
}

module.exports = { orchestrate };

// CLI mode: node scripts/orchestrate.js CBOT-421
if (require.main === module) {
  const jiraId = process.argv[2] || 'CBOT-421';
  const ioStub = { emit: (event, data) => console.log(`[SOCKET] ${event}:`, JSON.stringify(data)) };
  orchestrate(jiraId, ioStub)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
