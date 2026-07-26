import * as THREE from 'three';
import {
  GRID_COLS, GRID_ROWS, TILE_SIZE, START_TILE, END_TILE,
  COLORS, BUDGET, TOWER_DEFS, ENEMY_DEFS, WAVE,
} from './core/Constants.js';
import {
  EffectComposer, RenderPass, UnrealBloomPass, OutputPass,
} from 'three/addons/postprocessing/EffectComposer.js';

const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(COLORS.bg, 0.00035);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 400);
camera.position.set(GRID_COLS/2 - 18, 26, GRID_ROWS/2 + 18);
camera.lookAt(GRID_COLS/2, 0, GRID_ROWS/2);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.4, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  composer.setSize(w, h);
  bloom.setSize(w, h);
});

function makeDirLight() {
  const l = new THREE.DirectionalLight(0xaaccff, 1.7);
  l.position.set(12, 22, 6);
  scene.add(l);
}
function makeAmbient() {
  scene.add(new THREE.AmbientLight(0x223355, 1.4));
}
makeAmbient();
makeDirLight();

// Grid ground tiles
const ground = new THREE.Group();
scene.add(ground);
const tileGeo = new THREE.PlaneGeometry(1,1);
const tileMatOff = new THREE.MeshBasicMaterial({color:0x0b1220, transparent:true, opacity:0.35});
const tileMatDim = new THREE.MeshBasicMaterial({color:0x7df9ff, transparent:true, opacity:0.06, blending:THREE.AdditiveBlending});
for (let qx=0;qx<GRID_COLS;qx++) for (let qy=0;qy<GRID_ROWS;qy++) {
  const m = new THREE.Mesh(tileGeo, tileMatOff.clone());
  m.rotation.x = threeHalfPi;
  m.position.set(qx*TILE_SIZE+TILE_SIZE/2, 0, qy*TILE_SIZE+TILE_SIZE/2);
  ground.add(m);
}

// Path generation: straight corridor plus branches
const pathTiles = new Set();
const walkFrom = (qx,qy) => {
  const q=[{qx:START_TILE.qx,qy:START_TILE.qy}];
  const seen=new Set([START_TILE.qx+','+START_TILE.qy]);
  while(q.length){
    const c=q.shift();
    pathTiles.add(c.qx*GRID_ROWS+c.qy);
    if(c.qx===END_TILE.qx && c.qy===END_TILE.qy) break;
    const n=[[c.qx+1,c.qy],[c.qx-1,c.qy],[c.qx,c.qy+1],[c.qx,c.qy-1]];
    n.sort(()=>Math.random()-0.5);
    for(const [x,y] of n){
      if(x<0||x>=GRID_COLS||y<0||y>=GRID_ROWS)continue;
      const k=x+','+y; if(seen.has(k))continue; seen.add(k);
      if(Math.random()<0.85) q.push({qx:x,qy:y});
    }
  }
  for(let i=0;i<7;i++){
    const arr=Array.from(pathTiles);
    for(const t of arr){
      if(Math.random()>0.35)continue;
      const qx=t%GRID_COLS, qy=Math.floor(t/GRID_COLS);
      const n=[[qx+1,qy],[qx-1,qy],[qx,qy+1],[qx,qy-1]].filter(([x,y])=>x>=0&&x<GRID_COLS&&y>=0&&y<GRID_ROWS);
      const [bx,by]=n[Math.floor(Math.random()*n.length)];
      pathTiles.add(bx*GRID_ROWS+by);
    }
  }
};
walkFrom();
// Reconnect disconnected tiles
const queue=[START_TILE];const seen=new Set([encode(START_TILE)]);
while(queue.length){
  const c=queue.shift(); if(c.qx===END_TILE.qx && c.qy===END_TILE.qy)break;
  for(const [x,y] of [[c.qx+1,c.qy],[c.qx-1,c.qy],[c.qx,c.qy+1],[c.qx,c.qy-1]]){
    if(x<0||x>=GRID_COLS||y<0||y>=GRID_ROWS||!pathTiles.has(x*GRID_ROWS+y))continue;
    const k=x+','+y; if(seen.has(k))continue; seen.add(k); queue.push({qx:x,qy:y});
  }
}
if(!pathTiles.has(END_TILE.qx*GRID_ROWS+END_TILE.qy)){
  let cx=START_TILE.qx, cy=START_TILE.qy;
  while(!(cx===END_TILE.qx && cy===END_TILE.qy)){
    pathTiles.add(cx*GRID_ROWS+cy);
    if(Math.abs(cx-END_TILE.qx)>Math.abs(cy-END_TILE.qy)) cx+=Math.sign(END_TILE.qx-cx);
    else cy+=Math.sign(END_TILE.qy-cy);
  }
  pathTiles.add(END_TILE.qx*GRID_ROWS+END_TILE.qy);
}
function encode(t){return t.qx+','+t.qy;}

