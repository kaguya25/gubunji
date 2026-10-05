import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
it('sample UI keeps item search out of the drop-rate denominator and returns to empty real history', async () => {
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('document', window.document);
  try {
    await import('../src/app');
    const root = window.document.querySelector('#app')!;
    await vi.waitFor(() => expect(root.textContent).toContain('最初のリザルト'));
    (root.querySelector('[data-action="demo"]') as any).click();
    await vi.waitFor(() => expect(root.textContent).toContain('サンプル表示'));
    (root.querySelector('[data-page="drops"]') as any).click();
    const input = root.querySelector('#search') as any;
    input.value = 'ヒヒ';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(root.textContent).toContain('1 / 8戦');
    expect(root.textContent).toContain('12.5%');
    expect(root.textContent).not.toContain('28個');
    (root.querySelector('[data-action="actual"]') as any).click();
    await vi.waitFor(() => expect(root.textContent).not.toContain('サンプル表示 ・'));
    (root.querySelector('[data-page="records"]') as any).click();
    expect(root.textContent).toContain('最初のリザルト');
  } finally {
    vi.unstubAllGlobals();
    await window.happyDOM.close();
  }
});
