import { useEffect, useRef, useState } from 'react';

export const QUICK_TAP_MS = 500;
const MARK_MENU_MS = 600;
const MOVE_CANCEL_PX = 24;

export interface FieldMark {
  id: number;
  order: number;
  hit: boolean;
  x: number; // 0–1
  y: number; // 0–1
}

/* ---------- field.svg loading (one file, swappable without code changes) ---------- */

let svgText: Promise<string> | null = null;
function loadFieldSvg() {
  svgText ??= fetch(`${import.meta.env.BASE_URL}field.svg`).then((r) => r.text());
  return svgText;
}

const ZONES: [string, string][] = [
  ['zone-foul-left', 'Foul (left)'],
  ['zone-foul-right', 'Foul (right)'],
  ['zone-over-fence', 'Over the fence'],
  ['zone-left', 'Left field'],
  ['zone-center', 'Center field'],
  ['zone-right', 'Right field'],
];

/** Name of the optional zone a mark falls in, if field.svg defines zone paths. */
export function zoneOf(x: number, y: number): string | null {
  const svg = document.querySelector('.field-svg svg');
  if (!svg) return null;
  for (const [id, label] of ZONES) {
    const el = svg.querySelector(`#${id}`) as SVGGeometryElement | null;
    if (el?.isPointInFill?.(new DOMPoint(x * 1000, y * 1000))) return label;
  }
  return null;
}

/* ---------- haptics ---------- */

function buzz() {
  if (navigator.vibrate?.(60)) return;
  // iOS Safari has no Vibration API; toggling a native switch control produces a system haptic (iOS 18+).
  try {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    label.style.display = 'none';
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* no haptics available */
  }
}

/* ---------- marks layer (shared with the printed sheet) ---------- */

export function MarksLayer({
  marks,
  dimmed,
  highlighted,
  flashId,
  caption,
}: {
  marks: FieldMark[];
  dimmed?: (m: FieldMark) => boolean;
  highlighted?: (m: FieldMark) => boolean;
  flashId?: number | null;
  caption?: string;
}) {
  return (
    <>
      {caption && (
        <text x="16" y="36" className="field-caption">
          {caption}
        </text>
      )}
      {marks.map((m) => {
        const cls = ['mark', m.hit ? 'hit' : 'out'];
        if (dimmed?.(m)) cls.push('dim');
        if (highlighted?.(m)) cls.push('hl');
        if (m.id === flashId) cls.push('flash');
        return (
          <g key={m.id} data-mark={m.id} className={cls.join(' ')} transform={`translate(${m.x * 1000} ${m.y * 1000})`}>
            <g className="mark-inner">
              <circle r="42" className="mark-target" />
              {m.hit && <circle r="30" className="mark-circle" />}
              <text dy="0.36em" textAnchor="middle" className="mark-text">
                {m.order}
              </text>
            </g>
          </g>
        );
      })}
    </>
  );
}

/* ---------- interactive field ---------- */

interface Props {
  marks: FieldMark[];
  holdMs: number;
  readOnly?: boolean;
  moving?: boolean;
  dimmed?: (m: FieldMark) => boolean;
  highlighted?: (m: FieldMark) => boolean;
  flashId?: number | null;
  caption?: string;
  onOut: (x: number, y: number) => void;
  onHit: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onMarkMenu: (id: number) => void;
}

interface Press {
  pointerId: number;
  x: number; // viewBox units
  y: number;
  cx: number; // client px
  cy: number;
  t0: number;
  markId: number | null;
  done: boolean;
  timer: number;
}

export default function Field(props: Props) {
  const { marks, holdMs, readOnly, moving } = props;
  const [svg, setSvg] = useState('');
  const overlay = useRef<SVGSVGElement>(null);
  const press = useRef<Press | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; solid: boolean; key: number } | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    loadFieldSvg().then(setSvg);
  }, []);

  // If the phone locks or the app is backgrounded mid-press, the release never arrives; drop the press.
  useEffect(() => {
    const onHide = () => document.hidden && cancel();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  function toViewBox(e: React.PointerEvent) {
    const ctm = overlay.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return { x: Math.max(0, Math.min(1000, p.x)), y: Math.max(0, Math.min(1000, p.y)) };
  }

  function cancel() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setRing(null);
  }

  function onDown(e: React.PointerEvent<SVGSVGElement>) {
    if (readOnly) return;
    // A new touch always wins over a press whose release was lost, so the field can never get stuck.
    if (press.current) cancel();
    e.preventDefault();
    try {
      overlay.current!.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    const { x, y } = toViewBox(e);
    const markAttr = (e.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
    const markId = !moving && markAttr ? Number(markAttr) : null;
    const p: Press = { pointerId: e.pointerId, x, y, cx: e.clientX, cy: e.clientY, t0: performance.now(), markId, done: false, timer: 0 };
    press.current = p;
    if (markId != null) {
      // Long-press an existing mark opens the fix menu.
      p.timer = window.setTimeout(() => {
        p.done = true;
        buzz();
        cb.current.onMarkMenu(markId);
      }, MARK_MENU_MS);
    } else if (!moving) {
      setRing({ x, y, solid: false, key: p.t0 });
      p.timer = window.setTimeout(() => {
        buzz();
        setRing((r) => (r ? { ...r, solid: true } : r));
      }, holdMs);
    }
  }

  function onMovePtr(e: React.PointerEvent) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > MOVE_CANCEL_PX) cancel();
  }

  function onUp(e: React.PointerEvent) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const held = performance.now() - p.t0;
    const done = p.done;
    cancel();
    if (done) return;
    const fx = p.x / 1000;
    const fy = p.y / 1000;
    if (moving) {
      if (held < QUICK_TAP_MS) cb.current.onMove(fx, fy);
    } else if (held < QUICK_TAP_MS) {
      cb.current.onOut(fx, fy);
    } else if (held >= holdMs && p.markId == null) {
      cb.current.onHit(fx, fy);
    }
    // Released between 0.5 s and the hold time: cancelled, nothing recorded.
  }

  const circ = 2 * Math.PI * 80;
  return (
    <div className={'field-wrap' + (moving ? ' moving' : '')}>
      <div className="field-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      <svg
        ref={overlay}
        className="field-overlay"
        viewBox="0 0 1000 1000"
        onPointerDown={onDown}
        onPointerMove={onMovePtr}
        onPointerUp={onUp}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <rect width="1000" height="1000" fill="transparent" />
        <MarksLayer marks={marks} dimmed={props.dimmed} highlighted={props.highlighted} flashId={props.flashId} caption={props.caption} />
        {ring && (
          <g transform={`translate(${ring.x} ${ring.y})`} className={'hold-ring' + (ring.solid ? ' solid' : '')}>
            <circle r="80" className="hold-track" />
            <circle
              key={ring.key}
              r="80"
              className="hold-progress"
              strokeDasharray={circ}
              strokeDashoffset={circ}
              transform="rotate(-90)"
              style={{ animationDuration: `${holdMs}ms` }}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
