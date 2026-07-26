const el = document.getElementById('deathOverlay');
export default class DeathOverlay {
  show(state) {
    el.innerHTML = `<div class="panel"><h2>GAME OVER</h2><div>Reached Wave ${state.wave}</div><div>Kills ${state.stats.enemiesKilled}</div><div class="small">Press R to restart</div></div>`;
    el.classList.remove('hidden');
  }
  hide() { el.innerHTML = ''; el.classList.add('hidden'); }
}
