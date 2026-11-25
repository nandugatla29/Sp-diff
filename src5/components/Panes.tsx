import { Fragment, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { usePersistentState } from '../lib/Session';

/* =====================================================================================
 * Side-by-side panels that the user can resize (drag the bar between two panels,
 * double-click it to reset) and collapse (button in the panel header). Sizes are
 * remembered per layout id.
 * ===================================================================================== */

export interface PaneDef {
  id: string;
  title: ReactNode;
  /** Extra controls on the right of the panel header. */
  actions?: ReactNode;
  /** Relative start width. */
  size?: number;
  minPx?: number;
  body: ReactNode;
  /** Panel body handles its own scrolling (e.g. a full-height editor). */
  fill?: boolean;
}

interface Layout {
  sizes: Record<string, number>;
  collapsed: Record<string, boolean>;
}

const COLLAPSED_PX = 34;
const HANDLE_PX = 6;

export default function Panes({ id, panes, className = '' }: { id: string; panes: PaneDef[]; className?: string }) {
  const [layout, setLayout] = usePersistentState<Layout>(`panes-${id}`, { sizes: {}, collapsed: {} });
  const boxRef = useRef<HTMLDivElement>(null);
  const size = (p: PaneDef) => layout.sizes?.[p.id] ?? p.size ?? 1;
  const isCollapsed = (p: PaneDef) => !!layout.collapsed?.[p.id];

  const template = panes
    .map((p, i) => `${isCollapsed(p) ? `${COLLAPSED_PX}px` : `minmax(${p.minPx ?? 220}px, ${size(p)}fr)`}${i < panes.length - 1 ? ` ${HANDLE_PX}px` : ''}`)
    .join(' ');

  const toggle = (p: PaneDef) => setLayout((l) => ({ sizes: l.sizes ?? {}, collapsed: { ...(l.collapsed ?? {}), [p.id]: !l.collapsed?.[p.id] } }));

  /** Drag the handle between panes[i] and panes[i + 1]. */
  const startDrag = (i: number, e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const a = panes[i];
    const b = panes[i + 1];
    if (isCollapsed(a) || isCollapsed(b)) return;
    e.preventDefault();
    const els = Array.from(box.querySelectorAll<HTMLElement>(':scope > .pane'));
    const px: Record<string, number> = {};
    panes.forEach((p, k) => (px[p.id] = els[k]?.getBoundingClientRect().width ?? 300));
    const x0 = e.clientX;
    const minA = a.minPx ?? 220;
    const minB = b.minPx ?? 220;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-cols');

    const move = (ev: PointerEvent) => {
      const total = px[a.id] + px[b.id];
      const na = Math.min(total - minB, Math.max(minA, px[a.id] + ev.clientX - x0));
      setLayout((l) => ({ collapsed: l.collapsed ?? {}, sizes: { ...px, [a.id]: na, [b.id]: total - na } }));
    };
    const up = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-cols');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => setLayout((l) => ({ collapsed: l.collapsed ?? {}, sizes: {} }));

  return (
    <div ref={boxRef} className={`panes ${className}`} style={{ gridTemplateColumns: template }}>
      {panes.map((p, i) => (
        <Fragment key={p.id}>
          {isCollapsed(p) ? (
            <section className="pane collapsed">
              <button type="button" className="pane-expand" title="Show this panel" onClick={() => toggle(p)}>
                <span>{p.title}</span>
              </button>
            </section>
          ) : (
            <section className={`pane${p.fill ? ' fill' : ''}`}>
              <header className="pane-head">
                <h3>{p.title}</h3>
                <span className="spacer" />
                {p.actions}
                <button type="button" className="icon pane-min" title="Collapse this panel" onClick={() => toggle(p)}>
                  ⟨
                </button>
              </header>
              <div className="pane-body">{p.body}</div>
            </section>
          )}
          {i < panes.length - 1 && (
            <div
              className="pane-handle"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize · double-click to reset"
              onPointerDown={(e) => startDrag(i, e)}
              onDoubleClick={reset}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
