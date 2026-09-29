import { useEffect, useRef, useState } from 'react';
import { emojiCategories, logoPath, optimizeLogo } from '../lib/logos';
import { discardLogo, uploadLogo } from '../lib/logoUpload';
import TeamLogo from './TeamLogo';
import { ErrorText, Modal } from './ui';

export default function LogoPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void | Promise<void>;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="logo-picker-trigger"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <TeamLogo value={value} />
        <span className="sr-only">Choose logo</span>
      </button>
      {open && (
        <LogoDialog
          value={value}
          label={label}
          onClose={() => setOpen(false)}
          onChange={onChange}
        />
      )}
    </>
  );
}
function LogoDialog({
  value,
  label,
  onClose,
  onChange,
}: {
  value: string;
  label: string;
  onClose: () => void;
  onChange: (value: string) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState(value);
  const [category, setCategory] = useState<keyof typeof emojiCategories>('Football / Sports');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  useEffect(() => {
    if (!blob) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  async function selectFile(file: File) {
    if (processing.current) return;
    processing.current = true;
    setBusy('Processing image…');
    setError('');
    try {
      setBlob(await optimizeLogo(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to process image.');
    } finally {
      processing.current = false;
      setBusy('');
    }
  }
  return (
    <Modal
      title="Choose team logo"
      onClose={() => {
        if (!processing.current) onClose();
      }}
    >
      <div className="logo-preview" aria-label="Selected logo">
        {preview ? (
          <img src={preview} alt="Selected logo preview" />
        ) : (
          <TeamLogo value={selected} />
        )}
        <small>
          {blob
            ? 'New image · square crop'
            : logoPath(selected)
              ? 'Current uploaded logo'
              : 'Selected emoji'}
        </small>
      </div>
      <button
        type="button"
        className="button secondary full"
        disabled={!!busy}
        onClick={() => input.current?.click()}
      >
        Upload from device
      </button>
      <input
        ref={input}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload team logo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void selectFile(file);
        }}
      />
      <p className="fine-print">
        JPG, PNG or WebP · up to 10 MB. Images are center-cropped and optimized to a square up to
        256 px. Sign in to upload.
      </p>
      <label>
        Emoji category
        <select
          value={category}
          disabled={!!busy}
          onChange={(e) => setCategory(e.target.value as keyof typeof emojiCategories)}
        >
          {Object.keys(emojiCategories).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <div className="logo-emoji-grid" role="group" aria-label={`${category} emojis`}>
        {emojiCategories[category].map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={!!busy}
            aria-label={`Select ${emoji}`}
            aria-pressed={!blob && selected === emoji}
            onClick={() => {
              setSelected(emoji);
              setBlob(null);
              setError('');
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <label>
        Custom emoji
        <input
          aria-label={`${label} emoji`}
          value={logoPath(selected) || blob ? '' : selected}
          maxLength={16}
          disabled={!!busy}
          onChange={(e) => {
            setSelected(e.target.value);
            setBlob(null);
          }}
        />
      </label>
      <ErrorText message={error} />
      {busy && <p role="status">{busy}</p>}
      <div className="logo-picker-actions">
        <button type="button" className="button secondary" disabled={!!busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!!busy || (!blob && !selected.trim())}
          onClick={async () => {
            if (processing.current) return;
            processing.current = true;
            setBusy(blob ? 'Uploading logo…' : 'Saving logo…');
            setError('');
            let uploaded: string | undefined;
            try {
              const next = blob ? (uploaded = await uploadLogo(blob)) : selected.trim();
              await onChange(next);
              if (next !== value) void discardLogo(value);
              onClose();
            } catch (e) {
              if (uploaded) void discardLogo(uploaded);
              setError(e instanceof Error ? e.message : 'Unable to save logo. Please retry.');
            } finally {
              processing.current = false;
              setBusy('');
            }
          }}
        >
          Use logo
        </button>
      </div>
    </Modal>
  );
}
