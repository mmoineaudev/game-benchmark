(async () => {
  const mods = ['./src/core/Constants.js','./src/core/GameState.js','./src/core/Game.js'];
  for (const m of mods) {
    try {
      await import(m);
      console.log(m, 'OK');
    } catch(e){
      console.error(m, 'FAIL', e.message);
    }
  }
})();
