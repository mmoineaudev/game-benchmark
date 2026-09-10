
import('./src/core/GameState.js').then(async (m) => {
  const { GameState: G } = m;
  const C = await import('./src/core/Constants.js');
  const ITEMS = C.ITEMS;
  G.resetRun(); G.phase = 'flight';
  const run = G.run;
  const LS = await import('./src/systems/LootSystem.js');
  const loot = new LS.LootSystem();
  // Call _tryCollect directly with fake pickups (skip THREE scene).
  const fake = (id) => ({ itemDef: ITEMS.find(i=>i.id===id), position:{distanceTo:()=>0}, mesh:{ removeFromParent(){} } });
  console.log('collect hull_patch:', loot._tryCollect(fake('hull_patch'), G));
  console.log('collect scrap:', loot._tryCollect(fake('scrap'), G));
  console.log('collect golden_drone (exotic):', loot._tryCollect(fake('golden_drone'), G));
  console.log('meta.scrap=', G.meta.scrap, 'inventory=', JSON.stringify(G.meta.inventory), 'run.cargo=', JSON.stringify(run.cargo));
  G.meta.scrap = 500;
  console.log('buy hull_patch:', G.buyItem('hull_patch'), 'scrap:', G.meta.scrap, 'inv:', JSON.stringify(G.meta.inventory));
  console.log('install:', G.installItem('hull_patch'), 'installed:', JSON.stringify(run.installed));
  console.log('maxHull w/ install:', G.maxHull());
  G.uninstallItem('hull_patch');
  console.log('uninstalled:', JSON.stringify(run.installed), 'inv:', JSON.stringify(G.meta.inventory));
  console.log('sell gained:', G.sellItem('hull_patch'), 'scrap:', G.meta.scrap);
  console.log('pickupRadiusBonus:', G.pickupRadiusBonus(), 'sellBonusPct:', G.sellBonusPct());
  G.meta.scrap = 100000;
  console.log('buyShip flagship:', G.buyShip('flagship'), 'ship:', G.meta.ship, 'cur:', G.currentShip().id);
  G.switchShip('explorer');
  console.log('switched back:', G.currentShip().id);
  run.scrap = 77; run.cargo = {hull_patch: 2};
  G.phase = 'death';
  G.endRun();
  console.log('after death: run.scrap=', run.scrap, 'run.cargo=', JSON.stringify(run.cargo), 'meta.scrap=', G.meta.scrap);
  // Station banking: does it double-bank now that pickups go straight to wallet?
  const BS = await import('./src/systems/BankingSystem.js');
  const bank = new BS.BankingSystem();
  G.resetRun(); G.phase='flight';
  const run2 = G.run;
  run2.scrap = 50;
  console.log('banking ok:', bank.tryBank({ position:{distanceTo:()=>0} }, G), 'meta.scrap after bank:', G.meta.scrap);
}).catch(e=>console.log('ERR', e.stack ? e.stack.split('\n').slice(0,4).join(' | ') : String(e)));
