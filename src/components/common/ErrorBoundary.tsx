import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * A page that fails to draw shows a message instead of blanking the whole app; the menu stays usable.
 * `resetKey` (the current page) clears the error when the user moves to another page.
 */
export class ErrorBoundary extends React.Component<{ resetKey?: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Sahifa xatosi]', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-10 max-w-lg space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
        <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5" />Bu bo‘limni ko‘rsatishda xatolik yuz berdi</div>
        <p className="text-xs">Boshqa bo‘limlar ishlayveradi. Muammo takrorlansa, shu yozuvni skrinshot qilib yuboring:</p>
        <pre className="max-h-32 overflow-auto rounded-lg bg-white/70 p-2 text-[11px] text-rose-800">{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">
          <RefreshCw className="h-3.5 w-3.5" />Sahifani yangilash
        </button>
      </div>
    );
  }
}
