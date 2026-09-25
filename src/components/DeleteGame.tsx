import { useState } from 'react';
import { deleteGame } from '../db';
import { Confirm } from './Sheet';

// Guards against deleting a game by accident. The app has no server, so this is not real security.
const PASSWORD = '1985';

/** Delete flow: "Are you sure?" → password → delete. */
export default function DeleteGame({
  gameId,
  label,
  onClose,
  onDeleted,
}: {
  gameId: number;
  label: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<'confirm' | 'password'>('confirm');
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);

  async function submit() {
    if (pw === PASSWORD) {
      await deleteGame(gameId);
      onDeleted();
    } else {
      setWrong(true);
      setPw('');
    }
  }

  if (step === 'confirm') {
    return (
      <Confirm message="Are you sure?" onNo={onClose} onYes={() => setStep('password')}>
        <p className="dialog-sub">Delete {label}? All of its marks will be removed. This can’t be undone.</p>
      </Confirm>
    );
  }
  return (
    <Confirm message="Enter password" onNo={onClose} onYes={submit} yesLabel="Delete" noLabel="Cancel" danger>
      <input
        className="dialog-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        aria-label="Password"
        value={pw}
        onChange={(e) => {
          setPw(e.target.value);
          setWrong(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {wrong && <p className="dialog-error">Wrong password</p>}
    </Confirm>
  );
}
