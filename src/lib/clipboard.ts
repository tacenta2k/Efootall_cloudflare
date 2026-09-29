/** Copy only the public URL; fallback also works on browsers without Clipboard API. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* Try the selected-text fallback. */
  }
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
  document.body.append(area);
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    area.remove();
    focused?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    ranges.forEach((r) => selection?.addRange(r));
  }
}
