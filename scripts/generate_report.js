const fs = require('fs');
const path = require('path');

function generateReport(jiraId) {
  const resultsPath = path.join(__dirname, `../artifacts/${jiraId}/results.json`);
  const insightsPath = path.join(__dirname, `../artifacts/${jiraId}/insights.json`);
  
  if (!fs.existsSync(resultsPath)) return;

  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const insights = fs.existsSync(insightsPath) ? JSON.parse(fs.readFileSync(insightsPath, 'utf8')) : null;

  // Derive metrics if they are missing (for SCRUM-200 format)
  const total = results.total || (results.results ? results.results.length : (results.executionSummary ? 2 : 1));
  const passed = results.passed !== undefined ? results.passed : (results.status === 'PASS' ? total : 0);
  const failed = results.failed !== undefined ? results.failed : (results.status === 'FAIL' ? total : 0);
  const timestamp = results.timestamp || new Date().toISOString();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${jiraId} - Execution Report</title>
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --primary: #6366f1; --success: #22c55e; --error: #ef4444; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; padding: 40px; margin: 0; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid #334155; padding-bottom: 1rem; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: var(--card); padding: 1.5rem; border-radius: 12px; text-align: center; border: 1px solid #334155; }
        .stat-value { font-size: 2rem; font-weight: 800; }
        .test-list { background: var(--card); border-radius: 12px; overflow: hidden; }
        .test-item { display: flex; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #334155; }
        .status-pass { color: var(--success); font-weight: bold; }
        .status-fail { color: var(--error); font-weight: bold; }
        .insights { background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1)); padding: 1.5rem; border-radius: 12px; margin-top: 2rem; border: 1px solid rgba(99, 102, 241, 0.2); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${jiraId}: Execution Report</h1>
            <div>${new Date(timestamp).toLocaleString()}</div>
        </div>
        <div class="stats">
            <div class="stat-card"><div class="stat-value">${total}</div>Total</div>
            <div class="stat-card"><div class="stat-value" style="color: var(--success)">${passed}</div>Passed</div>
            <div class="stat-card"><div class="stat-value" style="color: var(--error)">${failed}</div>Failed</div>
        </div>
        <div class="test-list">
            ${(results.results || []).map(test => `
                <div class="test-item">
                    <div><strong>${test.tcid}</strong></div>
                    <div class="${test.status === 'PASS' ? 'status-pass' : 'status-fail'}">${test.status}</div>
                </div>
                ${test.error ? `<div style="padding: 0 1rem 1rem; color: #94a3b8; font-size: 0.8rem">Error: ${test.error}</div>` : ''}
            `).join('')}
            ${!(results.results) ? `<div style="padding: 1rem; color: #94a3b8; text-align:center;">Summary execution for ${jiraId} completed successfully.</div>` : ''}
        </div>
        ${insights ? `
            <div class="insights">
                <h3>🤖 AI Analysis</h3>
                <p><strong>Root Cause:</strong> ${insights.rootCause || insights.summary}</p>
                <p><strong>Suggestion:</strong> ${insights.suggestion || 'N/A'}</p>
            </div>
        ` : ''}
    </div>
</body>
</html>
  `;

  fs.writeFileSync(path.join(__dirname, `../artifacts/${jiraId}/report.html`), html);
  console.log(`[REPORTER] Report generated for ${jiraId}`);
}

module.exports = generateReport;
