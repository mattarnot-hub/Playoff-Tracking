import type { ReactNode } from 'react';

/** Centered yes/no popup. Used only outside live play (the chart itself never confirms). */
export function Confirm({ message, children, onYes, onNo }: { message: string; children?: ReactNode; onYes: () => void; onNo: () => void }) {
  return (
    <div className="sheet-backdrop center" onClick={onNo}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label={message}>
        <p className="dialog-msg">{message}</p>
        {children}
        <div className="dialog-btns">
          <button className="btn big" onClick={onNo}>
            No
          </button>
          <button className="btn big primary" onClick={onYes}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bottom sheet. Tapping the backdrop closes it — no confirmation dialogs anywhere. */
export default function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          {title && <h2>{title}</h2>}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