const pathline = [];
for (let qy=0;qy<GRID_ROWS;qy++) for (let qx=0;qx<GRID_COLS;qx++) if(pathTiles.has(qx*GRID_ROWS+qy)) pathline.push({qx,qy});
const ordered=[];
const parent=new Map();const visit=new Set([encode(START_TILE)]);
const bfs=[START_TILE];
while(bfs.length){const c=bfs.shift();ordered.push(c);if(c.qx===END_TILE.qx && c.qy===END_TILE.qy)break;[[c.qx+1,c.qy],[c.qx-1,c.qy],[c.qx,c.qy+1],[c.qx,c.qy-1]].forEach(([x,y])=>{if(x<0||x>=GRID_COLS||y<0||y>=GRID_ROWS||!pathTiles.has(x*GRID_ROWS+y)||visit.has(x+','+y))return;visit.add(x+','+y);parent.set(x+','+y,c);bfs.push({qx:x,qy:y});})}

// build path visuals
const ribbon = new THREE.Group();
scene.add(ribbon);
for (let i=0;i<ordered.length-1;i++){
  const a=ordered[i],b=ordered[i+1];
  const p1=new THREE.Vector3(a.qx*TILE_SIZE+TILE_SIZE/2,0.04,a.qy*TILE_SIZE+TILE_SIZE/2);
  const p2=new THREE.Vector3(b.qx*TILE_SIZE+TILE_SIZE/2,0.04,b.qy*TILE_SIZE+TILE_SIZE/2);
  const d=p2.clone().sub(p1); const len=d.length()||1;
  const n=new THREE.Vector3(-d.z/len,0,d.x/len).multiplyScalar(TILE_SIZE*0.5);
  const geo=new THREE.BufferGeometry().setFromPoints([p1.clone().sub(n),p2.clone().sub(n),p1.clone().add(n),p2.clone().add(n)]);
  const mat=new THREE.MeshBasicMaterial({color:new THREE.Color(COLORS.pathBase),transparent:true,opacity:0.92,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo,mat);
  ribbon.add(mesh);
  // segment markers for clicks
  const tileQuads=[];
}

const tileMeshParent=new THREE.Group(); scene.add(tileMeshParent);
for(const {qx,qy} of ordered){
  const m=new THREE.Mesh(tileGeo,new THREE.MeshBasicMaterial({color:COLORS.pathGlow,transparent:true,opacity:0.04,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  m.rotation.x=threeHalfPi; m.position.set(qx*TILE_SIZE+TILE_SIZE/2,0.03,qy*TILE_SIZE+TILE_SIZE/2); tileMeshParent.add(m);
}

const smokeGeo=new THREE.PlaneGeometry(GRID_COLS*TILE_SIZE*1.6,GRID_ROWS*TILE_SIZE*1.25,40,40);
const smokeMat=new THREE.ShaderMaterial({
 uniforms:{uTime:{value:0},uColor:{value:new THREE.Color(COLORS.smoke)}},
 transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
 vertexShader:`varying vec2 vUv; varying vec3 vWorld;
  void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
 fragmentShader:`varying vec2 vUv; varying vec3 vWorld;
  uniform float uTime; uniform vec3 uColor;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
  void main(){ float q=noise(vWorld.xz*0.12+uTime*0.07); float r=noise(vWorld.xz*0.16-uTime*0.05+4.3); float c=smoothstep(0.35,0.7,q)*smoothstep(0.55,0.2,r); gl_FragColor=vec4(uColor,c*0.2); }`
});
const smokeMesh=new THREE.Mesh(smokeGeo,smokeMat);
smokeMesh.rotation.x=Math.PI/2; smokeMesh.position.set(GRID_COLS*TILE_SIZE/2,0.55,GRID_ROWS*TILE_SIZE/2);
scene.add(smokeMesh);

// Game state
const state = {
  money: BUDGET.startMoney,
  lives: BUDGET.lives,
  wave: 0,
  paused: false,
  over: false,
  towerType: 0,
  buildPending: false,
  towers: [],
  enemies: [],
  projectiles: [],
  particles: [],
  stats: { towersBuilt:0, enemiesKilled:0, moneyEarned:0, wavesSurvived:0 },
};
const buildCooldown={v:0};

// helpers
const rand = (a,b)=>a+Math.random()*(b-a);
const spawnParticles=(pos,count,color)=>{
  for(let i=0;i<count;i++){
    const geo=new THREE.SphereGeometry(0.08,5,5);
    const mat=new THREE.MeshBasicMaterial({color:color||0xfff5c2,transparent:true});
    const m=new THREE.Mesh(geo,mat); m.position.copy(pos); scene.add(m);
    state.particles.push({mesh:m,life:0.6+Math.random()*0.3,vel:new THREE.Vector3().randomDirection().multiplyScalar(1+Math.random()*2)});
  }
};
const removeEnemy=(en)=>{
  const i=state.enemies.indexOf(en); if(i>=0){state.enemies.splice(i,1);scene.remove(en.mesh);en.mesh.geometry.dispose();en.mesh.material.dispose();}
};
const applyDamage=(enemy,dmg)=>{
  const def=ENEMY_DEFS[enemy.defIdx];
  let d=dmg;
  if(def.armor) d*=(1-def.armor);
  if(def.shieldPercent && enemy.hp/enemy.maxHp>def.shieldPercent) d*=0.3;
  enemy.hp-=d;
  if(enemy.hp<=0){
    const reward=Math.max(1,state.wave)*def.reward;
    state.money += reward;
    state.stats.moneyEarned += reward;
    state.stats.enemiesKilled += 1;
    spawnParticles(enemy.mesh.position,14,new THREE.Color(def.color));
    if(def.split){
      for(let i=0;i<2;i++){
        const childDef=ENEMY_DEFS[Math.min(enemy.defIdx,6)];
        const geo=new THREE.IcosahedronGeometry(childDef.scale*0.9,1);
        const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(childDef.color),emissive:new THREE.Color(childDef.color),emissiveIntensity:1.2,roughness:0.35,metalness:0.55});
        const m=new THREE.Mesh(geo,mat); m.position.copy(enemy.mesh.position); scene.add(m);
        const child={defIdx:Math.min(enemy.defIdx,6),hp:childDef.hp*0.6,maxHp:childDef.hp*0.6,speed:enemy.speed*1.1,mesh:m,pathIndex:Math.max(0,enemy.pathIndex-1),slowUntil:0,dead:false};
        scene.add(m); state.enemies.push(child);
      }
    }
    removeEnemy(enemy);
  } else spawnParticles(enemy.mesh.position,4);
};

const threeHalfPi = Math.PI/2;

// towers
const placeTower=(qx,qy,defIdx)=>{
  const def=TOWER_DEFS[defIdx];
  if(state.money<def.cost) return false;
  const idx=qx*GRID_ROWS+qy; if(!pathTiles.has(idx)) return false;
  state.money-=def.cost; state.stats.towersBuilt+=1;
  const pos=new THREE.Vector3(qx*TILE_SIZE+TILE_SIZE/2,0.18,qy*TILE_SIZE+TILE_SIZE/2);
  const geo=new THREE.CylinderGeometry(0.22,0.3,0.6,8);
  const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(def.color),emissive:new THREE.Color(def.color),emissiveIntensity:1.5,roughness:0.4,metalness:0.6});
  const m=new THREE.Mesh(geo,mat); m.position.copy(pos); scene.add(m);
  state.towers.push({defIdx,level:0,totalInvested:def.cost,mesh:m,pos,range:def.range,damage:def.damage,rate:def.rate,cooldown:0,qx,qy,idx});
  updateHud(); return true;
};
const upgradeTower=(idx)=>{
  const t=state.towers.find(x=>x.idx===idx); if(!t||t.level>=3)return;
  const def=TOWER_DEFS[t.defIdx]; const cost=Math.floor(def.cost*(0.9+0.55*t.level));
  if(state.money<cost)return; state.money-=cost; t.level+=1; t.totalInvested+=cost;
  t.damage*=(1+0.35); t.range*=(1+0.12); t.rate*=(1-0.08);
  t.mesh.material.emissiveIntensity=1.2+t.level*0.8;
  updateHud();
};
const sellTower=(idx)=>{
  const i=state.towers.findIndex(x=>x.idx===idx); if(i<0)return;
  const t=state.towers[i]; state.money+=Math.floor(t.totalInvested*BUDGET.sellBackRatio);
  scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); state.towers.splice(i,1);
  updateHud();
};
const towerFire=(dt)=>{
  state.towers.forEach(t=>{
    t.cooldown-=dt;
    if(t.cooldown>0)return;
    const def=TOWER_DEFS[t.defIdx];
    const target=state.enemies.find(e=>!e.dead && e.mesh.position.distanceTo(t.pos)<=t.range);
    if(!target)return;
    t.cooldown=t.rate;
    if(def.beam){
      const lineGeo=new THREE.BufferGeometry().setFromPoints([t.pos.clone(), target.mesh.position.clone()]);
      const lineMat=new THREE.LineBasicMaterial({color:COLORS.towerEmissive,transparent:true,opacity:0.85});
      const line = new THREE.Line(lineGeo,lineMat); scene.add(line); setTimeout(()=>{ scene.remove(line); line.geometry.dispose(); line.material.dispose(); },120);
      applyDamage(target, t.damage);
    } else {
      const dir=target.mesh.position.clone().sub(t.pos).normalize();
      const pGeo=new THREE.SphereGeometry(0.09,6,6);
      const pMat=new THREE.MeshBasicMaterial({color:new THREE.Color(def.color)});
      const mesh=new THREE.Mesh(pGeo,pMat); mesh.position.copy(t.pos); scene.add(mesh);
      state.projectiles.push({mesh,dir,speed:def.projSpeed||10,damage:t.damage,splash:def.splash||0,life:3.5});
    }
  });
};
const updateProjectiles=(dt)=>{
  for(let i=state.projectiles.length-1;i>=0;i--){
    const p=state.projectiles[i]; p.mesh.position.addScaledVector(p.dir,p.speed*dt);
    p.life-=dt; let hit=false;
    for(const e of state.enemies){
      if(e.dead)continue; if(p.mesh.position.distanceTo(e.mesh.position)<=0.75){
        applyDamage(e,p.damage); hit=true; break;
      }
    }
    if(hit||p.life<=0){ scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); state.projectiles.splice(i,1); }
  }
};
const updateParticles=(dt)=>{
  for(let i=state.particles.length-1;i>=0;i--){
    const p=state.particles[i]; p.life-=dt;
    if(p.life<=0){ scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); state.particles.splice(i,1);continue;}
    p.mesh.position.addScaledVector(p.vel,dt); p.mesh.scale.setScalar(Math.max(0,p.life)*2); p.vel.y-=dt*1.6;
  }
};

// enemies move along ordered path waypoints
const orderedWaypoints=ordered.map(p=>new THREE.Vector3(p.qx*TILE_SIZE+TILE_SIZE/2,0,p.qy*TILE_SIZE+TILE_SIZE/2));
const spawnWave=(queue)=>{
  queue.forEach(item=>{
    const def=ENEMY_DEFS[item.defIdx];
    const geo=new THREE.IcosahedronGeometry(def.scale*0.9,1);
    const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(def.color),emissive:new THREE.Color(def.color),emissiveIntensity:1.2,roughness:0.35,metalness:0.55});
    const m=new THREE.Mesh(geo,mat); m.position.copy(orderedWaypoints[0]); scene.add(m);
    state.enemies.push({defIdx:item.defIdx,hp:def.hp,maxHp:def.hp,speed:def.speed,mesh:m,pathIndex:0,slowUntil:0,dead:false});
  });
};
const updateEnemies=(dt)=>{
  state.enemies.forEach(en=>{
    if(en.dead)return;
    if(ENEMY_DEFS[en.defIdx].stationary)return;
    const pace=en.slowUntil>Date.now()?en.speed*0.55:en.speed;
    const accum=pace*dt;
    let idx=en.pathIndex;
    let wp=orderedWaypoints[idx];
    if(!wp){ idx=orderedWaypoints.length-1; wp=orderedWaypoints[idx]; }
    const dx=wp.x-en.mesh.position.x, dz=wp.z-en.mesh.position.z;
    const dist=Math.hypot(dx,dz)||0.0001;
    if(dist<=accum){
      const rem=accum-dist; idx+=1;
      if(idx>=orderedWaypoints.length-1){
        state.lives-=1; spawnParticles(en.mesh.position,6,0xff3300); removeEnemy(en);
        if(state.lives<=0){state.over=true;}
        return;
      }
    } else {
      en.mesh.position.x+=(dx/dist)*accum; en.mesh.position.z+=(dz/dist)*accum;
    }
    en.pathIndex=idx;
    en.mesh.rotation.y+=dt*3;
  });
};
const queueNextWave=()=>{
  if(state.over||state.paused)return;
  state.wave+=1;
  const count=Math.floor(WAVE.mobsBase + WAVE.mobsGrow*state.wave);
  const q=[]; const unlocked=Math.min(7,1+Math.floor(state.wave/2));
  for(let i=0;i<count;i++) q.push({type:'mob',defIdx:Math.min(i%unlocked,6)});
  if(state.wave>1 && state.wave%WAVE.bossEvery===0){
    const bossIdx=7+((state.wave/WAVE.bossEvery -1)%3); q.push({type:'boss',defIdx:bossIdx});
  }
  spawnWave(q);
  state.money += BUDGET.waveBonus;
  state.stats.wavesSurvived += 1;
  if(state.wave%10===0) state.money+=80;
  updateHud();
};

// HUD
const moneyEl=document.createElement('div'); moneyEl.className='hud'; moneyEl.innerHTML='<div class="hud-row"><span id="hud-money">$'+BUDGET.startMoney+'</span><span id="hud-wave">Wave 0</span><span id="hud-lives">Lives '+BUDGET.lives+'</span></div><div id="tw"></div>';
document.getElementById('hud').appendChild(moneyEl);
const tw=document.getElementById('tw');
const updateHud=()=>{
  document.getElementById('hud-money').textContent='$'+state.money;
  document.getElementById('hud-wave').textContent='Wave '+state.wave;
  document.getElementById('hud-lives').textContent='Lives '+state.lives;
  tw.innerHTML='';
  TOWER_DEFS.forEach((t,i)=>{
    const b=document.createElement('button'); b.className='tower-btn'; b.textContent=i+1+' '+t.name+' ($'+t.cost+')'; b.disabled=state.money<t.cost;
    b.onclick=()=>{state.towerType=i;state.buildPending=true;};
    tw.appendChild(b);
  });
  const wb=document.createElement('button'); wb.className='wave-btn'; wb.textContent='Start Wave'; wb.onclick=queueNextWave; tw.appendChild(wb);
};
updateHud();

const ctxMenu=document.getElementById('contextMenu');
const openCtx=(x,y,items)=>{
  ctxMenu.innerHTML='';
  items.forEach(it=>{const row=document.createElement('button'); row.className='cm-row'; row.textContent=it.label; row.onclick=()=>{it.action();ctxMenu.classList.add('hidden');ctxMenu.innerHTML='';}; ctxMenu.appendChild(row);});
  ctxMenu.style.left=x+'px'; ctxMenu.style.top=y+'px'; ctxMenu.classList.remove('hidden');
};

// Raycaster
const raycaster=new THREE.Raycaster();

const onClick=(e)=>{
  if(!state.buildPending)return;
  const rect=canvas.getBoundingClientRect();
  const mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(tileMeshParent.children,false);
  if(!hits.length)return;
  const pt=hits[0].point;
  const qx=Math.floor((pt.x+TILE_SIZE/2)/TILE_SIZE), qy=Math.floor((pt.z+TILE_SIZE/2)/TILE_SIZE);
  if(qx<0||qx>=GRID_COLS||qy<0||qy>=GRID_ROWS)return;
  const idx=qx*GRID_ROWS+qy;
  if(placeTower(qx,qy,state.towerType)) state.buildPending=false;
};
const onContext=(e)=>{
  e.preventDefault();
  if(state.over)return;
  const rect=canvas.getBoundingClientRect();
  const mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(tileMeshParent.children,false);
  if(!hits.length)return;
  const pt=hits[0].point;
  const qx=Math.floor((pt.x+TILE_SIZE/2)/TILE_SIZE), qy=Math.floor((pt.z+TILE_SIZE/2)/TILE_SIZE);
  if(qx<0||qx>=GRID_COLS||qy<0||qy>=GRID_ROWS)return;
  const idx=qx*GRID_ROWS+qy;
  const tIdx=state.towers.findIndex(t=>t.idx===idx);
  if(tIdx>=0){
    const t=state.towers[tIdx]; const def=TOWER_DEFS[t.defIdx];
    openCtx(e.clientX,e.clientY,[
      {label:'Upgrade to lvl '+ (t.level+1)+' ($'+Math.floor(def.cost*(0.9+0.55*t.level))+')', action:()=>upgradeTower(t.idx)},
      {label:'Sell (+$'+Math.floor(t.totalInvested*BUDGET.sellBackRatio)+')', action:()=>sellTower(t.idx)}
    ]);
  } else openCtx(e.clientX,e.clientY,[{label:'Cancel',action:()=>{}}]);
};
canvas.addEventListener('mousedown', onClick);
canvas.addEventListener('contextmenu', onContext);

const pauseOverlay=document.getElementById('pauseOverlay');
const showPause=()=>{pauseOverlay.innerHTML=`<div class="panel"><h2>PAUSED</h2><div>Money: $${state.money}</div><div>Wave: ${state.wave}</div><div>Lives: ${state.lives}</div><div class="small">Press SPACE to resume</div></div>`;pauseOverlay.classList.remove('hidden');};
const hidePause=()=>{pauseOverlay.innerHTML='';pauseOverlay.classList.add('hidden');};
const deathOverlay=document.getElementById('deathOverlay');
const showDeath=()=>{deathOverlay.innerHTML='<div class=\"panel\"><h2>GAME OVER</h2><div>Reached Wave '+state.wave+'</div></div>';deathOverlay.classList.remove('hidden');};

window.addEventListener('keydown',(e)=>{
  if(e.code==='Space'){e.preventDefault(); state.paused=!state.paused; state.paused?showPause():hidePause();}
  if(e.code==='KeyR' && state.over){location.reload();}
});

const clock=new THREE.Clock();
function loop(){
  requestAnimationFrame(loop);
  const dt=Math.min(clock.getDelta(),0.1);
  if(!state.paused && !state.over){
    towerFire(dt);
    updateProjectiles(dt);
    updateEnemies(dt);
    updateParticles(dt);
    if(state.buildCooldown>0) state.buildCooldown-=dt;
    if(state.over) showDeath();
  }
  smokeMesh.material.uniforms.uTime.value += dt;
  composer.render(dt);
}
loop();
queueNextWave();
window._psGame={togglePause(){state.paused=!state.paused;state.paused?showPause():hidePause();},restart(){location.reload();}};
