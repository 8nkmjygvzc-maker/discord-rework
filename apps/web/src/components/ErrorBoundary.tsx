import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Letzte Verteidigungslinie gegen Render-Fehler (Phase 15): Statt einer
 * weißen Seite erscheint eine Fehlermeldung mit Neu-laden-Knopf. Muss eine
 * Klassen-Komponente sein – React bietet für componentDidCatch keinen Hook.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('Unbehandelter Render-Fehler:', error);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 p-4">
        <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-800 p-6 text-center shadow-xl">
          <p className="text-3xl">😵</p>
          <h1 className="mt-3 text-lg font-bold text-zinc-100">Da ist etwas schiefgelaufen</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ein unerwarteter Fehler hat die Anzeige unterbrochen. Neu laden behebt das in der Regel
            – deine Nachrichten und Schlüssel sind davon nicht betroffen.
          </p>
          <p className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs break-words text-zinc-500">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500"
          >
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
