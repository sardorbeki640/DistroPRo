/**
 * Copies text; false when the browser refuses (page not focused, http address, old browser).
 * Falls back to the old selection copy, which works where the clipboard API is blocked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* try the fallback */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export const COPY_FAILED = 'Nusxalab bo‘lmadi — matnni qo‘lda belgilab nusxa oling.';
