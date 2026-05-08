import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ClarifyQuestion } from './ConversationalAgent';

interface Props {
  questions: ClarifyQuestion[];
  locked: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}

const ClarificationCard: React.FC<Props> = ({ questions, locked, onSubmit }) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const set = (id: string, value: string) => setAnswers(prev => ({ ...prev, [id]: value }));

  const allRequiredAnswered = questions
    .filter(q => q.required)
    .every(q => (answers[q.id] || '').trim().length > 0);

  if (locked) {
    return (
      <div className="card-clarify card-clarify-locked">
        <div className="card-clarify-header">
          <CheckCircle2 size={16} color="#34d399" />
          <span>Answers submitted</span>
        </div>
        {questions.map(q => (
          <div key={q.id} className="card-clarify-locked-row">
            <span className="conf-label">{q.question}</span>
            <span className="conf-value">{answers[q.id] || '—'}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card-clarify">
      {questions.map((q, idx) => (
        <div key={q.id} className="card-clarify-q">
          <label className="card-clarify-label">
            <span className="card-clarify-num">{idx + 1}.</span> {q.question}
            {q.required && <span className="card-clarify-required"> *</span>}
          </label>

          {q.type === 'choice' && q.options ? (
            <div className="card-clarify-options">
              {q.options.map(opt => (
                <label key={opt} className={`card-clarify-option ${answers[q.id] === opt ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name={q.id}
                    value={opt}
                    checked={answers[q.id] === opt}
                    onChange={e => set(q.id, e.target.value)}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          ) : (
            <input
              type="text"
              className="card-clarify-input"
              value={answers[q.id] || ''}
              onChange={e => set(q.id, e.target.value)}
              placeholder="Type your answer…"
            />
          )}
        </div>
      ))}

      <div className="card-clarify-actions">
        <button
          className="btn-proceed"
          onClick={() => onSubmit(answers)}
          disabled={!allRequiredAnswered}
        >
          Submit answers
        </button>
      </div>
    </div>
  );
};

export default ClarificationCard;
