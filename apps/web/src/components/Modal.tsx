import { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Schlichtes zentriertes Modal mit Overlay; Klick auf das Overlay schließt. */
export default function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      {/* max-h + overflow: hohe Dialoge (z. B. Rollen) scrollen intern, statt
          über den Viewport hinaus abgeschnitten zu werden. */}
      <div
        className="chat-scrollbar animate-pop-in max-h-full w-full max-w-sm overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-800 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
