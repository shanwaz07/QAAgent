import React, { useState } from 'react';
import { Play, Trash2, Pencil, Check, X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import type { TestCase } from './ConversationalAgent';

interface Props {
  cases: TestCase[];
  locked: boolean;
  onConfirm: (finalCases: TestCase[]) => void;
}

interface CaseDraft extends TestCase {
  removed: boolean;
  expanded: boolean;
  editing: boolean;
  // working copy (only populated while editing)
  draft?: TestCase;
}

const TestCaseReviewCard: React.FC<Props> = ({ cases, locked, onConfirm }) => {
  const [drafts, setDrafts] = useState<CaseDraft[]>(
    () => cases.map(tc => ({ ...tc, removed: false, expanded: false, editing: false })),
  );

  const update = (id: string, patch: Partial<CaseDraft>) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const startEdit = (id: string) => update(id, { editing: true, expanded: true, draft: drafts.find(d => d.id === id) });
  const cancelEdit = (id: string) => update(id, { editing: false, draft: undefined });
  const saveEdit = (id: string) => {
    const d = drafts.find(x => x.id === id);
    if (!d || !d.draft) return;
    update(id, {
      title: d.draft.title,
      steps: d.draft.steps,
      expectedResult: d.draft.expectedResult,
      targetPage: d.draft.targetPage,
      type: d.draft.type,
      priority: d.draft.priority,
      editing: false,
      draft: undefined,
    });
  };

  const updateDraft = (id: string, patch: Partial<TestCase>) => {
    setDrafts(prev => prev.map(d => d.id === id && d.draft ? { ...d, draft: { ...d.draft, ...patch } } : d));
  };

  const setStep = (id: string, idx: number, value: string) => {
    setDrafts(prev => prev.map(d => {
      if (d.id !== id || !d.draft) return d;
      const steps = [...d.draft.steps];
      steps[idx] = value;
      return { ...d, draft: { ...d.draft, steps } };
    }));
  };

  const addStep = (id: string) => {
    setDrafts(prev => prev.map(d => {
      if (d.id !== id || !d.draft) return d;
      return { ...d, draft: { ...d.draft, steps: [...d.draft.steps, ''] } };
    }));
  };

  const removeStep = (id: string, idx: number) => {
    setDrafts(prev => prev.map(d => {
      if (d.id !== id || !d.draft) return d;
      const steps = d.draft.steps.filter((_, i) => i !== idx);
      return { ...d, draft: { ...d.draft, steps } };
    }));
  };

  const keptCount = drafts.filter(d => !d.removed).length;

  const handleConfirm = () => {
    const finalCases: TestCase[] = drafts
      .filter(d => !d.removed)
      .map(d => ({
        id: d.id,
        title: d.title,
        type: d.type,
        priority: d.priority,
        steps: d.steps.filter(s => s.trim().length > 0),
        expectedResult: d.expectedResult,
        targetPage: d.targetPage,
      }));
    onConfirm(finalCases);
  };

  if (locked) {
    const final = drafts.filter(d => !d.removed);
    return (
      <div className="card-tc-review card-tc-review-locked">
        <div className="card-tc-locked-header">
          <Check size={14} color="#34d399" /> Confirmed {final.length} test case(s) for execution
        </div>
        <ul className="card-tc-locked-list">
          {final.map(d => <li key={d.id}><span className="mono">{d.id}</span> {d.title}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div className="card-tc-review">
      <div className="card-tc-header">
        <span>{keptCount} of {drafts.length} test case(s) selected</span>
      </div>

      <div className="card-tc-list">
        {drafts.map(d => (
          <div key={d.id} className={`card-tc-item ${d.removed ? 'removed' : ''} ${d.editing ? 'editing' : ''}`}>
            <div className="card-tc-row">
              <button
                className="card-tc-expand"
                onClick={() => update(d.id, { expanded: !d.expanded })}
                type="button"
                disabled={d.editing}
              >
                {d.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="card-tc-id mono">{d.id}</span>
              <span className="card-tc-title">{d.title}</span>
              <span className={`card-plan-case-type type-${(d.type || '').toLowerCase()}`}>{d.type}</span>
              <span className={`card-plan-case-priority pri-${(d.priority || '').toLowerCase()}`}>{d.priority}</span>

              <div className="card-tc-actions">
                {!d.editing && !d.removed && (
                  <button className="card-tc-icon-btn" onClick={() => startEdit(d.id)} title="Edit">
                    <Pencil size={13} />
                  </button>
                )}
                {!d.editing && (
                  d.removed ? (
                    <button className="card-tc-icon-btn" onClick={() => update(d.id, { removed: false })} title="Restore">
                      <RotateCcw size={13} />
                    </button>
                  ) : (
                    <button className="card-tc-icon-btn danger" onClick={() => update(d.id, { removed: true, editing: false })} title="Remove">
                      <Trash2 size={13} />
                    </button>
                  )
                )}
              </div>
            </div>

            {(d.expanded || d.editing) && !d.removed && (
              <div className="card-tc-details">
                {d.editing && d.draft ? (
                  <>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Title</span>
                      <input
                        className="card-clarify-input"
                        value={d.draft.title}
                        onChange={e => updateDraft(d.id, { title: e.target.value })}
                      />
                    </div>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Steps</span>
                      {d.draft.steps.map((s, i) => (
                        <div key={i} className="card-tc-step-edit">
                          <span className="card-tc-step-num">{i + 1}.</span>
                          <input
                            className="card-clarify-input"
                            value={s}
                            onChange={e => setStep(d.id, i, e.target.value)}
                          />
                          <button
                            className="card-tc-icon-btn danger"
                            onClick={() => removeStep(d.id, i)}
                            title="Remove step"
                            type="button"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <button className="card-tc-add-step" onClick={() => addStep(d.id)} type="button">
                        + Add step
                      </button>
                    </div>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Expected result</span>
                      <textarea
                        className="card-clarify-input card-tc-textarea"
                        value={d.draft.expectedResult}
                        onChange={e => updateDraft(d.id, { expectedResult: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Target URL</span>
                      <input
                        className="card-clarify-input mono"
                        value={d.draft.targetPage}
                        onChange={e => updateDraft(d.id, { targetPage: e.target.value })}
                      />
                    </div>
                    <div className="card-tc-edit-actions">
                      <button className="btn-proceed btn-sm" onClick={() => saveEdit(d.id)} type="button">
                        <Check size={12} /> Save
                      </button>
                      <button className="btn-cancel btn-sm" onClick={() => cancelEdit(d.id)} type="button">
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Steps</span>
                      <ol>{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    </div>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Expected</span>
                      <p>{d.expectedResult}</p>
                    </div>
                    <div className="case-detail-block">
                      <span className="case-detail-label">Page</span>
                      <p className="mono">{d.targetPage}</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card-tc-confirm">
        <button
          className="btn-proceed"
          onClick={handleConfirm}
          disabled={keptCount === 0}
        >
          <Play size={14} /> Confirm & Run {keptCount} test{keptCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
};

export default TestCaseReviewCard;
