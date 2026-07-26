import EventBus from '../core/EventBus.js';
import ParticleSystem from './ParticleSystem.js';
import ModelFactory from './ModelFactory.js';

export default class CollisionSystem {
  constructor() { this._vfx = null; }
  reset() {}
  update(dt, state, projectiles, enemies, towers, particles) {
    for (let i = projectiles.objs.length - 1; i >= 0; i--) {
      const p = projectiles.objs[i];
      const pos = p.mesh.position;
      let hit = false;
      let hitEnemy = null;
      for (const e of enemies.enemies) {
        if (e.dead) continue;
        if (pos.distanceTo(e.mesh.position) <= 0.7) {
          this._hit(state, enemies, e, p, particles);
          hit = true;
          hitEnemy = e;
          break;
        }
      }
      // Pierce: pass through first enemy, keep projectile alive to hit more
      if (hit && p.pierce) {
        p._pierced = (p._pierced || 0) + 1;
        p.mesh.position.addScaledVector(p.dir, 0.8); // push past the hit enemy
        if (p._pierced >= 6) projectiles._remove(p); // limit pierce count
      } else if (hit) {
        projectiles._remove(p);
      }
    }
    // beam tick
    projectiles._beams.forEach(b => {
      if (b.apply) {
        enemies.enemies.forEach(e => { if (!e.dead && b.to.distanceTo(e.mesh.position) <= 0.8) b.apply(e); });
      }
    });
    // boss tower damage
    towers.towers.forEach(t => {
      if (!t.tags?.pierceTower) return;
      enemies.enemies.forEach(e => { if (!e.dead && Math.abs(e.mesh.position.x - t.pos.x)+Math.abs(e.mesh.position.z - t.pos.z) < 0.85) e.hp -= t.damage * dt; });
    });
  }
  _hit(state, enemies, enemy, projectile, particles) {
    let dmg = projectile.damage;
    if (enemy.tags.armor) dmg *= (1 - enemy.tags.armor);
    if (enemy.tags.shieldPercent && enemy.hp / enemy.maxHp > enemy.tags.shieldPercent) dmg *= 0.3;
    enemy.hp -= dmg;
    // Hit flash
    ModelFactory.flashEnemy(enemy.mesh);
    if (projectile.splash) {
      const center = enemy.mesh.position;
      enemies.enemies.forEach(e => { if (!e.dead && e !== enemy) {
        if (e.mesh.position.distanceTo(center) <= projectile.splash) { e.hp -= dmg * 0.65; ModelFactory.flashEnemy(e.mesh); }
      }});
      particles.explosion(center, 18, projectile.splash);
    }
    if (projectile.slow) enemy.slowUntil = performance.now() + 4000 * projectile.slow;
    if (projectile.corrode && enemy.tags.armor) {
      enemy.tags.armor = Math.max(0, enemy.tags.armor - projectile.corrode);
      enemy._armorReduced = true;
    }
    if (projectile.dot) particles.explosion(enemy.mesh.position, 6, 0.3);
    if (projectile.gravity) particles.explosion(enemy.mesh.position, 8, projectile.splash);
    particles.spark(enemy.mesh.position);
    if (enemy.hp <= 0) enemies.kill(enemy, state);
  }
}
