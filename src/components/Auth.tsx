import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { auth, authConfigurationError, signInWithGoogle } from '../lib/auth';
import { Modal, ErrorText } from './ui';
export default function Auth({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="Your tournament. Your control." onClose={onClose}>
      <div className="auth-icon">
        <ShieldCheck size={30} />
      </div>
      <p className="muted">
        Sign in with Google to create and manage your tournaments. Spectators can watch without an
        account.
      </p>
      <ErrorText message={error || authConfigurationError || ''} />
      <button
        className="button primary full"
        disabled={busy || !auth}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await signInWithGoogle();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to sign in.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      <p className="fine-print">No shared PINs. Only the creator can change tournament data.</p>
    </Modal>
  );
}
