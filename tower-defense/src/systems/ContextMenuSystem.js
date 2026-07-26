import EventBus from '../core/EventBus.js';

export default class ContextMenuSystem {
  hide() { const el = document.getElementById('contextMenu'); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
  open(anchor, items) {
    const el = document.getElementById('contextMenu');
    if (!el) return;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    items.forEach(it => {
      const row = document.createElement('button');
      row.className = 'cm-row';
      row.textContent = it.label;
      row.addEventListener('click', () => { it.action(); this.hide(); });
      wrap.appendChild(row);
    });
    el.style.left = `${anchor.x}px`;
    el.style.top = `${anchor.y}px`;
    el.classList.remove('hidden');
    setTimeout(() => {
      const close = (e) => { if (!el.contains(e.target)) { this.hide(); document.removeEventListener('mousedown', close); } };
      document.addEventListener('mousedown', close);
    }, 0);
  }
  update() {}
}
