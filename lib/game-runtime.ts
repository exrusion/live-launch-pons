import type { GameConfig } from "@/lib/types";

export const GAME_RUNTIME_VERSION = "runtime-v3";
export const FROZEN_GAME_DOCUMENT_VERSION = "pons-frozen-runtime-v3";
// This nonce is intentionally stable across runtime versions because the embed
// route also serves immutable documents created by earlier releases.
export const FROZEN_GAME_DOCUMENT_NONCE = "cG9ucy1mcm96ZW4tcnVudGltZS12Mg==";

/**
 * Frozen game documents deliberately use a stable nonce and document identity.
 * The generated HTML is an immutable artifact, so the nonce does not need to
 * vary per request. Keeping it stable lets preview, storage, and embed delivery
 * use the exact same bytes. Run scoring is bound to the server-side game version
 * through run_sessions; it never trusts the document's postMessage versionId.
 */
export function gameDocumentContentSecurityPolicy(nonce = FROZEN_GAME_DOCUMENT_NONCE) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src data:; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
}

export function gameTemplateVersion(config: GameConfig) {
  return `${config.category.toLowerCase()}-v3`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const mech = cfg.mechanics || {worldPattern:"grid",playerForm:"runner",obstacleForm:"barrier",collectibleForm:"shard",gravity:1,jumpPower:1,spawnRate:1,collectibleRate:1,obstacleScale:1,enemyAggression:1,projectileSpeed:1};
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
    ctx.fillStyle=cfg.palette.background;ctx.fillRect(0,0,W,H);ctx.globalAlpha=.14;ctx.strokeStyle=cfg.palette.primary;ctx.fillStyle=cfg.palette.primary;ctx.lineWidth=1;
    if(mech.worldPattern==="stars"){
      for(let i=0;i<58;i++){const x=(i*173+(t*.018*(1+i%3)))%W,y=(i*97)%H,r=1+(i%4===0?1.5:0);ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
    }else if(mech.worldPattern==="waves"){
      for(let y=70;y<H;y+=72){ctx.beginPath();for(let x=0;x<=W;x+=24){const yy=y+Math.sin(x*.018+t*.0015+y)*15;x?ctx.lineTo(x,yy):ctx.moveTo(x,yy);}ctx.stroke();}
    }else if(mech.worldPattern==="circuit"){
      const off=(t*.025)%64;for(let x=-64+off;x<W;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H*.45);ctx.lineTo(x+28,H*.52);ctx.lineTo(x+28,H);ctx.stroke();ctx.fillRect(x-2,H*.45-2,5,5);}
      for(let y=60;y<H;y+=96){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    }else{
      const off=(t*.04)%48;for(let x=-48+off;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-140,H);ctx.stroke();}
      for(let y=50;y<H;y+=72){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    }
    ctx.globalAlpha=1;
  }
  function pill(x,y,w,h,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(w,h)/2);ctx.fill();}
  function label(text,x,y,size=18,align="left"){ctx.fillStyle=cfg.palette.text;ctx.font="700 "+size+"px ui-sans-serif,system-ui";ctx.textAlign=align;ctx.fillText(text,x,y);}
  function drawPlayer(x,y,size){
    ctx.save();ctx.translate(x,y);ctx.fillStyle=cfg.palette.primary;ctx.strokeStyle=cfg.palette.accent;ctx.lineWidth=4;
    if(mech.playerForm==="orb"){ctx.beginPath();ctx.arc(0,0,size*.44,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(size*.12,-size*.12,size*.07,0,Math.PI*2);ctx.fillStyle=cfg.palette.background;ctx.fill();}
    else if(mech.playerForm==="ship"){ctx.beginPath();ctx.moveTo(0,-size*.52);ctx.lineTo(size*.43,size*.42);ctx.lineTo(0,size*.22);ctx.lineTo(-size*.43,size*.42);ctx.closePath();ctx.fill();ctx.stroke();}
    else if(mech.playerForm==="bot"){pill(-size*.42,-size*.42,size*.84,size*.84,cfg.palette.primary);ctx.fillStyle=cfg.palette.background;ctx.fillRect(-size*.2,-size*.12,size*.1,size*.1);ctx.fillRect(size*.1,-size*.12,size*.1,size*.1);}
    else{pill(-size*.42,-size*.45,size*.84,size*.8,cfg.palette.primary);pill(-size*.56,size*.18,size*1.12,size*.2,cfg.palette.primary);ctx.fillStyle=cfg.palette.background;ctx.fillRect(size*.14,-size*.22,size*.1,size*.1);}
    ctx.restore();
  }
  function drawObstacle(x,y,w,h){
    ctx.save();ctx.fillStyle=cfg.palette.danger;ctx.strokeStyle=cfg.palette.danger;ctx.lineWidth=6;
    if(mech.obstacleForm==="spike"){ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w*.5,y);ctx.lineTo(x+w,y+h);ctx.closePath();ctx.fill();}
    else if(mech.obstacleForm==="drone"){ctx.beginPath();ctx.arc(x+w*.5,y+h*.5,Math.min(w,h)*.42,0,Math.PI*2);ctx.stroke();ctx.fillRect(x-w*.1,y+h*.45,w*1.2,Math.max(5,h*.1));}
    else if(mech.obstacleForm==="meteor"){ctx.beginPath();for(let i=0;i<10;i++){const a=i/10*Math.PI*2,r=Math.min(w,h)*(.36+(i%2)*.1),px=x+w*.5+Math.cos(a)*r,py=y+h*.5+Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();}
    else pill(x,y,w,h,cfg.palette.danger);ctx.restore();
  }
  function drawCollectible(x,y,size){
    ctx.save();ctx.translate(x,y);ctx.strokeStyle=cfg.palette.accent;ctx.fillStyle=cfg.palette.accent;ctx.lineWidth=5;
    if(mech.collectibleForm==="star"){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?size*.22:size*.48;i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();}
    else if(mech.collectibleForm==="crystal"){ctx.beginPath();ctx.moveTo(0,-size*.5);ctx.lineTo(size*.36,0);ctx.lineTo(0,size*.5);ctx.lineTo(-size*.36,0);ctx.closePath();ctx.fill();}
    else if(mech.collectibleForm==="neuron"){ctx.beginPath();ctx.arc(0,0,size*.2,0,Math.PI*2);ctx.fill();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(Math.cos(a)*size*.15,Math.sin(a)*size*.15);ctx.lineTo(Math.cos(a)*size*.5,Math.sin(a)*size*.5);ctx.stroke();}}
    else{ctx.beginPath();ctx.arc(0,0,size*.38,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  }
  function initRunner(){ Object.assign(state,{ y:418, vy:0, obstacles:[], coins:[], spawn:0, coinSpawn:500, distance:0, bonus:0 }); }
  function runnerInput(){ if(state.y>=417){state.vy=-650*mech.jumpPower; tone(540); logInput("jump");} }
  function runner(dt,t){
    state.spawn-=dt; state.coinSpawn-=dt; state.distance+=dt*pace;
    if(state.spawn<=0){
      const jumpV=650*mech.jumpPower,gravity=1800*mech.gravity,horizontal=420*pace,rawW=(32+rnd()*42)*mech.obstacleScale;
      const minimumClearWindow=2*Math.sqrt(Math.max(0,jumpV*jumpV-2*gravity*26))/gravity;
      const maxClearW=Math.max(26,horizontal*Math.max(.12,minimumClearWindow-.04)-45),w=Math.min(rawW,maxClearW);
      const overlap=(w+45)/horizontal+.04,discriminant=Math.max(0,jumpV*jumpV-(gravity*overlap/2)*(gravity*overlap/2));
      const maxClearH=Math.max(30,discriminant/(2*gravity)+4),h=Math.min((44+rnd()*75)*mech.obstacleScale,maxClearH);
      state.obstacles.push({x:1000,w,h});state.spawn=(850+rnd()*900)/(pace*mech.spawnRate);
    }
    if(state.coinSpawn<=0){state.coins.push({x:1000,y:280+rnd()*120});state.coinSpawn=(550+rnd()*750)/(pace*mech.collectibleRate);}
    state.vy+=1800*mech.gravity*dt/1000; state.y+=state.vy*dt/1000; if(state.y>418){state.y=418;state.vy=0;}
    state.obstacles.forEach(o=>o.x-=420*pace*dt/1000); state.coins.forEach(c=>c.x-=420*pace*dt/1000);
    for(const o of state.obstacles){if(o.x<150&&o.x+o.w>105&&state.y+46>468-o.h) return finish();}
    state.coins=state.coins.filter(c=>{const hit=Math.abs(c.x-128)<30&&Math.abs(c.y-state.y)<42;if(hit){state.bonus+=25;logInput("collect");tone(800);return false;}return c.x>-50;});
    state.obstacles=state.obstacles.filter(o=>o.x>-100); score=Math.floor(state.distance/10)+state.bonus;
    bg(t); ctx.fillStyle=cfg.palette.primary; ctx.fillRect(0,468,W,72); ctx.globalAlpha=.16;ctx.fillStyle="#000";for(let x=0;x<W;x+=64)ctx.fillRect(x,474,32,66);ctx.globalAlpha=1;
    state.coins.forEach(c=>drawCollectible(c.x,c.y,30));
    state.obstacles.forEach(o=>drawObstacle(o.x,468-o.h,o.w,o.h));
    drawPlayer(128,state.y+25,52);
  }
  function initFlappy(){Object.assign(state,{y:260,vy:0,pipes:[],spawn:0});}
  function flappyInput(){state.vy=-450*pace*mech.jumpPower;tone(620);logInput("flap");}
  function flappy(dt,t){
    state.spawn-=dt;if(state.spawn<=0){state.pipes.push({x:1040,gap:(170-rnd()*25)/mech.obstacleScale,y:120+rnd()*220,passed:false});state.spawn=(1300+rnd()*350)/(pace*mech.spawnRate);}
    state.vy+=1250*mech.gravity*dt/1000;state.y+=state.vy*dt/1000;state.pipes.forEach(p=>p.x-=330*pace*dt/1000);
    if(state.y<0||state.y>H) return finish();
    for(const p of state.pipes){if(!p.passed&&p.x<170){p.passed=true;score+=100;logInput("gate");tone(760);}if(p.x<205&&p.x+80>125&&(state.y-20<p.y-p.gap/2||state.y+20>p.y+p.gap/2))return finish();}
    state.pipes=state.pipes.filter(p=>p.x>-100);bg(t);
    state.pipes.forEach(p=>{pill(p.x,0,80,p.y-p.gap/2,cfg.palette.primary);pill(p.x,p.y+p.gap/2,80,H,cfg.palette.primary);});
    drawPlayer(160,state.y,50);
  }
  function initShooter(){Object.assign(state,{x:480,y:420,bullets:[],enemies:[],spawn:0,touchTarget:null,movePointer:null,hits:0,survival:0});}
  function shooterInput(x,y){const a=Math.atan2(y-state.y,x-state.x),v=700*mech.projectileSpeed;state.bullets.push({x:state.x,y:state.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v});tone(710,.03);logInput("fire",{x:Math.round(x),y:Math.round(y)});}
  function shooter(dt,t){
    const d=360*pace*dt/1000;if(keys.has("arrowleft")||keys.has("a"))state.x-=d;if(keys.has("arrowright")||keys.has("d"))state.x+=d;if(keys.has("arrowup")||keys.has("w"))state.y-=d;if(keys.has("arrowdown")||keys.has("s"))state.y+=d;if(state.touchTarget){const dx=state.touchTarget.x-state.x,dy=state.touchTarget.y-state.y,dist=Math.hypot(dx,dy);if(dist>5){state.x+=dx/dist*Math.min(d,dist);state.y+=dy/dist*Math.min(d,dist);}}state.x=clamp(state.x,30,W-30);state.y=clamp(state.y,40,H-30);
    state.spawn-=dt;if(state.spawn<=0){state.enemies.push({x:40+rnd()*(W-80),y:-30,r:(18+rnd()*16)*mech.obstacleScale,hp:1});state.spawn=(460+rnd()*460)/(pace*mech.spawnRate);}
    state.bullets.forEach(b=>{b.x+=b.vx*dt/1000;b.y+=b.vy*dt/1000;});state.enemies.forEach(e=>{const a=Math.atan2(state.y-e.y,state.x-e.x),v=95*pace*mech.enemyAggression*dt/1000;e.x+=Math.cos(a)*v;e.y+=Math.sin(a)*v;if(Math.hypot(e.x-state.x,e.y-state.y)<e.r+20)finish();});
    for(const b of state.bullets)for(const e of state.enemies)if(e.hp&&Math.hypot(e.x-b.x,e.y-b.y)<e.r+5){e.hp=0;b.y=-999;state.hits+=1;logInput("hit");tone(880,.025);}
    state.bullets=state.bullets.filter(b=>b.y>-50&&b.y<H+50&&b.x>-50&&b.x<W+50);state.enemies=state.enemies.filter(e=>e.hp&&e.y<H+80);state.survival+=dt*8/1000;score=Math.floor(state.survival)+state.hits*50;
    bg(t);state.bullets.forEach(b=>pill(b.x-3,b.y-10,6,20,cfg.palette.accent));state.enemies.forEach(e=>drawObstacle(e.x-e.r,e.y-e.r,e.r*2,e.r*2));drawPlayer(state.x,state.y,52);
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

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="pons-game-document" content="${FROZEN_GAME_DOCUMENT_VERSION}"><meta http-equiv="Content-Security-Policy" content="${gameDocumentContentSecurityPolicy(nonce)}"><title>${escapeHtml(config.title)}</title><style nonce="${nonce}">
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${config.palette.background};color:${config.palette.text};font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;font-weight:400;-webkit-font-smoothing:antialiased}body{display:grid;grid-template-rows:auto 1fr}.bar{height:48px;padding:0 13px;display:flex;align-items:center;gap:8px;background:rgba(3,8,6,.9);border-bottom:1px solid rgba(255,255,255,.08)}.brand{font-size:13px;font-weight:650;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.score{font-variant-numeric:tabular-nums;font-weight:700;color:${config.palette.primary};min-width:42px;text-align:right}.status{font-size:11px;opacity:.62}.controls{display:flex;gap:5px}.controls button{border:0;border-radius:999px;background:rgba(255,255,255,.09);color:inherit;padding:7px 10px;font:600 11px inherit;cursor:pointer}.wrap{position:relative;min-height:0}.wrap canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:26px;background:radial-gradient(circle at 50% 38%,rgba(47,107,255,.22),transparent 36%),linear-gradient(180deg,#071426,#030813);cursor:pointer}.overlay[hidden]{display:none}.overlay>div{width:min(100%,560px);padding:18px}.overlay h1{margin:0 0 8px;font-size:clamp(27px,5vw,44px);font-weight:650;line-height:1;letter-spacing:-.035em;text-wrap:balance}.overlay p{margin:0 auto;max-width:460px;font-size:14px;font-weight:450;line-height:1.45;opacity:.76;text-wrap:balance}.play{display:inline-flex;margin:18px auto 0;padding:11px 18px;border-radius:999px;background:${config.palette.primary};color:${config.palette.background};font-size:13px;font-weight:700}.hint{position:absolute;left:14px;bottom:12px;font-size:11px;font-weight:450;opacity:.56}@media(max-width:700px){.bar{height:46px;padding:0 8px}.controls button{padding:7px 8px}.status{display:none}.hint{font-size:10px}.brand{max-width:110px}}@media(max-width:420px){.brand{display:none}.controls{gap:3px;margin-left:auto}.controls button{padding:7px 6px;font-size:10px}.score{min-width:30px}.hint{display:none}.overlay p{font-size:12px}.overlay{padding:18px}}
  </style></head><body><div class="bar"><div class="brand">${escapeHtml(config.title)}</div><div id="status" class="status">Ready</div><div id="score" class="score">0</div><div class="controls"><button id="pause" aria-label="Pause game">Pause</button><button id="restart" aria-label="Restart game">Restart</button><button id="mute" aria-label="Mute game">Sound on</button><button id="full" aria-label="Fullscreen game">Full</button></div></div><div class="wrap"><canvas id="stage" width="960" height="540" aria-label="Playable ${config.category.toLowerCase()} game"></canvas><div id="overlay" class="overlay"><div><h1 id="overlay-title">${escapeHtml(config.title)}</h1><p id="overlay-copy">${escapeHtml(config.instructions)}</p><span class="play">Play now</span></div></div><div class="hint">${escapeHtml(config.instructions)}</div></div><script id="game-config" type="application/json">${safeJson(config)}</script><script nonce="${nonce}">${runtime}</script></body></html>`;
}

export function buildFrozenGameDocument(config: GameConfig) {
  return buildGameDocument(config, {
    nonce: FROZEN_GAME_DOCUMENT_NONCE,
    versionId: FROZEN_GAME_DOCUMENT_VERSION,
  });
}
