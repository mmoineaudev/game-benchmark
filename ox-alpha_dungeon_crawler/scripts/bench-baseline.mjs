// bench-baseline.mjs — pure rAF cadence on about:blank, no game code.
// Establishes what this machine + headless SwiftShader can do with ZERO load from the game.
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';

const chrome = spawn('/usr/bin/chromium-browser', ['--remote-debugging-port=9226','--headless=new','--no-sandbox','--user-data-dir=/tmp/cdpbench','--use-gl=angle','--use-angle=swiftshader','--window-size=1280,800','about:blank'], {stdio:'ignore'});
await new Promise(r=>setTimeout(r,2500));
const list = await (await fetch('http://127.0.0.1:9226/json/list')).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j);});
let id=0; const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});

const expr = "new Promise(res => { const f=[]; const tick=()=>{f.push(performance.now()); if(f.length<120) requestAnimationFrame(tick); else { let sum=0,max=0; for(let i=1;i<f.length;i++){const d=f[i]-f[i-1]; sum+=d; if(d>max)max=d;} res(JSON.stringify({frames:f.length, avgFps:+(1000/(sum/(f.length-1))).toFixed(1), maxHitch:+max.toFixed(0)})); } }; requestAnimationFrame(tick); })";
const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
console.log('baseline (about:blank, no game):', r.result?.result?.value);
chrome.kill(); process.exit(0);
