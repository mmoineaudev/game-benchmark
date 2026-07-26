import * as THREE from 'three';

export default class StarfieldSystem {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this._create();
  }

  _create() {
    // ── Starfield plane — flat layer of stars slowly drifting ───────────
    const starCount = 2500;
    const spread = 180;  // how far stars spread beyond the grid
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * spread * 2;
      positions[i3 + 1] = -2 - Math.random() * 8;  // below the grid
      positions[i3 + 2] = (Math.random() - 0.5) * spread * 2;

      // Color: mostly white/blue with occasional warm tones
      const t = Math.random();
      if (t < 0.55) {
        colors[i3] = 0.8 + Math.random() * 0.2; colors[i3 + 1] = 0.85 + Math.random() * 0.15; colors[i3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (t < 0.75) {
        colors[i3] = 0.6 + Math.random() * 0.3; colors[i3 + 1] = 0.65 + Math.random() * 0.25; colors[i3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (t < 0.88) {
        colors[i3] = 0.9 + Math.random() * 0.1; colors[i3 + 1] = 0.75 + Math.random() * 0.2; colors[i3 + 2] = 0.5 + Math.random() * 0.3;
      } else if (t < 0.95) {
        colors[i3] = 0.7 + Math.random() * 0.25; colors[i3 + 1] = 0.5 + Math.random() * 0.2; colors[i3 + 2] = 0.8 + Math.random() * 0.2;
      } else {
        colors[i3] = 0.55 + Math.random() * 0.3; colors[i3 + 1] = 0.8 + Math.random() * 0.2; colors[i3 + 2] = 0.7 + Math.random() * 0.25;
      }

      // Most stars tiny, occasional bright
      sizes[i] = Math.random() < 0.92 ? 0.6 + Math.random() * 1.2 : 2.5 + Math.random() * 4;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const starMat = new THREE.PointsMaterial({
      size: 1.0, vertexColors: true, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false,
    });
    this._stars = new THREE.Points(starGeo, starMat);
    this.scene.add(this._stars);

    // ── Soft nebula glow patches ────────────────────────────────────────
    this._nebulaPatches = [];
    const nebulaColors = [0x332244, 0x442244, 0x223344, 0x442233, 0x334422, 0x223355];
    for (let n = 0; n < 6; n++) {
      const size = 30 + Math.random() * 50;
      const geo = new THREE.PlaneGeometry(size, size);
      const color = new THREE.Color(nebulaColors[n]);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color }, uTime: { value: 0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vUv;uniform vec3 uColor;uniform float uTime;
          void main(){
            float d=length(vUv-0.5)*2.0;
            float a=smoothstep(1.0,0.0,d)*0.18;
            a*=0.8+0.2*sin(vUv.x*4.0+uTime*0.08)*cos(vUv.y*3.5-uTime*0.06);
            gl_FragColor=vec4(uColor,a);
          }`,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set((Math.random()-0.5)*spread, -3-Math.random()*3, (Math.random()-0.5)*spread);
      plane.rotation.x = -Math.PI/2;
      this.scene.add(plane);
      this._nebulaPatches.push({ mesh: plane, driftX: (Math.random()-0.5)*0.8, driftZ: (Math.random()-0.5)*0.8 });
    }

    // ── Few bright distant stars with twinkle ───────────────────────────
    const brightCount = 40;
    const bPos = new Float32Array(brightCount * 3);
    const bCol = new Float32Array(brightCount * 3);
    for (let i = 0; i < brightCount; i++) {
      const i3 = i * 3;
      bPos[i3] = (Math.random() - 0.5) * spread * 1.5;
      bPos[i3 + 1] = -4 - Math.random() * 6;
      bPos[i3 + 2] = (Math.random() - 0.5) * spread * 1.5;
      const hue = Math.random();
      if (hue < 0.4)      { bCol[i3]=0.6+Math.random()*0.3; bCol[i3+1]=0.7+Math.random()*0.25; bCol[i3+2]=0.95+Math.random()*0.05; }
      else if (hue < 0.65) { bCol[i3]=0.9+Math.random()*0.1; bCol[i3+1]=0.55+Math.random()*0.3; bCol[i3+2]=0.35+Math.random()*0.3; }
      else                 { bCol[i3]=0.8+Math.random()*0.2; bCol[i3+1]=0.5+Math.random()*0.2; bCol[i3+2]=0.75+Math.random()*0.25; }
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    const bMat = new THREE.PointsMaterial({
      size: 2.5, vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false,
    });
    this._brightStars = new THREE.Points(bGeo, bMat);
    this.scene.add(this._brightStars);
  }

  update(dt) {
    this.time += dt;

    // Gentle drift — stars slowly scroll
    const driftX = dt * 1.5;
    const driftZ = dt * 1.0;
    this._stars.position.x -= driftX;
    this._stars.position.z -= driftZ;
    // Wrap around
    const wrap = 180;
    if (Math.abs(this._stars.position.x) > wrap) this._stars.position.x += Math.sign(this._stars.position.x) * -wrap * 2;
    if (Math.abs(this._stars.position.z) > wrap) this._stars.position.z += Math.sign(this._stars.position.z) * -wrap * 2;

    // Nebula patches drift with parallax
    for (const nb of this._nebulaPatches) {
      nb.mesh.position.x += nb.driftX * dt;
      nb.mesh.position.z += nb.driftZ * dt;
      if (Math.abs(nb.mesh.position.x) > 100) nb.driftX *= -1;
      if (Math.abs(nb.mesh.position.z) > 100) nb.driftZ *= -1;
      if (nb.mesh.material.uniforms) nb.mesh.material.uniforms.uTime.value = this.time;
    }

    // Bright stars drift + twinkle
    this._brightStars.position.x -= driftX * 0.7;
    this._brightStars.position.z -= driftZ * 0.7;
    if (Math.abs(this._brightStars.position.x) > wrap * 1.2) this._brightStars.position.x += Math.sign(this._brightStars.position.x) * -wrap * 2;
    if (Math.abs(this._brightStars.position.z) > wrap * 1.2) this._brightStars.position.z += Math.sign(this._brightStars.position.z) * -wrap * 2;
    this._brightStars.material.opacity = 0.5 + Math.sin(this.time * 0.6) * 0.2;
  }

  dispose() {
    if (this._stars) { this.scene.remove(this._stars); this._stars.geometry.dispose(); this._stars.material.dispose(); }
    if (this._brightStars) { this.scene.remove(this._brightStars); this._brightStars.geometry.dispose(); this._brightStars.material.dispose(); }
    for (const nb of this._nebulaPatches) {
      this.scene.remove(nb.mesh); nb.mesh.geometry.dispose(); nb.mesh.material.dispose();
    }
    this._nebulaPatches = [];
    this._stars = this._brightStars = null;
  }
}