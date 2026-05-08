class SelfHealer {
  constructor() {
    this.history = [];
  }

  async heal(failedLocator, errorMessage, pageSnapshot = '') {
    console.log(`[SELF-HEALER] Analyzing failure for: ${failedLocator}`);
    const suggestion = await this.getAISuggestion(failedLocator, errorMessage, pageSnapshot);
    if (suggestion && suggestion.newLocator) {
      console.log(`[SELF-HEALER] Suggested fix: ${suggestion.newLocator} (confidence: ${suggestion.confidence})`);
      this.history.push({ failedLocator, ...suggestion });
      return suggestion.newLocator;
    }
    throw new Error('Self-healing failed: no suggestion returned.');
  }

  async getAISuggestion(failedLocator, errorMessage, pageSnapshot = '') {
    // Lazy require to avoid circular dependency at module load time
    const { chat } = require('./lib/llmClient');

    const prompt = `A Playwright test failed. Suggest a fixed locator.

Failed locator: ${failedLocator}
Error message: ${errorMessage}
Page accessibility snapshot (partial):
${pageSnapshot.slice(0, 1000) || '(not available)'}

Return ONLY valid JSON — no explanation, no markdown:
{"newLocator": "page.getByRole(...) or page.locator(...)", "confidence": 0.0, "reason": "short explanation"}`;

    try {
      const raw = await chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0, maxTokens: 256 },
      );
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('[SELF-HEALER] LLM call failed:', err.message);
      // Heuristic fallback when LLM is unavailable
      const match = failedLocator.match(/["']([^"']+)["']/);
      const label = match ? match[1] : 'unknown';
      return { newLocator: `page.getByLabel('${label}')`, confidence: 0.3, reason: 'heuristic fallback' };
    }
  }
}

module.exports = SelfHealer;
