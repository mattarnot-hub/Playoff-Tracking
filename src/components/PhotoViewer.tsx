import { useRef, useState } from 'react';

/** Full-screen image with pinch-to-zoom, drag to pan, double-tap to reset. */
export default function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ dist: number; mid: { x: number; y: number }; t: typeof t } | null>(null);
  const lastTap = useRef(0);

  function snapshot() {
    const pts = [...pointers.current.values()];
    if (pts.length === 1) return { dist: 0, mid: pts[0] };
    const [a, b] = pts;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { ...snapshot(), t };
    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) setT({ scale: 1, x: 0, y: 0 });
      lastTap.current = now;
    }
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    const cur = snapshot();
    const scale = s.dist && cur.dist ? Math.max(1, Math.min(6, (s.t.scale * cur.dist) / s.dist)) : s.t.scale;
    setT({ scale, x: s.t.x + cur.mid.x - s.mid.x, y: s.t.y + cur.mid.y - s.mid.y });
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    start.current = pointers.current.size ? { ...snapshot(), t } : null;
  }

  return (
    <div className="photo-viewer">
      <div className="photo-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={src} alt="Lineup" draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }} />
      </div>
      <button className="btn photo-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
