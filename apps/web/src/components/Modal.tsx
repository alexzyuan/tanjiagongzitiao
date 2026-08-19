import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className={`modal ${wide ? "modal-wide" : ""}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
