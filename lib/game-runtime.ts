import type { GameConfig } from "@/lib/types";

export const GAME_RUNTIME_VERSION = "runtime-v4";
export const FROZEN_GAME_DOCUMENT_VERSION = "pons-frozen-runtime-v4";
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
  return `${config.category.toLowerCase()}-v4`;
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
  const cfg=JSON.parse(document.getElementById("game-config").textContent),canvas=document.getElementById("stage"),ctx=canvas.getContext("2d",{alpha:false}),scoreEl=document.getElementById("score"),statusEl=document.getElementById("status"),overlay=document.getElementById("overlay"),overlayTitle=document.getElementById("overlay-title"),overlayCopy=document.getElementById("overlay-copy");
  const W=960,H=540,reduced=matchMedia("(prefers-reduced-motion: reduce)").matches,keys=new Set(),state={};
  let running=false,paused=false,ended=false,muted=false,last=0,score=0,elapsed=0,seed=cfg.seed>>>0,eventLog=[],particles=[],pops=[],shake=0,flash=0;
  const difficulty=cfg.difficulty==="HARD"?1.22:cfg.difficulty==="EASY"?.84:1,pace=cfg.speed*difficulty,mech=cfg.mechanics||{worldPattern:"grid",playerForm:"runner",obstacleForm:"barrier",collectibleForm:"shard",gravity:1,jumpPower:1,spawnRate:1,collectibleRate:1,obstacleScale:1,enemyAggression:1,projectileSpeed:1};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296},now=()=>Math.round(elapsed);
  const logInput=(type,data={})=>{if(running&&eventLog.length<1800)eventLog.push({t:now(),type,...data})};
  const send=(type,payload={})=>parent.postMessage({source:"pons-game",version:1,type,payload:{versionId:${safeJson(versionId)},...payload}},"*");
  function tone(freq=420,duration=.05,volume=.026){if(muted||cfg.soundStyle==="silent")return;try{const ac=window.__ac||(window.__ac=new AudioContext()),o=ac.createOscillator(),g=ac.createGain();o.type=cfg.soundStyle==="soft"?"sine":"square";o.frequency.setValueAtTime(freq,ac.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(80,freq*.78),ac.currentTime+duration);g.gain.setValueAtTime(volume,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration);o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+duration)}catch{}}
  function resize(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0)}
  addEventListener("resize",resize);resize();
  function pill(x,y,w,h,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(w,h)/2);ctx.fill()}
  function glow(color,blur=18){ctx.shadowColor=color;ctx.shadowBlur=reduced?0:blur}
  function burst(x,y,color,count=14,power=210){if(reduced)count=Math.min(4,count);for(let i=0;i<count;i++){const a=rnd()*Math.PI*2,v=power*(.35+rnd()*.75);particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-35,life:420+rnd()*420,max:850,size:2+rnd()*5,color})}}
  function popup(text,x,y,color){pops.push({text,x,y,life:700,color})}
  function updateFx(dt){particles.forEach(p=>{p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;p.vy+=240*dt/1000;p.life-=dt});particles=particles.filter(p=>p.life>0);pops.forEach(p=>{p.y-=28*dt/1000;p.life-=dt});pops=pops.filter(p=>p.life>0);shake=Math.max(0,shake-dt*.035);flash=Math.max(0,flash-dt*.004)}
  function drawFx(){for(const p of particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;ctx.textAlign="center";ctx.font="800 18px ui-sans-serif,system-ui";for(const p of pops){ctx.globalAlpha=clamp(p.life/500,0,1);ctx.fillStyle=p.color;ctx.fillText(p.text,p.x,p.y)}ctx.globalAlpha=1;if(flash){ctx.fillStyle="rgba(255,255,255,"+Math.min(.2,flash)+")";ctx.fillRect(0,0,W,H)}}
  function backdrop(t){
    const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,cfg.palette.background);g.addColorStop(.58,cfg.palette.background);g.addColorStop(1,"#02050a");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const halo=ctx.createRadialGradient(W*.72,H*.22,5,W*.72,H*.22,420);halo.addColorStop(0,cfg.palette.primary+"30");halo.addColorStop(1,"transparent");ctx.fillStyle=halo;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.strokeStyle=cfg.palette.primary;ctx.fillStyle=cfg.palette.primary;ctx.lineWidth=1;
    if(mech.worldPattern==="stars"){
      for(let layer=1;layer<=3;layer++){ctx.globalAlpha=.12+layer*.08;for(let i=0;i<28;i++){const x=(i*191+layer*83+t*.008*layer)%W,y=(i*73+layer*51)%H,r=.7+layer*.55;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}}
      ctx.globalAlpha=.1;for(let x=-80;x<W+100;x+=150){const h=45+((x+960)%170);ctx.beginPath();ctx.moveTo(x,H);ctx.lineTo(x+80,H-h);ctx.lineTo(x+170,H);ctx.fill()}
    }else if(mech.worldPattern==="waves"){
      for(let y=80;y<H;y+=65){ctx.globalAlpha=.08+(y/H)*.12;ctx.beginPath();for(let x=0;x<=W;x+=18){const yy=y+Math.sin(x*.016+t*.0015+y)*17;x?ctx.lineTo(x,yy):ctx.moveTo(x,yy)}ctx.stroke()}
      ctx.globalAlpha=.08;for(let i=0;i<12;i++){const x=(i*113-t*.014*(1+i%2)+W)%W;ctx.beginPath();ctx.arc(x,90+i%5*65,30+i%3*14,0,Math.PI*2);ctx.stroke()}
    }else if(mech.worldPattern==="circuit"){
      const off=t*.025%64;ctx.globalAlpha=.13;for(let x=-64+off;x<W;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H*.38);ctx.lineTo(x+28,H*.47);ctx.lineTo(x+28,H);ctx.stroke();ctx.fillRect(x-2,H*.38-2,5,5)}for(let y=70;y<H;y+=96){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      ctx.globalAlpha=.09;for(let x=0;x<W;x+=110){const h=70+(x*7%190);ctx.fillRect(x,H-h,72,h)}
    }else{
      const off=t*.04%48;ctx.globalAlpha=.13;for(let x=-48+off;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-140,H);ctx.stroke()}for(let y=55;y<H;y+=72){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      ctx.globalAlpha=.08;for(let x=-40;x<W;x+=125){ctx.beginPath();ctx.moveTo(x,H);ctx.lineTo(x+65,H-110-(x%3)*32);ctx.lineTo(x+135,H);ctx.fill()}
    }
    ctx.restore();const vignette=ctx.createRadialGradient(W/2,H/2,190,W/2,H/2,600);vignette.addColorStop(.55,"transparent");vignette.addColorStop(1,"rgba(0,0,0,.55)");ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H)
  }
  function drawPlayer(x,y,size,t=0,angle=0){
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);glow(cfg.palette.primary,22);ctx.fillStyle=cfg.palette.primary;ctx.strokeStyle=cfg.palette.accent;ctx.lineWidth=3;
    const bob=Math.sin(t*.008)*2;ctx.translate(0,bob);
    if(mech.playerForm==="orb"){const rg=ctx.createRadialGradient(-size*.12,-size*.16,2,0,0,size*.5);rg.addColorStop(0,"#fff");rg.addColorStop(.18,cfg.palette.accent);rg.addColorStop(1,cfg.palette.primary);ctx.fillStyle=rg;ctx.beginPath();ctx.arc(0,0,size*.44,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.background;ctx.beginPath();ctx.arc(size*.14,-size*.11,size*.065,0,Math.PI*2);ctx.fill()}
    else if(mech.playerForm==="ship"){ctx.beginPath();ctx.moveTo(size*.54,0);ctx.lineTo(-size*.38,-size*.38);ctx.lineTo(-size*.17,0);ctx.lineTo(-size*.38,size*.38);ctx.closePath();ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.accent;ctx.beginPath();ctx.moveTo(-size*.35,-size*.16);ctx.lineTo(-size*.7,0);ctx.lineTo(-size*.35,size*.16);ctx.fill()}
    else if(mech.playerForm==="bot"){pill(-size*.43,-size*.4,size*.86,size*.78,cfg.palette.primary);ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.background;ctx.fillRect(-size*.23,-size*.12,size*.12,size*.11);ctx.fillRect(size*.11,-size*.12,size*.12,size*.11);ctx.fillStyle=cfg.palette.accent;ctx.fillRect(-size*.2,size*.12,size*.4,size*.055);ctx.strokeStyle=cfg.palette.primary;ctx.beginPath();ctx.moveTo(0,-size*.4);ctx.lineTo(0,-size*.58);ctx.stroke();ctx.beginPath();ctx.arc(0,-size*.62,3,0,Math.PI*2);ctx.fill()}
    else{pill(-size*.38,-size*.44,size*.76,size*.72,cfg.palette.primary);ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.background;ctx.fillRect(size*.12,-size*.22,size*.1,size*.1);ctx.strokeStyle=cfg.palette.accent;ctx.lineWidth=5;const stride=Math.sin(t*.018)*size*.18;ctx.beginPath();ctx.moveTo(-size*.12,size*.2);ctx.lineTo(-size*.25+stride,size*.48);ctx.moveTo(size*.12,size*.2);ctx.lineTo(size*.25-stride,size*.48);ctx.stroke();ctx.beginPath();ctx.moveTo(-size*.34,-size*.02);ctx.lineTo(-size*.55-stride*.5,size*.12);ctx.stroke()}
    ctx.restore()
  }
  function drawObstacle(x,y,w,h,t=0){
    ctx.save();glow(cfg.palette.danger,16);ctx.fillStyle=cfg.palette.danger;ctx.strokeStyle=cfg.palette.danger;ctx.lineWidth=5;
    if(mech.obstacleForm==="spike"){const count=Math.max(1,Math.round(w/24));for(let i=0;i<count;i++){const sw=w/count;ctx.beginPath();ctx.moveTo(x+i*sw,y+h);ctx.lineTo(x+i*sw+sw*.5,y);ctx.lineTo(x+(i+1)*sw,y+h);ctx.closePath();ctx.fill()}}
    else if(mech.obstacleForm==="drone"){ctx.beginPath();ctx.arc(x+w*.5,y+h*.52,Math.min(w,h)*.35,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.danger;ctx.fillRect(x+w*.12,y+h*.48,w*.76,5);ctx.beginPath();ctx.arc(x+w*.5,y+h*.5,5,0,Math.PI*2);ctx.fillStyle=cfg.palette.accent;ctx.fill();ctx.globalAlpha=.45;ctx.fillRect(x-w*.08,y+Math.sin(t*.02)*2,w*.28,3);ctx.fillRect(x+w*.8,y+Math.sin(t*.02+1)*2,w*.28,3)}
    else if(mech.obstacleForm==="meteor"){ctx.translate(x+w*.5,y+h*.5);ctx.rotate(t*.001);ctx.beginPath();for(let i=0;i<12;i++){const a=i/12*Math.PI*2,r=Math.min(w,h)*(.34+(i%3)*.055),px=Math.cos(a)*r,py=Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=.24;ctx.fillStyle=cfg.palette.background;ctx.beginPath();ctx.arc(-w*.08,-h*.08,Math.min(w,h)*.08,0,Math.PI*2);ctx.fill()}
    else{pill(x,y,w,h,cfg.palette.danger);ctx.shadowBlur=0;ctx.globalAlpha=.25;ctx.fillStyle="#fff";pill(x+5,y+5,Math.max(4,w-10),Math.min(7,h*.12),"#fff");ctx.globalAlpha=.3;ctx.fillStyle=cfg.palette.background;for(let yy=y+20;yy<y+h;yy+=22)ctx.fillRect(x+7,yy,Math.max(4,w-14),3)}ctx.restore()
  }
  function drawCollectible(x,y,size,t=0){
    const pulse=1+Math.sin(t*.008+x)*.09;ctx.save();ctx.translate(x,y);ctx.rotate(t*.0015);ctx.scale(pulse,pulse);glow(cfg.palette.accent,22);ctx.strokeStyle=cfg.palette.accent;ctx.fillStyle=cfg.palette.accent;ctx.lineWidth=4;
    if(mech.collectibleForm==="star"){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?size*.22:size*.48;i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r)}ctx.closePath();ctx.fill()}
    else if(mech.collectibleForm==="crystal"){ctx.beginPath();ctx.moveTo(0,-size*.5);ctx.lineTo(size*.36,0);ctx.lineTo(0,size*.5);ctx.lineTo(-size*.36,0);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle="#fff";ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(0,-size*.38);ctx.lineTo(0,size*.36);ctx.stroke()}
    else if(mech.collectibleForm==="neuron"){ctx.beginPath();ctx.arc(0,0,size*.2,0,Math.PI*2);ctx.fill();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(Math.cos(a)*size*.14,Math.sin(a)*size*.14);ctx.lineTo(Math.cos(a)*size*.5,Math.sin(a)*size*.5);ctx.stroke();ctx.beginPath();ctx.arc(Math.cos(a)*size*.5,Math.sin(a)*size*.5,3,0,Math.PI*2);ctx.fill()}}
    else{ctx.beginPath();ctx.moveTo(0,-size*.46);ctx.lineTo(size*.36,-size*.05);ctx.lineTo(size*.22,size*.43);ctx.lineTo(-size*.28,size*.36);ctx.lineTo(-size*.4,-size*.12);ctx.closePath();ctx.stroke();ctx.globalAlpha=.25;ctx.fill()}ctx.restore()
  }
  function ground(t){ctx.fillStyle=cfg.palette.primary;ctx.globalAlpha=.85;ctx.fillRect(0,468,W,4);ctx.globalAlpha=.14;ctx.fillRect(0,472,W,68);ctx.strokeStyle=cfg.palette.primary;ctx.lineWidth=1;const off=t*.42*pace%68;for(let x=-68-off;x<W+68;x+=68){ctx.beginPath();ctx.moveTo(x,540);ctx.lineTo(x+90,472);ctx.stroke()}ctx.globalAlpha=1}
  function initRunner(){Object.assign(state,{y:418,vy:0,obstacles:[],coins:[],spawn:0,coinSpawn:500,distance:0,bonus:0,landed:true,trail:[]})}
  function runnerInput(){if(state.y>=417){state.vy=-650*mech.jumpPower;state.landed=false;burst(128,460,cfg.palette.primary,8,110);tone(540,.055);logInput("jump")}}
  function runner(dt,t){
    state.spawn-=dt;state.coinSpawn-=dt;state.distance+=dt*pace;
    if(state.spawn<=0){const jumpV=650*mech.jumpPower,gravity=1800*mech.gravity,horizontal=420*pace,rawW=(32+rnd()*42)*mech.obstacleScale,minimumClearWindow=2*Math.sqrt(Math.max(0,jumpV*jumpV-2*gravity*26))/gravity,maxClearW=Math.max(26,horizontal*Math.max(.12,minimumClearWindow-.04)-45),w=Math.min(rawW,maxClearW),overlap=(w+45)/horizontal+.04,discriminant=Math.max(0,jumpV*jumpV-(gravity*overlap/2)*(gravity*overlap/2)),maxClearH=Math.max(30,discriminant/(2*gravity)+4),h=Math.min((44+rnd()*75)*mech.obstacleScale,maxClearH);state.obstacles.push({x:1000,w,h});state.spawn=(850+rnd()*900)/(pace*mech.spawnRate)}
    if(state.coinSpawn<=0){state.coins.push({x:1000,y:280+rnd()*120,phase:rnd()*8});state.coinSpawn=(550+rnd()*750)/(pace*mech.collectibleRate)}
    state.vy+=1800*mech.gravity*dt/1000;state.y+=state.vy*dt/1000;if(state.y>418){if(!state.landed&&state.vy>200)burst(128,466,cfg.palette.primary,7,80);state.y=418;state.vy=0;state.landed=true}
    state.obstacles.forEach(o=>o.x-=420*pace*dt/1000);state.coins.forEach(c=>c.x-=420*pace*dt/1000);
    for(const o of state.obstacles)if(o.x<150&&o.x+o.w>105&&state.y+46>468-o.h){shake=10;burst(128,state.y+20,cfg.palette.danger,24,280);return finish()}
    state.coins=state.coins.filter(c=>{const cy=c.y+Math.sin(t*.006+c.phase)*9,hit=Math.abs(c.x-128)<30&&Math.abs(cy-state.y-25)<43;if(hit){state.bonus+=25;logInput("collect");burst(c.x,cy,cfg.palette.accent,15,180);popup("+25",c.x,cy-18,cfg.palette.accent);tone(820,.06);return false}return c.x>-50});state.obstacles=state.obstacles.filter(o=>o.x>-100);score=Math.floor(state.distance/10)+state.bonus;
    backdrop(t);ground(t);state.coins.forEach(c=>drawCollectible(c.x,c.y+Math.sin(t*.006+c.phase)*9,30,t));state.obstacles.forEach(o=>drawObstacle(o.x,468-o.h,o.w,o.h,t));drawPlayer(128,state.y+25,52,t,state.vy/2600);drawFx()
  }
  function initFlappy(){Object.assign(state,{y:260,vy:0,pipes:[],spawn:0,trail:[]})}
  function flappyInput(){state.vy=-450*pace*mech.jumpPower;burst(142,state.y,cfg.palette.accent,6,85);tone(620,.045);logInput("flap")}
  function drawGate(p,t){const top=p.y-p.gap/2,bottom=p.y+p.gap/2;ctx.save();glow(cfg.palette.primary,18);ctx.fillStyle=cfg.palette.primary;ctx.globalAlpha=.85;ctx.fillRect(p.x,0,80,Math.max(0,top));ctx.fillRect(p.x,bottom,80,H-bottom);ctx.shadowBlur=0;ctx.fillStyle=cfg.palette.accent;ctx.globalAlpha=.7;ctx.fillRect(p.x-8,top-14,96,14);ctx.fillRect(p.x-8,bottom,96,14);ctx.globalAlpha=.22;for(let y=20;y<top-18;y+=28)ctx.fillRect(p.x+10,y,60,4);for(let y=bottom+24;y<H;y+=28)ctx.fillRect(p.x+10,y,60,4);ctx.globalAlpha=.1+.07*Math.sin(t*.005);ctx.fillStyle=cfg.palette.accent;ctx.fillRect(p.x+12,top,56,p.gap);ctx.restore()}
  function flappy(dt,t){state.spawn-=dt;if(state.spawn<=0){state.pipes.push({x:1040,gap:(170-rnd()*25)/mech.obstacleScale,y:120+rnd()*220,passed:false});state.spawn=(1300+rnd()*350)/(pace*mech.spawnRate)}state.vy+=1250*mech.gravity*dt/1000;state.y+=state.vy*dt/1000;state.pipes.forEach(p=>p.x-=330*pace*dt/1000);state.trail.unshift({x:150,y:state.y,life:1});state.trail=state.trail.slice(0,reduced?3:11);state.trail.forEach(p=>p.life-=dt*.0028);if(state.y<0||state.y>H){shake=9;return finish()}for(const p of state.pipes){if(!p.passed&&p.x<170){p.passed=true;score+=100;logInput("gate");burst(164,state.y,cfg.palette.accent,13,150);popup("CLEAR",164,state.y-28,cfg.palette.accent);tone(760,.07)}if(p.x<205&&p.x+80>125&&(state.y-20<p.y-p.gap/2||state.y+20>p.y+p.gap/2)){shake=10;burst(160,state.y,cfg.palette.danger,22,260);return finish()}}state.pipes=state.pipes.filter(p=>p.x>-100);backdrop(t);state.pipes.forEach(p=>drawGate(p,t));state.trail.forEach((p,i)=>{ctx.globalAlpha=Math.max(0,p.life)*.22;ctx.fillStyle=cfg.palette.primary;ctx.beginPath();ctx.arc(p.x-i*10,p.y,Math.max(2,12-i),0,Math.PI*2);ctx.fill()});ctx.globalAlpha=1;drawPlayer(160,state.y,50,t,clamp(state.vy/900,-.45,.65));drawFx()}
  function initShooter(){Object.assign(state,{x:480,y:420,bullets:[],enemies:[],spawn:0,touchTarget:null,movePointer:null,hits:0,survival:0,lives:3,invulnerable:0,aimX:480,aimY:100})}
  function shooterInput(x,y){const a=Math.atan2(y-state.y,x-state.x),v=700*mech.projectileSpeed;state.aimX=x;state.aimY=y;state.bullets.push({x:state.x,y:state.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,px:state.x,py:state.y});burst(state.x+Math.cos(a)*24,state.y+Math.sin(a)*24,cfg.palette.accent,4,80);tone(710,.035,.018);logInput("fire",{x:Math.round(x),y:Math.round(y)})}
  function shooter(dt,t){
    const d=360*pace*dt/1000;if(keys.has("arrowleft")||keys.has("a"))state.x-=d;if(keys.has("arrowright")||keys.has("d"))state.x+=d;if(keys.has("arrowup")||keys.has("w"))state.y-=d;if(keys.has("arrowdown")||keys.has("s"))state.y+=d;if(state.touchTarget){const dx=state.touchTarget.x-state.x,dy=state.touchTarget.y-state.y,dist=Math.hypot(dx,dy);if(dist>5){state.x+=dx/dist*Math.min(d,dist);state.y+=dy/dist*Math.min(d,dist)}}state.x=clamp(state.x,30,W-30);state.y=clamp(state.y,40,H-30);state.invulnerable=Math.max(0,state.invulnerable-dt);
    state.spawn-=dt;if(state.spawn<=0){state.enemies.push({x:40+rnd()*(W-80),y:-35,r:(18+rnd()*16)*mech.obstacleScale,hp:1,phase:rnd()*7,type:rnd()>.72?1:0});state.spawn=(460+rnd()*460)/(pace*mech.spawnRate)}
    state.bullets.forEach(b=>{b.px=b.x;b.py=b.y;b.x+=b.vx*dt/1000;b.y+=b.vy*dt/1000});state.enemies.forEach(e=>{const a=Math.atan2(state.y-e.y,state.x-e.x),v=(e.type?115:92)*pace*mech.enemyAggression*dt/1000;e.x+=Math.cos(a)*v+Math.sin(t*.004+e.phase)*(e.type?1.1:.35);e.y+=Math.sin(a)*v;if(state.invulnerable<=0&&Math.hypot(e.x-state.x,e.y-state.y)<e.r+20){e.hp=0;state.lives-=1;state.invulnerable=950;shake=12;flash=.18;burst(state.x,state.y,cfg.palette.danger,24,270);tone(150,.16,.035);if(state.lives<=0)finish()}});
    for(const b of state.bullets)for(const e of state.enemies)if(e.hp&&Math.hypot(e.x-b.x,e.y-b.y)<e.r+6){e.hp=0;b.y=-999;state.hits+=1;logInput("hit");burst(e.x,e.y,cfg.palette.danger,18,240);popup("+50",e.x,e.y-20,cfg.palette.accent);shake=3;tone(880,.045,.02)}
    state.bullets=state.bullets.filter(b=>b.y>-50&&b.y<H+50&&b.x>-50&&b.x<W+50);state.enemies=state.enemies.filter(e=>e.hp&&e.y<H+80);state.survival+=dt*8/1000;score=Math.floor(state.survival)+state.hits*50;
    backdrop(t);ctx.save();ctx.globalCompositeOperation="lighter";for(const b of state.bullets){ctx.strokeStyle=cfg.palette.accent;ctx.lineWidth=5;ctx.globalAlpha=.35;ctx.beginPath();ctx.moveTo(b.px,b.py);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.globalAlpha=1;glow(cfg.palette.accent,12);ctx.fillStyle=cfg.palette.accent;ctx.beginPath();ctx.arc(b.x,b.y,4,0,Math.PI*2);ctx.fill()}ctx.restore();state.enemies.forEach(e=>drawObstacle(e.x-e.r,e.y-e.r,e.r*2,e.r*2,t+e.phase*100));ctx.globalAlpha=state.invulnerable>0&&Math.floor(t/90)%2?.28:1;drawPlayer(state.x,state.y,52,t,Math.atan2(state.aimY-state.y,state.aimX-state.x));ctx.globalAlpha=1;ctx.font="700 14px ui-sans-serif,system-ui";ctx.fillStyle=cfg.palette.text;ctx.textAlign="left";ctx.fillText("SHIELDS",20,30);for(let i=0;i<3;i++){ctx.globalAlpha=i<state.lives?1:.18;ctx.fillStyle=i<state.lives?cfg.palette.primary:cfg.palette.text;ctx.beginPath();ctx.arc(94+i*21,25,7,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;drawFx()
  }
  function init(){seed=cfg.seed>>>0;score=0;elapsed=0;eventLog=[];particles=[];pops=[];shake=0;flash=0;last=performance.now();ended=false;paused=false;scoreEl.textContent="0";statusEl.textContent="Ready";document.getElementById("pause").textContent="Pause";if(cfg.category==="RUNNER")initRunner();else if(cfg.category==="FLAPPY")initFlappy();else initShooter()}
  function start(){if(ended)init();if(!running){running=true;paused=false;overlay.hidden=true;statusEl.textContent="Live";last=performance.now();send("game_start",{seed:cfg.seed});requestAnimationFrame(loop)}}
  function finish(){if(ended)return;ended=true;running=false;flash=.16;const duration=Math.max(1,Math.round(elapsed));statusEl.textContent="Finished";overlay.hidden=false;overlayTitle.textContent=cfg.title+" · "+score;overlayCopy.textContent="Run complete. Tap to play again.";tone(170,.18,.035);send("game_over",{score,durationMs:duration,metric:cfg.category==="FLAPPY"?"gates":"score",events:eventLog.slice(0,1800)})}
  function loop(t){if(!running||ended)return;const dt=Math.min(32,t-last);last=t;if(!paused){elapsed+=dt;updateFx(dt);ctx.save();if(shake&&!reduced)ctx.translate((rnd()-.5)*shake,(rnd()-.5)*shake);if(cfg.category==="RUNNER")runner(dt,t);else if(cfg.category==="FLAPPY")flappy(dt,t);else shooter(dt,t);ctx.restore();scoreEl.textContent=String(score)}requestAnimationFrame(loop)}
  function primary(x=W/2,y=H/2){if(!running){start();return}if(paused||ended)return;if(cfg.category==="RUNNER")runnerInput();else if(cfg.category==="FLAPPY")flappyInput();else shooterInput(x,y)}
  function pointerPosition(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H}}
  canvas.addEventListener("pointerdown",e=>{const p=pointerPosition(e);if(!running){start();return}if(cfg.category==="SHOOTER"&&p.x<W*.45&&state.movePointer===null){state.movePointer=e.pointerId;state.touchTarget=p;canvas.setPointerCapture?.(e.pointerId);logInput("move",{x:Math.round(p.x),y:Math.round(p.y)})}else primary(p.x,p.y)});
  canvas.addEventListener("pointermove",e=>{if(cfg.category!=="SHOOTER"||state.movePointer!==e.pointerId||!state.touchTarget||!(e.buttons||e.pressure))return;const p=pointerPosition(e);state.touchTarget={x:Math.min(p.x,W*.48),y:p.y}});canvas.addEventListener("pointerup",e=>{if(cfg.category==="SHOOTER"&&state.movePointer===e.pointerId){state.touchTarget=null;state.movePointer=null;canvas.releasePointerCapture?.(e.pointerId)}});
  addEventListener("keydown",e=>{const k=e.key.toLowerCase();keys.add(k);if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();if(k===" "||k==="enter")primary();if(k==="p")togglePause()});addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));overlay.addEventListener("click",()=>primary());
  function togglePause(){if(!running)return;paused=!paused;statusEl.textContent=paused?"Paused":"Live";document.getElementById("pause").textContent=paused?"Resume":"Pause";logInput(paused?"pause":"resume")}
  document.getElementById("pause").onclick=togglePause;document.getElementById("restart").onclick=()=>{running=false;init();start()};document.getElementById("mute").onclick=()=>{muted=!muted;document.getElementById("mute").textContent=muted?"Sound off":"Sound on"};document.getElementById("full").onclick=()=>document.documentElement.requestFullscreen?.();
  init();backdrop(0);send("ready",{category:cfg.category});
})();`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="pons-game-document" content="${FROZEN_GAME_DOCUMENT_VERSION}"><meta http-equiv="Content-Security-Policy" content="${gameDocumentContentSecurityPolicy(nonce)}"><title>${escapeHtml(config.title)}</title><style nonce="${nonce}">
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${config.palette.background};color:${config.palette.text};font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;font-weight:400;-webkit-font-smoothing:antialiased}body{display:grid;grid-template-rows:auto 1fr}.bar{height:48px;padding:0 13px;display:flex;align-items:center;gap:8px;background:rgba(3,8,6,.9);border-bottom:1px solid rgba(255,255,255,.08)}.brand{font-size:13px;font-weight:650;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.score{font-variant-numeric:tabular-nums;font-weight:700;color:${config.palette.primary};min-width:42px;text-align:right}.status{font-size:11px;opacity:.62}.controls{display:flex;gap:5px}.controls button{border:0;border-radius:999px;background:rgba(255,255,255,.09);color:inherit;padding:7px 10px;font:600 11px inherit;cursor:pointer}.wrap{position:relative;min-height:0}.wrap canvas{display:block;width:100%;height:100%;touch-action:none}.overlay{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:clamp(16px,4vw,30px);background:radial-gradient(circle at 50% 38%,rgba(47,107,255,.22),transparent 36%),linear-gradient(180deg,#071426,#030813);cursor:pointer}.overlay[hidden]{display:none}.overlay>div{width:min(100%,560px);padding:10px}.overlay h1{margin:0 0 9px;font-size:clamp(26px,5vw,42px);font-weight:650;line-height:1;letter-spacing:-.035em;text-wrap:balance}.overlay p{margin:0 auto;max-width:460px;font-size:clamp(11px,1.8vw,14px);font-weight:450;line-height:1.42;opacity:.76;text-wrap:balance}.play{display:inline-flex;margin:17px auto 0;padding:10px 18px;border-radius:999px;background:${config.palette.primary};color:${config.palette.background};font-size:13px;font-weight:700}@media(max-width:700px){.bar{height:46px;padding:0 8px}.controls button{padding:7px 8px}.status{display:none}.brand{max-width:110px}}@media(max-width:420px){.brand{display:none}.controls{gap:3px;margin-left:auto}.controls button{padding:7px 6px;font-size:10px}.score{min-width:30px}.overlay p{font-size:11px}.overlay{padding:14px}}
  </style></head><body><div class="bar"><div class="brand">${escapeHtml(config.title)}</div><div id="status" class="status">Ready</div><div id="score" class="score">0</div><div class="controls"><button id="pause" aria-label="Pause game">Pause</button><button id="restart" aria-label="Restart game">Restart</button><button id="mute" aria-label="Mute game">Sound on</button><button id="full" aria-label="Fullscreen game">Full</button></div></div><div class="wrap"><canvas id="stage" width="960" height="540" aria-label="Playable ${config.category.toLowerCase()} game"></canvas><div id="overlay" class="overlay"><div><h1 id="overlay-title">${escapeHtml(config.title)}</h1><p id="overlay-copy">${escapeHtml(config.instructions)}</p><span class="play">Play now</span></div></div></div><script id="game-config" type="application/json">${safeJson(config)}</script><script nonce="${nonce}">${runtime}</script></body></html>`;
}

export function buildFrozenGameDocument(config: GameConfig) {
  return buildGameDocument(config, {
    nonce: FROZEN_GAME_DOCUMENT_NONCE,
    versionId: FROZEN_GAME_DOCUMENT_VERSION,
  });
}
