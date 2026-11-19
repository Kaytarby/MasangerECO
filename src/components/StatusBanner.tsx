import React, { useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

export default function StatusBanner() {
  const { health } = useSocket();
  const [dismissed, setDismissed] = useState(false);

  if (!health || dismissed) return null;

  const needsAttention = !health.ok || !health.persistent || !health.schemaReady;
  if (!needsAttention || !health.hint) return null;

  const isError = !health.ok || !health.schemaReady;

  return (
    <div
      className={`w-full px-4 py-2 text-xs flex items-center justify-between gap-3 shrink-0 ${
        isError
          ? 'bg-red-50 text-red-800 border-b border-red-200'
          : 'bg-amber-50 text-amber-900 border-b border-amber-200'
      }`}
    >
      <span>{health.hint}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="opacity-70 hover:opacity-100 font-medium shrink-0"
        aria-label="Скрыть уведомление"
      >
        ✕
      </button>
    </div>
  );
}
