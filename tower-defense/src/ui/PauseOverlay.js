const el = document.getElementById('pauseOverlay');
export default class PauseOverlay {
  show(state) {
    el.innerHTML = `<div class="panel"><h2>PAUSED</h2><div>Money: $${state.money}</div><div>Wave: ${state.wave}</div><div>Lives: ${state.lives}</div><div class="small">SPACE resume · F start wave</div></div>`;
    el.classList.remove('hidden');
  }
  hide() { el.innerHTML = ''; el.classList.add('hidden'); }
}
