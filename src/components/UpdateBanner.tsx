// Aviso de versión nueva: si se publicó una actualización mientras la app
// estaba abierta, se ofrece recargar (en vez de seguir con la versión vieja).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return String((await r.json()).build ?? '');
  } catch {
    return null;
  }
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let alive = true;
    const check = async () => {
      const b = await latestBuild();
      if (alive && b && b !== __BUILD_ID__) setStale(true);
    };
    check();
    const t = setInterval(check, 120_000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
    };
  }, []);
  return (
    <AnimatePresence>
      {stale && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 xl:bottom-6"
          role="status"
        >
          <button
            onClick={() => window.location.reload()}
            className="focus-ring flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-bg shadow-2xl"
          >
            <RefreshCw size={16} aria-hidden /> Hay una versión nueva · Actualizar
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
