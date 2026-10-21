import { useEffect, useState } from 'react';
import { api, type DistributionSystem } from '../services/api.ts';

/** Generic name used while nothing is connected (or still loading). */
export const NO_SYSTEM = 'Distribyutor tizimi';

let cached: Promise<DistributionSystem | null> | null = null;

/**
 * The connected distribution system (SalesDoctor, Linko or any other), shared by all screens so texts and buttons
 * follow whichever system is connected instead of a fixed one. `refreshDistribution()` after changing integrations.
 */
export function useDistribution(): { system: DistributionSystem | null; name: string; loaded: boolean } {
  const [state, setState] = useState<{ system: DistributionSystem | null; loaded: boolean }>({ system: null, loaded: false });
  useEffect(() => {
    let alive = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      if (!cached) cached = api.getActiveDistribution().then(r => r.active).catch(() => { cached = null; return null; });
      cached.then(system => { if (alive && current === request) setState({ system, loaded: true }); });
    };
    const refresh = () => load();
    window.addEventListener('distribution:refresh', refresh);
    load();
    return () => { alive = false; request++; window.removeEventListener('distribution:refresh', refresh); };
  }, []);
  return { system: state.system, name: state.system?.name || NO_SYSTEM, loaded: state.loaded };
}

export function refreshDistribution() {
  cached = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('distribution:refresh'));
}
