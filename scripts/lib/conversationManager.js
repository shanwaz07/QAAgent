const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARTIFACTS_DIR = path.join(__dirname, '../../artifacts');

// Phase identifiers used across server, agents, and frontend.
const PHASES = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  CLARIFYING: 'clarifying',
  PLAN_REVIEW: 'plan_review',
  TC_REVIEW: 'tc_review',
  EXECUTING: 'executing',
  DONE: 'done',
  ERROR: 'error',
};

class ConversationManager {
  constructor() {
    this.sessions = new Map();
  }

  // Create a new session. If sessionId is provided, reuse it (resume across page refresh).
  create(sessionId) {
    const id = sessionId || crypto.randomUUID();
    const now = new Date().toISOString();
    const session = {
      sessionId: id,
      phase: PHASES.IDLE,
      jiraId: null,
      requirements: null,
      ragContext: [],
      targetUrl: '',
      pendingQuestions: [],
      answers: {},
      testPlan: null,
      conversationHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  // Merge patch into session and bump updatedAt. Returns the updated session.
  update(sessionId, patch) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
  }

  // Append a turn to the conversation history.
  appendHistory(sessionId, entry) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.conversationHistory.push({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    return session;
  }

  destroy(sessionId) {
    return this.sessions.delete(sessionId);
  }

  // Persist transcript to artifacts/{jiraId}/conversation.json for audit.
  // Safe to call multiple times — overwrites the file each time.
  saveTranscript(sessionId, finalStatus = 'completed') {
    const session = this.sessions.get(sessionId);
    if (!session || !session.jiraId) return null;

    const dir = path.join(ARTIFACTS_DIR, session.jiraId);
    fs.mkdirSync(dir, { recursive: true });

    const transcriptPath = path.join(dir, 'conversation.json');
    const transcript = {
      sessionId: session.sessionId,
      jiraId: session.jiraId,
      startedAt: session.createdAt,
      endedAt: new Date().toISOString(),
      targetUrl: session.targetUrl,
      conversationHistory: session.conversationHistory,
      testPlan: session.testPlan,
      answers: session.answers,
      finalStatus,
    };

    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), 'utf8');
    return transcriptPath;
  }

  // Cleanup sessions older than maxAgeMs (default 24h). Call periodically if needed.
  pruneStale(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.updatedAt).getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}

// Singleton — server.js imports this and shares one instance across requests.
const conversationManager = new ConversationManager();

module.exports = { conversationManager, PHASES };
