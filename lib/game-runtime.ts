import type { GameConfig } from "@/lib/types";

export const GAME_RUNTIME_VERSION = "runtime-v2";
export const FROZEN_GAME_DOCUMENT_VERSION = "pons-frozen-runtime-v2";
export const FROZEN_GAME_DOCUMENT_NONCE = "cG9ucy1mcm96ZW4tcnVudGltZS12Mg==";

/**
 * Frozen game documents deliberately use a stable nonce and document identity.
 * The generated HTML is an immutable artifact, so the nonce does not need to
 * vary per request. Keeping it stable lets preview, storage, and embed delivery
 * use the exact same bytes. Run scoring is bound to the server-side game version
 * through run_sessions; it never trusts the document's postMessage versionId.
 */
export function gameDocumentContentSecurityPolicy(nonce = FROZEN_GAME_DOCUMENT_NONCE) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src data:; media-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
}

export function gameTemplateVersion(config: GameConfig) {
  return `${config.category.toLowerCase()}-v2`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function buildGameDocument(config: GameConfig, options?: { nonce?: string; versionId?: string }) {
  const nonce = options?.nonce || FROZEN_GAME_DOCUMENT_NONCE;
  const versionId = options?.versionId || FROZEN_GAME_DOCUMENT_VERSION;
  const runtime = String.raw`
(() => {
  "use strict";
  const cfg = JSON.parse(document.getElementById("game-config").textContent);
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreEl = document.getElementById("score");
  const statusEl = document.getElementById("status");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayCopy = document.getElementById("overlay-copy");
  const W = 960, H = 540;
  let running = false, paused = false, ended = false, muted = false, startedAt = 0, last = 0, score = 0, elapsed = 0;
  let seed = cfg.seed >>> 0;
  let eventLog = [];
  const keys = new Set();
  const difficulty = cfg.difficulty === "HARD" ? 1.22 : cfg.difficulty === "EASY" ? .84 : 1;
  const pace = cfg.speed * difficulty;
  const state = {};
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const now = () => Math.round(elapsed);
  const logInput = (type, data={}) => { if (running && eventLog.length < 1800) eventLog.push({ t: now(), type, ...data }); };
  const send = (type, payload={}) => parent.postMessage({ source:"pons-game", version:1, type, payload:{ versionId:${safeJson(versionId)}, ...payload } }, "*");
  const tone = (freq=420, duration=.05) => {
    if (muted || cfg.soundStyle === "silent") return;
    try { const ac = window.__ac || (window.__ac = new AudioContext()); const o=ac.createOscillator(), g=ac.createGain(); o.frequency.value=freq; g.gain.value=.025; o.connect(g); g.connect(ac.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration); o.stop(ac.currentTime+duration); } catch {}
  };
  function resize(){ const r=canvas.getBoundingClientRect(); const d=Math.min(devicePixelRatio||1,2); canvas.width=Math.round(r.width*d); canvas.height=Math.round(r.height*d); ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0); }
  addEventListener("resize", resize); resize();
  function bg(t){
    ctx.fillStyle=cfg.palette.background; ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=.12; ctx.strokeStyle=cfg.palette.primary; ctx.lineWidth=1;
    const off=(t*.04)%48; for(let x=-48+off;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-140,H);ctx.stroke();}
    for(let y=50;y<H;y+=72){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.globalAlpha=1;
  }
  function pill(x,y,w,h,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(w,h)/2);ctx.fill();}
  function label(text,x,y,size=18,align="left"){ctx.fillStyle=cfg.palette.text;ctx.font="700 "+size+"px ui-sans-serif,system-ui";ctx.textAlign=align;ctx.fillText(text,x,y);}
  function initRunner(){ Object.assign(state,{ y:418, vy:0, obstacles:[], coins:[], spawn:0, coinSpawn:500, distance:0, bonus:0 }); }
  function runnerInput(){ if(state.y>=417){state.vy=-650; tone(540); logInput("jump");} }
  function runner(dt,t){
    state.spawn-=dt; state.coinSpawn-=dt; state.distance+=dt*pace;
    if(state.spawn<=0){state.obstacles.push({x:1000,w:32+rnd()*42,h:44+rnd()*75});state.spawn=(850+rnd()*900)/pace;}
    if(state.coinSpawn<=0){state.coins.push({x:1000,y:280+rnd()*120});state.coinSpawn=(550+rnd()*750)/pace;}
    state.vy+=1800*dt/1000; state.y+=state.vy*dt/1000; if(state.y>418){state.y=418;state.vy=0;}
    state.obstacles.forEach(o=>o.x-=420*pace*dt/1000); state.coins.forEach(c=>c.x-=420*pace*dt/1000);
    for(const o of state.obstacles){if(o.x<150&&o.x+o.w>105&&state.y+46>468-o.h) return finish();}
    state.coins=state.coins.filter(c=>{const hit=Math.abs(c.x-128)<30&&Math.abs(c.y-state.y)<42;if(hit){state.bonus+=25;logInput("collect");tone(800);return false;}return c.x>-50;});
    state.obstacles=state.obstacles.filter(o=>o.x>-100); score=Math.floor(state.distance/10)+state.bonus;
    bg(t); ctx.fillStyle=cfg.palette.primary; ctx.fillRect(0,468,W,72); ctx.globalAlpha=.16;ctx.fillStyle="#000";for(let x=0;x<W;x+=64)ctx.fillRect(x,474,32,66);ctx.globalAlpha=1;
    state.coins.forEach(c=>{ctx.strokeStyle=cfg.palette.accent;ctx.lineWidth=6;ctx.beginPath();ctx.arc(c.x,c.y,12,0,Math.PI*2);ctx.stroke();});
    state.obstacles.forEach(o=>{pill(o.x,468-o.h,o.w,o.h,cfg.palette.danger);ctx.globalAlpha=.3;ctx.fillStyle="#fff";ctx.fillRect(o.x+7,478-o.h,o.w-14,5);ctx.globalAlpha=1;});
    pill(104,state.y,48,50,cfg.palette.primary);ctx.fillStyle=cfg.palette.background;ctx.fillRect(136,state.y+12,6,6);pill(95,state.y+34,66,12,cfg.palette.primary);
  }
  function initFlappy(){Object.assign(state,{y:260,vy:0,pipes:[],spawn:0});}
  function flappyInput(){state.vy=-450*pace;tone(620);logInput("flap");}
  function flappy(dt,t){
    state.spawn-=dt;if(state.spawn<=0){state.pipes.push({x:1040,gap:170-rnd()*25,y:120+rnd()*220,passed:false});state.spawn=(1300+rnd()*350)/pace;}
    state.vy+=1250*dt/1000;state.y+=state.vy*dt/1000;state.pipes.forEach(p=>p.x-=330*pace*dt/1000);
    if(state.y<0||state.y>H) return finish();
    for(const p of state.pipes){if(!p.passed&&p.x<170){p.passed=true;score+=100;logInput("gate");tone(760);}if(p.x<205&&p.x+80>125&&(state.y-20<p.y-p.gap/2||state.y+20>p.y+p.gap/2))return finish();}
    state.pipes=state.pipes.filter(p=>p.x>-100);bg(t);
    state.pipes.forEach(p=>{pill(p.x,0,80,p.y-p.gap/2,cfg.palette.primary);pill(p.x,p.y+p.gap/2,80,H,cfg.palette.primary);});
    ctx.fillStyle=cfg.palette.accent;ctx.beginPath();ctx.arc(160,state.y,24,0,Math.PI*2);ctx.fill();ctx.fillStyle=cfg.palette.background;ctx.beginPath();ctx.arc(169,state.y-7,5,0,Math.PI*2);ctx.fill();
  }
  function initShooter(){Object.assign(state,{x:480,y:420,bullets:[],enemies:[],spawn:0,touchTarget:null,movePointer:null,hits:0,survival:0});}
  function shooterInput(x,y){const a=Math.atan2(y-state.y,x-state.x);state.bullets.push({x:state.x,y:state.y,vx:Math.cos(a)*700,vy:Math.sin(a)*700});tone(710,.03);logInput("fire",{x:Math.round(x),y:Math.round(y)});}
  function shooter(dt,t){
    const d=360*pace*dt/1000;if(keys.has("arrowleft")||keys.has("a"))state.x-=d;if(keys.has("arrowright")||keys.has("d"))state.x+=d;if(keys.has("arrowup")||keys.has("w"))state.y-=d;if(keys.has("arrowdown")||keys.has("s"))state.y+=d;if(state.touchTarget){const dx=state.touchTarget.x-state.x,dy=state.touchTarget.y-state.y,dist=Math.hypot(dx,dy);if(dist>5){state.x+=dx/dist*Math.min(d,dist);state.y+=dy/dist*Math.min(d,dist);}}state.x=clamp(state.x,30,W-30);state.y=clamp(state.y,40,H-30);
    state.spawn-=dt;if(state.spawn<=0){state.enemies.push({x:40+rnd()*(W-80),y:-30,r:18+rnd()*16,hp:1});state.spawn=(460+rnd()*460)/pace;}
    state.bullets.forEach(b=>{b.x+=b.vx*dt/1000;b.y+=b.vy*dt/1000;});state.enemies.forEach(e=>{const a=Math.atan2(state.y-e.y,state.x-e.x);e.x+=Math.cos(a)*95*pace*dt/1000;e.y+=Math.sin(a)*95*pace*dt/1000;if(Math.hypot(e.x-state.x,e.y-state.y)<e.r+20)finish();});
    for(const b of state.bullets)for(const e of state.enemies)if(e.hp&&Math.hypot(e.x-b.x,e.y-b.y)<e.r+5){e.hp=0;b.y=-999;state.hits+=1;logInput("hit");tone(880,.025);}
    state.bullets=state.bullets.filter(b=>b.y>-50&&b.y<H+50&&b.x>-50&&b.x<W+50);state.enemies=state.enemies.filter(e=>e.hp&&e.y<H+80);state.survival+=dt*8/1000;score=Math.floor(state.survival)+state.hits*50;
    bg(t);state.bullets.forEach(b=>pill(b.x-3,b.y-10,6,20,cfg.palette.accent));state.enemies.forEach(e=>{ctx.strokeStyle=cfg.palette.danger;ctx.lineWidth=7;ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,Math.PI*2);ctx.stroke();});ctx.save();ctx.translate(state.x,state.y);ctx.fillStyle=cfg.palette.primary;ctx.beginPath();ctx.moveTo(0,-24);ctx.lineTo(19,19);ctx.lineTo(0,10);ctx.lineTo(-19,19);ctx.closePath();ctx.fill();ctx.restore();
  }
  function init(){seed=cfg.seed>>>0;score=0;elapsed=0;eventLog=[];startedAt=performance.now();last=startedAt;ended=false;paused=false;scoreEl.textContent="0";statusEl.textContent="Ready";if(cfg.category==="RUNNER")initRunner();else if(cfg.category==="FLAPPY")initFlappy();else initShooter();}
  function start(){if(ended)init();if(!running){running=true;paused=false;overlay.hidden=true;statusEl.textContent="Live";startedAt=performance.now();last=startedAt;send("game_start",{seed:cfg.seed});requestAnimationFrame(loop);}}
  function finish(){if(ended)return;ended=true;running=false;const duration=Math.max(1,Math.round(elapsed));statusEl.textContent="Finished";overlay.hidden=false;overlayTitle.textContent=cfg.title+" · "+score;overlayCopy.textContent="Run saved for validation. Tap to try again.";tone(170,.18);send("game_over",{score,durationMs:duration,metric:cfg.category==="FLAPPY"?"gates":"score",events:eventLog.slice(0,1800)});}
  function loop(t){if(!running||ended)return;const dt=Math.min(32,t-last);last=t;if(!paused){elapsed+=dt;if(cfg.category==="RUNNER")runner(dt,t);else if(cfg.category==="FLAPPY")flappy(dt,t);else shooter(dt,t);scoreEl.textContent=String(score);}requestAnimationFrame(loop);}
  function primary(x=W/2,y=H/2){if(!running){start();return;}if(paused||ended)return;if(cfg.category==="RUNNER")runnerInput();else if(cfg.category==="FLAPPY")flappyInput();else shooterInput(x,y);}
  function pointerPosition(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H};}
  canvas.addEventListener("pointerdown",e=>{const p=pointerPosition(e);if(!running){start();return;}if(cfg.category==="SHOOTER"&&p.x<W*.45&&state.movePointer===null){state.movePointer=e.pointerId;state.touchTarget=p;canvas.setPointerCapture?.(e.pointerId);logInput("move",{x:Math.round(p.x),y:Math.round(p.y)});}else primary(p.x,p.y);});
  canvas.addEventListener("pointermove",e=>{if(cfg.category!=="SHOOTER"||state.movePointer!==e.pointerId||!state.touchTarget||!(e.buttons||e.pressure))return;const p=pointerPosition(e);state.touchTarget={x:Math.min(p.x,W*.48),y:p.y};});
  canvas.addEventListener("pointerup",e=>{if(cfg.category==="SHOOTER"&&state.movePointer===e.pointerId){state.touchTarget=null;state.movePointer=null;canvas.releasePointerCapture?.(e.pointerId);}});
  addEventListener("keydown",e=>{const k=e.key.toLowerCase();keys.add(k);if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();if(k===" "||k==="enter")primary();if(k==="p")togglePause();});addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
  overlay.addEventListener("click",()=>primary());
  function togglePause(){if(!running)return;paused=!paused;statusEl.textContent=paused?"Paused":"Live";document.getElementById("pause").textContent=paused?"Resume":"Pause";logInput(paused?"pause":"resume");}
  document.getElementById("pause").onclick=togglePause;document.getElementById("restart").onclick=()=>{running=false;init();start();};document.getElementById("mute").onclick=()=>{muted=!muted;document.getElementById("mute").textContent=muted?"Sound off":"Sound on";};document.getElementById("full").onclick=()=>document.documentElement.requestFullscreen?.();
  init();bg(0);label(cfg.title,W/2,220,44,"center");label(cfg.story,W/2,260,17,"center");send("ready",{category:cfg.category});
})();`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="pons-game-document" content="${FROZEN_GAME_DOCUMENT_VERSION}"><meta http-equiv="Content-Security-Policy" content="${gameDocumentContentSecurityPolicy(nonce)}"><title>${config.title.replace(/[<>]/g, "")}</title><style nonce="${nonce}">
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${config.palette.background};color:${config.palette.text};font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{display:grid;grid-template-rows:auto 1fr}.bar{height:54px;padding:0 14px;display:flex;align-items:center;gap:8px;background:rgba(3,8,6,.9);border-bottom:1px solid rgba(255,255,255,.08)}.brand{font-weight:850;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.score{font-variant-numeric:tabular-nums;font-weight:900;color:${config.palette.primary};min-width:48px;text-align:right}.status{font-size:12px;opacity:.62}.controls{display:flex;gap:6px}.controls button{border:0;border-radius:999px;background:rgba(255,255,255,.09);color:inherit;padding:8px 11px;font:700 12px inherit;cursor:pointer}.wrap{position:relative;min-height:0}.wrap canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:30px;background:linear-gradient(180deg,rgba(4,10,7,.24),rgba(4,10,7,.8));cursor:pointer}.overlay[hidden]{display:none}.overlay h1{margin:0 0 8px;font-size:clamp(28px,6vw,58px);letter-spacing:-.05em}.overlay p{margin:0 auto;max-width:620px;line-height:1.5;opacity:.78}.play{display:inline-flex;margin:22px auto 0;padding:13px 20px;border-radius:999px;background:${config.palette.primary};color:${config.palette.background};font-weight:900}.hint{position:absolute;left:16px;bottom:14px;font-size:12px;opacity:.58}@media(max-width:700px){.bar{height:50px;padding:0 9px}.controls button{padding:7px 8px}.status{display:none}.hint{font-size:11px}.brand{max-width:120px}}@media(max-width:420px){.brand{display:none}.controls{gap:3px;margin-left:auto}.controls button{padding:7px 6px;font-size:10px}.score{min-width:32px}.hint{display:none}}
  </style></head><body><div class="bar"><div class="brand">${config.title.replace(/[<>]/g, "")}</div><div id="status" class="status">Ready</div><div id="score" class="score">0</div><div class="controls"><button id="pause" aria-label="Pause game">Pause</button><button id="restart" aria-label="Restart game">Restart</button><button id="mute" aria-label="Mute game">Sound on</button><button id="full" aria-label="Fullscreen game">Full</button></div></div><div class="wrap"><canvas id="stage" width="960" height="540" aria-label="Playable ${config.category.toLowerCase()} game"></canvas><div id="overlay" class="overlay"><div><h1 id="overlay-title">${config.title.replace(/[<>]/g, "")}</h1><p id="overlay-copy">${config.instructions.replace(/[<>]/g, "")}</p><span class="play">Play now</span></div></div><div class="hint">${config.instructions.replace(/[<>]/g, "")}</div></div><script id="game-config" type="application/json">${safeJson(config)}</script><script nonce="${nonce}">${runtime}</script></body></html>`;
}

export function buildFrozenGameDocument(config: GameConfig) {
  return buildGameDocument(config, {
    nonce: FROZEN_GAME_DOCUMENT_NONCE,
    versionId: FROZEN_GAME_DOCUMENT_VERSION,
  });
}
