import { useEffect, useMemo, useState } from 'react';
import {
  CHAINWHISPER_TESTNET_QA_JOURNEYS,
  clearTestnetQaProgress,
  getActiveTestnetQaManifestHash,
  parseTestnetQaProgress,
  readTestnetQaProgress,
  toggleTestnetQaJourney,
  writeTestnetQaProgress,
  type TestnetQaArea,
  type TestnetQaProgress
} from '../../../lib/chainWhisperTestnetQa';

const AREAS: readonly TestnetQaArea[] = ['Wallet', 'Chat', 'Trading', 'Integration', 'Recovery'];

type TestnetQaChecklistProps = Readonly<{
  onNavigate: (path: string) => void;
}>;

export default function TestnetQaChecklist({ onNavigate }: TestnetQaChecklistProps) {
  const manifestHash = getActiveTestnetQaManifestHash();
  const [progress, setProgress] = useState<TestnetQaProgress | null>(() =>
    manifestHash ? parseTestnetQaProgress(null, manifestHash) : null
  );

  useEffect(() => {
    if (!manifestHash) return;
    try {
      setProgress(readTestnetQaProgress(window.localStorage, manifestHash));
    } catch {
      setProgress(parseTestnetQaProgress(null, manifestHash));
    }
  }, [manifestHash]);

  const completed = progress?.completed ?? [];
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const total = CHAINWHISPER_TESTNET_QA_JOURNEYS.length;
  const next = CHAINWHISPER_TESTNET_QA_JOURNEYS.find(({ id }) => !completedSet.has(id));
  const progressPercent = Math.round((completed.length / total) * 100);

  if (!manifestHash || !progress) return null;

  const updateJourney = (journeyId: string, complete: boolean) => {
    setProgress((current) => {
      if (!current) return current;
      const nextProgress = toggleTestnetQaJourney(current, journeyId, complete);
      try {
        writeTestnetQaProgress(window.localStorage, nextProgress);
      } catch {
        // The checklist still works for this session if browser storage is unavailable.
      }
      return nextProgress;
    });
  };

  const reset = () => {
    try {
      clearTestnetQaProgress(window.localStorage, manifestHash);
    } catch {
      // Clearing in-memory progress remains useful when browser storage is unavailable.
    }
    setProgress(parseTestnetQaProgress(null, manifestHash));
  };

  return (
    <details className="testnet-qa-checklist">
      <summary>
        <span>
          <span className="testnet-token-admission-kicker">Manual candidate QA</span>
          <strong>{completed.length} of {total} live journeys verified</strong>
          <small>{next ? `Test next: ${next.title}` : 'All app journeys are marked verified.'}</small>
        </span>
        <span className="testnet-qa-summary-progress" aria-label={`${progressPercent}% verified`}>
          {progressPercent}%
        </span>
      </summary>
      <div className="testnet-qa-intro">
        <p>
          Mark a journey only after completing it with real testnet wallets. Unit tests and contract proofs do not mark
          anything here. Progress is local to this browser and this exact contract manifest.
        </p>
        <button type="button" className="secondary" onClick={reset} disabled={completed.length === 0}>
          Reset marks
        </button>
      </div>
      <div className="testnet-qa-groups">
        {AREAS.map((area) => (
          <section key={area} className="testnet-qa-group" aria-labelledby={`testnet-qa-${area.toLowerCase()}`}>
            <h3 id={`testnet-qa-${area.toLowerCase()}`}>{area}</h3>
            {CHAINWHISPER_TESTNET_QA_JOURNEYS.filter((journey) => journey.area === area).map((journey) => {
              const checked = completedSet.has(journey.id);
              return (
                <div key={journey.id} className={checked ? 'testnet-qa-row is-complete' : 'testnet-qa-row'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => updateJourney(journey.id, event.target.checked)}
                    />
                    <span>
                      <strong>{journey.title}</strong>
                      <small>{journey.description}</small>
                    </span>
                  </label>
                  <button type="button" className="secondary" onClick={() => onNavigate(journey.path)}>
                    Open
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </details>
  );
}
