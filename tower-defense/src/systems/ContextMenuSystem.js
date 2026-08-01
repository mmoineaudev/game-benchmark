import EventBus from '../core/EventBus.js';

export default class ContextMenuSystem {
  hide() { const el = document.getElementById('contextMenu'); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
  open(anchor, items) {
    const el = document.getElementById('contextMenu');
    if (!el) return;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'cm-wrap';
    items.forEach(it => {
      const row = document.createElement('button');
      row.className = 'cm-row';
      row.textContent = it.label;
      row.addEventListener('click', () => { it.action(); this.hide(); });
      wrap.appendChild(row);
    });
    wrap.style.left = `${Math.max(4, anchor.x)}px`;
    wrap.style.top = `${Math.max(4, anchor.y)}px`;
    el.appendChild(wrap);
    el.classList.remove('hidden');
    setTimeout(() => {
      const close = (e) => { if (!wrap.contains(e.target)) { this.hide(); document.removeEventListener('mousedown', close); } };
      document.addEventListener('mousedown', close);
    }, 0);
  }
  update() {}
}
