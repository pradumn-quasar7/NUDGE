import { useEffect, useState } from 'react';

/**
 * The current time as render-safe state. Relative labels ("due in 7 h", "Today") stay correct
 * while a screen is open, and rendering stays pure (no Date.now() during render).
 */
export function useNow(refreshMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);
  return now;
}
