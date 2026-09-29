import { useState } from 'react';
import { LOGO_BUCKET, logoPath } from '../lib/logos';
export default function TeamLogo({ value }: { value: string }) {
  const [failed, setFailed] = useState('');
  const path = logoPath(value);
  if (!path) return <>{value}</>;
  if (failed === value) return <>⚽</>;
  return (
    <img
      className="team-logo-image"
      alt="Team logo"
      src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${path}`}
      onError={() => setFailed(value)}
    />
  );
}
