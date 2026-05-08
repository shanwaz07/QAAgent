import React, { useState, useEffect } from 'react';
import { Compass, FileText } from 'lucide-react';
import { io } from 'socket.io-client';

interface ExploredPage {
  jiraId: string;
  page: string;
  snapshotPath: string;
  timestamp: number;
}

const socket = io('http://localhost:5000');

interface Props {
  jiraId: string;
}

// Informational card — shows live as PageExplorer captures DOM snapshots during execution.
// Not a gate; user doesn't approve anything here. It exists so the user can see the agent
// "getting familiar with the application" before scripts run, matching the user's intent.
const ExplorationCard: React.FC<Props> = ({ jiraId }) => {
  const [pages, setPages] = useState<ExploredPage[]>([]);

  useEffect(() => {
    const onExplored = (data: ExploredPage) => {
      if (data.jiraId !== jiraId) return;
      setPages(prev => prev.find(p => p.page === data.page) ? prev : [...prev, { ...data, timestamp: Date.now() }]);
    };
    socket.on('page_explored', onExplored);
    return () => { socket.off('page_explored', onExplored); };
  }, [jiraId]);

  if (pages.length === 0) return null;

  return (
    <div className="card-exploration">
      <div className="card-exploration-header">
        <Compass size={14} color="#34d399" />
        <span>Exploring application — {pages.length} page{pages.length === 1 ? '' : 's'} captured</span>
      </div>
      <ul className="card-exploration-list">
        {pages.map(p => (
          <li key={p.page}>
            <FileText size={11} />
            <span className="mono card-exploration-page">{p.page}</span>
            <span className="card-exploration-path">{p.snapshotPath.split(/[\\/]/).slice(-2).join('/')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExplorationCard;
