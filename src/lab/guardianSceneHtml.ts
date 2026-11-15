import { GLYPH_DATA_URL } from './vaultSceneHtml';

// The guardians: who looks at every release before it reaches the store, drawn
// with what this app already draws.
//
// The ground is the night every tab stands in. In the middle is the vault's
// moon with the token's mark, and round it the radar from Top: the same rings,
// the same beam. Here the rings are time. The rim is a 24 hour dial, midnight
// on top, and every release of the last day is a phone standing at the minute
// it was requested; the faster its last vote came, the nearer the moon it
// rests. A gold mark on the rim is now.
//
// A guardian is an eye, the app's own: the one in the header and on the
// opening. Its lids say how lately it voted, the way the header's eye says how
// fresh the numbers are: wide open within two hours, a closed lid after a day
// of silence. It blinks, and it watches whatever has just arrived.
//
// A request comes in out of the dark to the rim as a phone with its package
// name. A vote is the event: the guardian's eye turns gold, a thread of light
// runs from it to the phone, a gold ring opens where it lands, one mark over
// the phone lights and the seconds it took are written beside it. When every
// guardian has voted the phone takes its place among the rings. Between real
// events the scene looks back, one past release at a time, labelled with its
// age and with REPLAY in the corner. Whether a vote said yes or no is drawn
// nowhere: only that it was cast, by whom and when.
//
// The timelapse turns the beam into the clock's hand: once round the dial in
// twenty seconds, every request and vote of the day happening again as it
// passes, the eyes waking and falling asleep on the way.
//
// Same approach as the vault and the radar: a canvas in a WebView, fed through
// window.__push, never fetching anything itself. Push the server's answer as
// it is (`{ updatedAt, guardians, events, totals }`, or the same under
// `type: 'state'`); the scene finds what is new by `sig`. The first push is
// history, drawn at once with the last three releases walked through again;
// later pushes are news and are played as they come.
//
// The three marks below belong to their owners. They are drawn, as the iris of
// each eye, only when the host says `{ type: 'config', logos: true }`; until
// then every eye keeps the app's gold iris. Whether they ship switched on is
// Alex's call.

export type GuardianSceneState = {
  updatedAt: number;
  guardians: Array<{ key: string; id: string | null; name: string | null; votes24h: number; votesTotal: number; lastVoteAt: number; medianSeconds24h: number | null }>;
  events: Array<{ kind: 'request' | 'vote'; at: number; slot?: number | null; sig: string; app: string; pkg?: string | null; versionCode?: number | null; guardian?: string | null; seconds?: number | null }>;
  totals?: { votes: number; apps: number; releases: number; since: number };
};

// Words the scene draws. `ago` and `lastVote` take `{age}`.
export type GuardianSceneLabels = Partial<Record<'live' | 'replay' | 'lapse' | 'releases' | 'votes' | 'apps' | 'ago' | 'lastVote' | 'waiting', string>>;

export type GuardianSceneMessage =
  | ({ type: 'state' } & GuardianSceneState)
  | { type: 'motion'; mode: 'live' | 'calm' | 'off' }
  | { type: 'pause'; on: boolean }
  | { type: 'inset'; top: number; bottom?: number }
  // Twenty four hours replayed in `seconds` (20 by default); `on: false` stops it.
  | { type: 'timelapse'; on: boolean; seconds?: number }
  // `mePkg` is this app's own package: its releases are drawn gold, with a
  // thread to the moon, the way Top's radar draws the person looking.
  | { type: 'config'; logos?: boolean; showPkg?: boolean; hud?: boolean; ambient?: boolean; orient?: 'auto' | 'v' | 'h'; mePkg?: string | null; meLabel?: string | null; labels?: GuardianSceneLabels };

export type GuardianSceneEvent =
  | { type: 'ready' }
  | { type: 'beat' }
  | { type: 'error'; message: string }
  | { type: 'timelapse'; state: 'start' | 'end' }
  | { type: 'tap'; kind: 'gate' }
  | { type: 'tap'; kind: 'guardian'; key: string; id: string | null; name: string | null; votes24h: number; votesTotal: number; lastVoteAt: number; medianSeconds24h: number | null }
  | { type: 'tap'; kind: 'request'; app: string; pkg: string | null; versionCode: number | null; sig: string | null; at: number; slot: number | null; votes: Array<{ guardian: string | null; id: string | null; name: string | null; seconds: number; at: number; slot: number | null; sig: string }> };

const LOGO_SOLANA_MOBILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAMAAAAOusbgAAAAwFBMVEX////+/v79/f38/Pz7+/v6+vr5+fn4+Pj29vbw8PDo6Oji4uLb29vT09PHx8fAwMC/v7+7u7u6urq5ubm1tbWsrKympqajo6OgoKCbm5uYmJiVlZWPj4+Ojo6KioqJiYmFhYV/f395eXl1dXVtbW1ra2tmZmZbW1tYWFhWVlZOTk5GRkZDQ0M+Pj47OzszMzMsLCwlJSUiIiIeHh4aGhoUFBQNDQ0MDAwKCgoGBgYFBQUEBAQDAwMCAgIBAQEAAABfN/TyAAACXklEQVR42u2ZXVcaMRCGw36hSEW2olZdFqWKVqlQUdtNMvP//1Vje7/JZOBsPZ25h+ck7M4886Kwo1ICFrCABSxgAQtYwAIWsIAFLGABR4ONppfdAhi6OTEYXFTVJa2q6RotE6xxqiLqzH2QBW7wWuUZsfJi75F54gZvVdYjnraXqjs0rN9Y451KydxM3bZddABY40OaULkqU9fupjhgjd/3egmVm6tp+3m9YIOrfRXB/YIaOGCDPw5USr/nCRrgNBCLL8MYbtlY4HQuwNdD9zVk7uFPsJyWCfatVP2UWIX69IKW1as13sc0yoPn1sYRcmLcTMblmFRleboO4u5CBCx/LIKx5DJWnCumgdgPddXsh8visjwa0epodPLMfp00nsc0kOGG20AsuNFUdNAy3cdXA/ow5g+JWP3I1LHhjcU/wpXFCNcJUwT+TiiyYjr1OWeqT6RUO3LNlL138pxuIVvQ2/fbntHJTuhvmEKPoPHC3R19hVm0vs4qaEk9VQV9aes/tLWwkCEB1k46WVOdfembup6Sqq5n67YgQXWURARnILqj8OX/y7lAb9u+/u2HC+BXXRKXmfHn4yU35wIDkQ2k4bVMjWd098qTwQp4J9ZY0YdE0tt/Yg6JBq8ixmKSPzLHYoNfo3K9e4+C+HOuRWSu1zBl71uSRmjm3Mf16u0yKteb+VTPAzb4FJXrXXjl1rfCrAf0fC0P0fn21Ac2Q9WnulYRtMDsIucahaxsnpzr9eqS+BdIVc3fwiKBHYgAbCHnijEtkJxLwAIWsIAFLGABC1jAAhawgAX84cC/AZ3pyyu8rNuqAAAAAElFTkSuQmCC';
const LOGO_JITO = 'data:image/png;base64,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';
const LOGO_HELIUS = 'data:image/png;base64,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';

export const GUARDIAN_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, U=1, DPR=Math.min(2,window.devicePixelRatio||1), TAU=Math.PI*2;
var TEXT='#F2F7FB', MUTED='#8296A8', FAINT='#6F849A', ACCENT='#56E0FF', GOLD='#C9A96A';
var GD='rgba(201,169,106,A)', CY='rgba(86,224,255,A)', MT='rgba(124,240,188,A)', WH='rgba(242,247,251,A)', RING='rgba(120,180,205,A)';
var LOGO_SRC={solana_mobile:'${LOGO_SOLANA_MOBILE}',jito:'${LOGO_JITO}',helius:'${LOGO_HELIUS}'}, LOGO={};
var GLYPH=new Image(); GLYPH.src='${GLYPH_DATA_URL}';
// The app's own eye, the one in the header and on the opening, as three paths.
var P_OUT=new Path2D('M12 50 C22 29 34 24 50 24 C66 24 78 29 88 50 C78 71 66 76 50 76 C34 76 22 71 12 50 Z'), P_L=new Path2D('M13 50 C24 37 34 33 50 33 L50 67 C34 67 24 63 13 50 Z'), P_R=new Path2D('M87 50 C76 37 66 33 50 33 L50 67 C66 67 76 63 87 50 Z'), P_LID=new Path2D('M12 50 C30 50 70 50 88 50');
// What the host may change. The marks are off until the host turns them on:
// they belong to their owners, and without one an eye keeps its gold iris.
var CFG={logos:false,showPkg:true,hud:true,ambient:true,orient:'auto',mePkg:null,meLabel:null,labels:{live:'LIVE',replay:'REPLAY',lapse:'24H',releases:'releases · 24h',votes:'votes',apps:'apps',ago:'{age} ago',lastVote:'last vote {age} ago',waiting:'waiting for the first release'}};
var S={t:0,idle:0,motion:'live',paused:false,insTop:0,insBot:0,off:0,has:false,G:[],rels:[],byApp:{},seen:{},actors:[],gazes:[],pings:[],sched:[],tl:null,sel:null,beatAt:0,amb:0,kick:0,ang:-1.2,totals:null,bg:null,bgKey:'',vert:true,cx:0,cy:0,Rg:30,R0:42,R1:150,ew:70,relCount:0,lastVoteAt:0};

function post(m){ try{ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); else if(window.parent&&window.parent!==window) window.parent.postMessage({__scene:m},'*'); }catch(e){} }
function col(c,a){ return c.replace('A)',a+')'); }
function clamp(x,a,b){ return x<a?a:x>b?b:x; }
function eo(k){ return 1-Math.pow(1-k,3); }
function eio(k){ return k<0.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2; }
function nowS(){ return Date.now()/1000+S.off; }
function fmt(n){ return String(Math.round(+n||0)).replace(/\B(?=(\d{3})+(?!\d))/g,' '); }
function age(sec){ sec=Math.max(0,Math.round(sec)); if(sec<60) return sec+'s'; if(sec<3600) return Math.round(sec/60)+'m'; if(sec<86400) return Math.round(sec/3600)+'h'; return Math.round(sec/86400)+'d'; }
function secs(s){ s=Math.max(0,Math.round(+s||0)); return s<100?s+'s':Math.floor(s/60)+'m'+(s%60<10?'0':'')+(s%60); }
function two(n){ return n<10?'0'+n:''+n; }
function shorten(s,n){ s=String(s||''); return s.length<=n?s:s.slice(0,Math.ceil(n/2)-1)+'…'+s.slice(s.length-Math.floor(n/2)+1); }
function hash(s){ var h=7; s=String(s); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%100003; return h/100003; }
// Where a moment sits on the 24 hour dial: midnight on top, clockwise, in the
// phone's own time.
function dayAngle(ts){ var d=new Date(ts*1000); return -Math.PI/2+TAU*(d.getHours()*60+d.getMinutes()+d.getSeconds()/60)/1440; }
// How far from the gate a release rests: the faster its last vote, the nearer.
function radius(sec){ return S.R0+(S.R1-S.R0)*clamp(Math.log(Math.max(3,sec)/3)/Math.log(200),0,0.93); }
function glow(color,x,y,r,a){ if(a<=0.004||r<=0) return; var g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,col(color,a)); g.addColorStop(0.35,col(color,a*0.45)); g.addColorStop(1,col(color,0)); ctx.fillStyle=g; ctx.fillRect(x-r,y-r,r*2,r*2); }
// The same phone the vault and the radar draw.
function phone(x,y,w,h,tone,lit,alpha){ var body=tone==='gold'?'#6b5630':'#2a3f4c', edge=tone==='gold'?'#e8cf95':'#5f8494', scr=lit?(tone==='gold'?'#ffe9b8':'#9ff6d2'):'#173a48'; ctx.save(); ctx.translate(x,y); ctx.globalAlpha=alpha==null?1:alpha; ctx.fillStyle=body; ctx.strokeStyle=edge; ctx.lineWidth=Math.max(0.6,w*0.09); ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,w*0.22); ctx.fill(); ctx.stroke(); ctx.fillStyle=scr; ctx.beginPath(); ctx.roundRect(-w/2+w*0.12,-h/2+h*0.09,w*0.76,h*0.82,w*0.14); ctx.fill(); ctx.restore(); }
// A guardian is an eye. The lids stand as far open as in the header's mark:
// wide when it has just voted, a closed lid when it has not for a day. With
// the marks switched on, the iris is the guardian's own.
function eye(x,y,w,gap,lx,ly,logo,hot){ var s=w/76, tone=gap<0.3?'#6C8593':ACCENT; gap=clamp(gap,0,1); ctx.save(); ctx.translate(x,y); ctx.scale(s,s); ctx.translate(-50,-50);
  ctx.save(); ctx.beginPath(); ctx.rect(0,50-26*gap,100,Math.max(52*gap,0.01)); ctx.clip();
  ctx.fillStyle='#070B0E'; ctx.fill(P_OUT); ctx.strokeStyle=tone; ctx.lineWidth=4; ctx.stroke(P_OUT);
  ctx.clip(P_OUT); ctx.fillStyle='#101A21'; ctx.fill(P_L); ctx.fillStyle='#16242D'; ctx.fill(P_R);
  ctx.beginPath(); ctx.arc(50+lx,50+ly,16,0,TAU); ctx.fillStyle='#050B10'; ctx.fill(); ctx.strokeStyle=hot>0.05?GOLD:'#3A5B68'; ctx.lineWidth=2.6; ctx.stroke();
  if(logo){ ctx.save(); ctx.beginPath(); ctx.arc(50+lx,50+ly,14.4,0,TAU); ctx.clip(); ctx.globalAlpha=0.5+0.5*gap; ctx.drawImage(logo,50+lx-14.4,50+ly-14.4,28.8,28.8); ctx.restore(); }
  else { ctx.globalAlpha=0.45+0.55*gap; ctx.beginPath(); ctx.arc(50+lx,50+ly,8.5+hot*1.6,0,TAU); ctx.fillStyle=hot>0.4?'#F1D9A2':GOLD; ctx.fill(); ctx.globalAlpha=1; ctx.beginPath(); ctx.arc(50+lx,50+ly,3.6,0,TAU); ctx.fillStyle='#020304'; ctx.fill(); if(gap>0.5){ ctx.beginPath(); ctx.arc(46.5+lx,46.5+ly,1.9,0,TAU); ctx.fillStyle='#F4FBFD'; ctx.fill(); } }
  ctx.restore();
  if(gap<0.3){ ctx.strokeStyle=tone; ctx.lineWidth=4; ctx.lineCap='round'; ctx.stroke(P_LID); }
  ctx.restore(); }

function size(){ if(window.innerWidth<2||window.innerHeight<2){ setTimeout(size,120); return; } W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); layout(); }
// The night every tab stands in (AppSky): the same gradient, the same breath of
// aurora high on the right, the teal glow low on the left, the same stars.
function sky(){ var key=W+'x'+H; if(S.bgKey===key) return; var bg=document.createElement('canvas'); bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR); var x=bg.getContext('2d'); x.scale(DPR,DPR);
  var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,'#060A11'); g.addColorStop(0.45,'#050910'); g.addColorStop(1,'#03060A'); x.fillStyle=g; x.fillRect(0,0,W,H);
  var au=x.createLinearGradient(0,H*0.02,0,H*0.3); au.addColorStop(0,'rgba(60,242,192,0)'); au.addColorStop(0.5,'rgba(60,242,192,0.045)'); au.addColorStop(1,'rgba(86,224,255,0)'); x.fillStyle=au; x.beginPath(); x.moveTo(W*0.35,H*0.02); x.bezierCurveTo(W*0.62,H*0.06,W*0.8,H*0.04,W*1.02,H*0.12); x.lineTo(W*1.02,H*0.3); x.bezierCurveTo(W*0.8,H*0.2,W*0.6,H*0.22,W*0.38,H*0.14); x.closePath(); x.fill();
  x.save(); x.translate(W*0.18,H*0.9); x.scale(W*0.7,H*0.35); var low=x.createRadialGradient(0,0,0,0,0,1); low.addColorStop(0,'rgba(18,128,143,0.07)'); low.addColorStop(1,'rgba(18,128,143,0)'); x.fillStyle=low; x.fillRect(-1,-1,2,2); x.restore();
  function hs(n){ var v=Math.sin(n*12.9898+78.233)*43758.5453; return v-Math.floor(v); }
  for(var i=0;i<54;i++){ x.globalAlpha=0.08+hs(i*13+4)*0.22; x.fillStyle='#D8F4FF'; x.beginPath(); x.arc(hs(i*3+1)*W,hs(i*7+2)*0.55*H,0.5+hs(i*11+3)*0.9,0,TAU); x.fill(); } x.globalAlpha=1; S.bg=bg; S.bgKey=key; }

// The radar takes the lower part of a tall canvas with the eyes in a shallow arc
// over it; on a wide one the radar goes left and the eyes stand in a column.
var EYE=[0,84,84,78,66,56,48];
function layout(){ sky(); var top=S.insTop, h=Math.max(40,H-S.insTop-S.insBot), n=Math.max(1,Math.min(6,S.G.length)), i, g, k;
  S.vert=CFG.orient==='auto'?h>=W*1.02:CFG.orient==='v';
  if(S.vert){ U=Math.min(W/360,h/540); S.cx=W/2; S.cy=top+h*0.605; S.R1=Math.min(W*0.40,h*0.285); S.ew=Math.min(EYE[n]*U,(W-12*U)/n-10*U);
    for(i=0;i<S.G.length;i++){ g=S.G[i]; g.x=6*U+(W-12*U)*(Math.min(i,n-1)+0.5)/n; k=(g.x-S.cx)/(W/2); g.y=top+64*U+20*U*k*k; } }
  else { U=Math.min(W/640,h/380); S.cx=W*0.34; S.cy=top+h*0.53; S.R1=Math.min(h*0.365,W*0.25); S.ew=Math.min(EYE[n]*0.86*U,(h-40*U)/n*0.9);
    for(i=0;i<S.G.length;i++){ g=S.G[i]; g.y=top+34*U+(h-74*U)*(Math.min(i,n-1)+0.5)/n; k=(g.y-(top+h/2))/(h/2); g.x=W*0.76-46*U*k*k; } }
  S.Rg=30*U; S.R0=S.Rg+13*U;
  S.rels.forEach(function(r){ r.rad=target(r); }); }

// ---------- state ----------
function findG(ref){ if(ref==null) return -1; for(var i=0;i<S.G.length;i++) if(S.G[i].key===ref||S.G[i].id===ref) return i; return -1; }
function findRel(app,vc,at){ var list=S.byApp[app]; if(!list) return null; for(var i=list.length-1;i>=0;i--){ var r=list[i]; if(r.at<=at+5&&(vc==null||r.vc==null||r.vc===vc)) return r; } return null; }
function onCount(r){ var n=0; for(var i=0;i<r.votes.length;i++) if(r.votes[i].on) n++; return n; }
function target(r){ var last=-1; for(var i=0;i<r.votes.length;i++) if(r.votes[i].on&&r.votes[i].seconds>last) last=r.votes[i].seconds; return last<0?S.R1:radius(last); }
function place(r){ return [S.cx+Math.cos(r.ang)*r.rad,S.cy+Math.sin(r.ang)*r.rad]; }
function addRel(e,implicit){ var at=implicit?e.at-(+e.seconds||0):e.at, sig=implicit?'implicit:'+e.sig:e.sig; var r={sig:sig,app:e.app,pkg:e.pkg||null,vc:e.versionCode==null?null:e.versionCode,at:at,slot:implicit?null:e.slot,votes:[],hide:false,actor:null,implicit:!!implicit,ang:dayAngle(at)+(hash(sig)-0.5)*0.09,rad:S.R1}; S.rels.push(r); (S.byApp[r.app]=S.byApp[r.app]||[]).push(r); S.byApp[r.app].sort(function(a,b){ return a.at-b.at; }); return r; }
function ingest(st){ var i, fresh=[], first=!S.has;
  if(typeof st.updatedAt==='number'&&st.updatedAt>0) S.off=st.updatedAt-Date.now()/1000;
  if(st.totals) S.totals=st.totals;
  if(st.guardians){ var old={}, changed=st.guardians.length!==S.G.length; S.G.forEach(function(g){ old[g.key]=g; });
    S.G=st.guardians.slice(0,6).map(function(g){ var o=old[g.key]||{o:0.14,hot:0,count:0,blinkAt:-9,nextBlink:2+Math.random()*5,seenAt:0,x:0,y:0}; if(!old[g.key]) changed=true;
      o.key=g.key; o.id=g.id||null; o.name=g.name||null; o.votes24h=+g.votes24h||0; o.votesTotal=+g.votesTotal||0; o.lastVoteAt=+g.lastVoteAt||0; o.median=g.medianSeconds24h==null?null:+g.medianSeconds24h; o.logo=o.id&&LOGO[o.id]||null; if(o.lastVoteAt>o.seenAt&&!S.tl) o.seenAt=o.lastVoteAt; return o; });
    if(changed) layout(); }
  var ev=(st.events||[]).slice().sort(function(a,b){ return a.at-b.at||(a.kind==='request'?-1:1); }), floor=nowS()-86400-900;
  for(i=0;i<ev.length;i++){ var e=ev[i]; if(!e||!e.sig||S.seen[e.sig]) continue; S.seen[e.sig]=1; if(e.at<floor) continue;
    if(e.kind==='request'){ fresh.push({rel:addRel(e,false)}); }
    else if(e.kind==='vote'){ var rel=findRel(e.app,e.versionCode==null?null:e.versionCode,e.at), made=false; if(!rel){ rel=addRel(e,true); made=true; }
      if(!rel.pkg&&e.pkg) rel.pkg=e.pkg;
      var v={sig:e.sig,at:e.at,slot:e.slot,g:e.guardian==null?null:e.guardian,seconds:e.seconds==null?Math.max(0,e.at-rel.at):+e.seconds,on:first,sched:false}; rel.votes.push(v); rel.votes.sort(function(a,b){ return a.at-b.at; });
      if(e.at>S.lastVoteAt) S.lastVoteAt=e.at; fresh.push({rel:rel,v:v,made:made}); } }
  // Yesterday falls off the dial.
  S.rels=S.rels.filter(function(r){ if(r.at>=floor||r.actor) return true; var l=S.byApp[r.app]; if(l){ var ix=l.indexOf(r); if(ix>=0) l.splice(ix,1); if(!l.length) delete S.byApp[r.app]; } return false; });
  S.rels.sort(function(a,b){ return a.at-b.at; });
  if(first){ S.has=true; S.rels.forEach(function(r){ r.rad=target(r); }); intro(); return; }
  if(S.tl){ fresh.forEach(function(f){ if(f.v) f.v.on=true; }); return; }
  // News: a request arrives at the rim, a guardian looks at it. Worth waking for.
  var came=[]; fresh.forEach(function(f){ S.idle=0; if(!f.v||f.made){ if(came.indexOf(f.rel)<0){ came.push(f.rel); spawn(f.rel,'live'); } } if(f.v) voteOn(f.rel,f.v,'live'); });
}
// The last few releases are walked through again on opening, oldest first, so
// the first look is at something happening, and every bit of it happened.
function intro(){ var pool=S.rels.filter(function(r){ return r.votes.length>0; }).slice(-3); pool.forEach(function(r,i){ r.hide=true; r.votes.forEach(function(v){ v.on=false; }); at(0.6+i*3.4,function(){ replay(r); }); }); S.amb=S.t+pool.length*3.4+4; }

// ---------- the moving parts ----------
function at(delay,fn){ S.sched.push({at:S.t+delay,fn:fn}); }
function seat(a){ a.x=S.cx+Math.cos(a.rel.ang)*a.rad; a.y=S.cy+Math.sin(a.rel.ang)*a.rad; }
function spawn(rel,mode){ if(rel.actor) return rel.actor; while(S.actors.length>=(mode==='lapse'?9:5)) retire(S.actors[0]); var d=mode==='lapse'?0.26:1.0; var a={rel:rel,mode:mode,phase:'in',pt:0,dur:d,rad:S.R1+150*U,to:S.R1,k:0.5,al:0,lit:[],stamp:null,pending:0,next:S.t+d+(mode==='lapse'?0.02:0.2),dockAt:S.t+d,lastEv:S.t+d,x:0,y:0}; rel.actor=a; rel.hide=true; S.actors.push(a); if(mode!=='replay') S.relCount++; seat(a); return a; }
function comp(sec,mode){ var k=Math.log(1+Math.max(0,sec)/3); return mode==='lapse'?0.04+0.09*k:0.4+0.75*k; }
function voteOn(rel,v,mode){ var a=rel.actor, when=S.t; if(a){ when=Math.max(S.t,a.next,a.dockAt+comp(v.seconds,mode)); a.next=when+(mode==='lapse'?0.1:0.55); a.pending++; } v.sched=true; S.sched.push({at:when,fn:function(){ gaze(rel,v,mode); }}); }
function replay(rel){ if(rel.actor||S.tl) return; rel.votes.forEach(function(v){ v.on=false; v.sched=false; }); spawn(rel,'replay'); rel.votes.forEach(function(v){ voteOn(rel,v,'replay'); }); }
// A vote: the guardian's eye turns gold and a thread of light runs from it to
// the phone it is voting on. When the thread arrives the vote has landed, and
// the eye blinks, the way the eye on the opening does.
function gaze(rel,v,mode){ var gi=findG(v.g), g=S.G[gi], f=mode==='lapse'?0.6:1; if(g){ g.hot=1; g.blinkAt=S.t+0.2*f+0.12; g.nextBlink=S.t+5+Math.random()*5; } S.gazes.push({rel:rel,v:v,gi:gi,mode:mode,t:0,d1:g?0.2*f:0,d2:0.75*f,landed:false}); }
function land(p){ var rel=p.rel, v=p.v, g=S.G[p.gi]||null, a=rel.actor, pos; if(a&&a.pending>0) a.pending--; if(v.on) return; v.on=true; S.kick=Math.max(S.kick,0.5);
  if(g){ if(S.tl) g.count++; if(v.at>g.seenAt) g.seenAt=v.at; }
  if(a){ a.lit.push(p.gi); a.lastEv=S.t; a.stamp={txt:'+'+secs(v.seconds),t:S.t}; pos=[a.x,a.y]; } else pos=place(rel);
  S.pings.push({x:pos[0],y:pos[1],t:S.t,big:false}); }
function retire(a){ var i=S.actors.indexOf(a); if(i>=0) S.actors.splice(i,1); var r=a.rel; r.actor=null; r.hide=false; r.votes.forEach(function(v){ if(v.sched||a.mode==='replay') v.on=true; }); r.rad=a.phase==='settle'?a.rad:target(r); }
function pick(){ var pool=S.rels.filter(function(r){ return r.votes.length>0&&!r.actor; }); if(!pool.length) return null; var k=Math.pow(Math.random(),1.8); return pool[pool.length-1-Math.floor(k*pool.length)]; }

// Twenty four hours in twenty seconds: the beam becomes the clock's hand, goes
// once round the dial, and every request and every vote happens again as it
// passes. The eyes wake and fall asleep on the way, as they did.
function lapse(sec){ var now=nowS(); S.actors.slice().forEach(retire); S.gazes.length=0; S.sched.length=0; S.pings.length=0;
  S.rels.forEach(function(r){ r.hide=true; r.rad=S.R1; r.votes.forEach(function(v){ v.on=false; v.sched=false; }); }); S.G.forEach(function(g){ g.count=0; g.seenAt=0; g.hot=0; });
  var ev=[]; S.rels.forEach(function(r){ if(r.at>=now-86400) ev.push({at:r.at,rel:r}); r.votes.forEach(function(v){ ev.push({at:v.at,rel:r,v:v}); }); }); ev.sort(function(a,b){ return a.at-b.at||(a.v?1:-1); });
  S.relCount=0; S.tl={t0:S.t+0.6,dur:Math.max(6,+sec||20),from:now-86400,ev:ev,i:0,vt:now-86400}; S.idle=0; post({type:'timelapse',state:'start'}); }
function lapseEnd(){ S.tl=null; S.actors.slice().forEach(retire); S.gazes.length=0; S.sched.length=0; S.rels.forEach(function(r){ r.hide=false; r.votes.forEach(function(v){ v.on=true; v.sched=false; }); }); S.G.forEach(function(g){ g.seenAt=Math.max(g.seenAt,g.lastVoteAt); }); S.amb=S.t+4; post({type:'timelapse',state:'end'}); }
function awake(g){ if(!g.seenAt) return 0.14; var gone=(S.tl?S.tl.vt:nowS())-g.seenAt; if(S.tl) return gone<5400?1:gone<14400?0.72:gone<28800?0.44:0.14; return gone<7200?1:gone<28800?0.78:gone<86400?0.5:0.14; }

function step(dt,coarse){ var i; S.t+=dt; S.idle+=dt; S.kick=Math.max(0,S.kick-dt*1.8);
  if(S.tl){ var k=(S.t-S.tl.t0)/S.tl.dur; S.tl.vt=S.tl.from+clamp(k,0,1)*86400; S.ang=dayAngle(S.tl.vt);
    while(S.tl.i<S.tl.ev.length&&S.tl.ev[S.tl.i].at<=S.tl.vt){ var e=S.tl.ev[S.tl.i++]; if(!e.v) spawn(e.rel,'lapse'); else { if(!e.rel.actor&&e.rel.hide) e.rel.hide=false; voteOn(e.rel,e.v,'lapse'); } }
    if(k>=1&&((!S.actors.length&&!S.gazes.length&&!S.sched.length)||k>1.35)) lapseEnd(); }
  else S.ang+=dt*TAU/11;
  if(S.sched.length){ var due=[], keep=[]; for(i=0;i<S.sched.length;i++) (S.sched[i].at<=S.t?due:keep).push(S.sched[i]); S.sched=keep; due.sort(function(a,b){ return a.at-b.at; }); for(i=0;i<due.length;i++) due[i].fn(); }
  for(i=0;i<S.G.length;i++){ var g=S.G[i]; g.hot=Math.max(0,g.hot-dt*1.3); g.o+=(awake(g)-g.o)*Math.min(1,dt*3); if(S.t>g.nextBlink){ g.nextBlink=S.t+4+Math.random()*6; if(g.o>0.3&&S.t-g.blinkAt>1) g.blinkAt=S.t; } }
  for(i=S.gazes.length-1;i>=0;i--){ var p=S.gazes[i]; p.t+=coarse?9:dt; if(!p.landed&&p.t>=p.d1){ p.landed=true; land(p); } if(p.t>=p.d1+p.d2) S.gazes.splice(i,1); }
  for(i=S.pings.length-1;i>=0;i--) if(S.t-S.pings[i].t>(S.pings[i].big?1.1:0.7)) S.pings.splice(i,1);
  for(i=0;i<S.rels.length;i++){ var r=S.rels[i]; if(!r.actor) r.rad+=(target(r)-r.rad)*Math.min(1,dt*5); }
  for(i=S.actors.length-1;i>=0;i--){ var a=S.actors[i], fast=a.mode==='lapse';
    if(a.phase==='in'){ a.pt+=dt/a.dur; var q=eo(clamp(a.pt,0,1)); a.rad=S.R1+150*U*(1-q); a.k=0.5+0.5*q; a.al=clamp(a.pt*2.2,0,1); if(a.pt>=1){ a.phase='wait'; a.rad=S.R1; a.k=1; a.al=1; } }
    else if(a.phase==='wait'){ a.rad=S.R1; var full=S.G.length>0&&a.lit.length>=S.G.length, linger=fast?0.3:a.mode==='replay'?1.3:(full?1.8:80); if(!a.pending&&S.t>a.lastEv+linger){ a.phase='settle'; a.pt=0; a.to=target(a.rel); if(full){ S.pings.push({x:a.x,y:a.y,t:S.t,big:true}); S.kick=1; } } }
    else { a.pt+=dt/(fast?0.3:0.8); var z=eio(clamp(a.pt,0,1)); a.rad=S.R1+(a.to-S.R1)*z; a.k=1-z*0.58; if(a.pt>=1){ a.rad=a.to; seat(a); retire(a); continue; } }
    seat(a); }
  // Between real events the scene looks back: one past release, said to be past.
  if(CFG.ambient&&!coarse&&!S.tl&&S.has&&!S.actors.length&&!S.sched.length&&S.t>S.amb){ var r2=pick(); if(r2) replay(r2); S.amb=S.t+9+Math.random()*7; }
}

// ---------- drawing ----------
function moon(cx,cy,R){ var body=ctx.createRadialGradient(cx-R*0.35,cy-R*0.45,R*0.1,cx,cy,R); body.addColorStop(0,'rgba(16,36,50,0.94)'); body.addColorStop(1,'rgba(4,10,16,0.97)'); ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.fillStyle=body; ctx.fill(); ctx.lineWidth=1.2; ctx.strokeStyle='rgba(140,190,215,0.18)'; ctx.stroke();
  if(GLYPH.complete&&GLYPH.naturalWidth>0){ if(!S.mono){ S.mono=document.createElement('canvas'); S.mono.width=256; S.mono.height=256; var gx=S.mono.getContext('2d'); gx.drawImage(GLYPH,0,0,256,256); gx.globalCompositeOperation='source-in'; gx.fillStyle='rgba(150,200,225,1)'; gx.fillRect(0,0,256,256); } ctx.save(); ctx.globalAlpha=0.13; ctx.drawImage(S.mono,cx-R,cy-R,R*2,R*2); ctx.restore(); }
  var hz=ctx.createLinearGradient(0,cy+R*0.45,0,cy+R); hz.addColorStop(0,'rgba(10,26,38,0)'); hz.addColorStop(1,'rgba(11,31,43,0.6)'); ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.clip(); ctx.fillStyle=hz; ctx.fillRect(cx-R-2,cy+R*0.45,R*2+4,R*0.55+2); ctx.restore(); }
function drawRadar(now){ var i, a, marks=[[10,'10S'],[30,'30S'],[120,'2M']];
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='700 '+Math.round(7.5*U)+'px monospace';
  for(i=0;i<marks.length;i++){ var rr=radius(marks[i][0]); ctx.beginPath(); ctx.arc(S.cx,S.cy,rr,0,TAU); ctx.strokeStyle=col(RING,0.14+0.2*S.kick); ctx.lineWidth=1; ctx.stroke(); ctx.fillStyle=col(RING,0.55); ctx.fillText(marks[i][1],S.cx+rr*0.7071,S.cy+rr*0.7071); }
  ctx.beginPath(); ctx.arc(S.cx,S.cy,S.R1,0,TAU); ctx.strokeStyle=col(RING,0.26+0.3*S.kick); ctx.lineWidth=1; ctx.stroke();
  for(i=0;i<24;i++){ a=-Math.PI/2+TAU*i/24; var l=(i%6===0?5:2.2)*U; ctx.strokeStyle=col(RING,i%6===0?0.6:0.3); ctx.beginPath(); ctx.moveTo(S.cx+Math.cos(a)*S.R1,S.cy+Math.sin(a)*S.R1); ctx.lineTo(S.cx+Math.cos(a)*(S.R1+l),S.cy+Math.sin(a)*(S.R1+l)); ctx.stroke(); }
  ctx.fillStyle=col(RING,0.5); ctx.font='600 '+Math.round(7.5*U)+'px monospace'; for(i=0;i<4;i++){ a=-Math.PI/2+TAU*i/4; ctx.fillText(two(i*6),S.cx+Math.cos(a)*(S.R1+13*U),S.cy+Math.sin(a)*(S.R1+13*U)); }
  // The beam, as on Top's radar. In the timelapse it is the hand of the clock.
  var g=ctx.createConicGradient(S.ang,S.cx,S.cy); g.addColorStop(0,col(CY,0)); g.addColorStop(0.86,col(CY,0)); g.addColorStop(1,col(CY,S.tl?0.26:0.2)); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(S.cx,S.cy,S.R1,0,TAU); ctx.fill();
  ctx.strokeStyle=col(CY,0.6); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(S.cx,S.cy); ctx.lineTo(S.cx+Math.cos(S.ang)*S.R1,S.cy+Math.sin(S.ang)*S.R1); ctx.stroke();
  // Now, in gold on the rim: where the next request will arrive.
  if(!S.tl){ a=dayAngle(now); var nx=S.cx+Math.cos(a)*S.R1, ny=S.cy+Math.sin(a)*S.R1; glow(GD,nx,ny,9*U,0.5+0.2*Math.sin(S.t*2.2)); ctx.strokeStyle=GOLD; ctx.lineWidth=1.6*U; ctx.beginPath(); ctx.moveTo(S.cx+Math.cos(a)*(S.R1-4*U),S.cy+Math.sin(a)*(S.R1-4*U)); ctx.lineTo(S.cx+Math.cos(a)*(S.R1+7*U),S.cy+Math.sin(a)*(S.R1+7*U)); ctx.stroke(); } }
function drawBlips(now){ var n=Math.max(1,S.G.length), i, selG=S.sel&&S.sel.g?S.sel.g:null;
  for(i=0;i<S.rels.length;i++){ var r=S.rels[i]; if(r.hide) continue; var p=place(r), on=onCount(r), old=clamp((now-r.at)/86400,0,1), al=0.5+0.5*Math.pow(1-old,1.5), da=((S.ang-r.ang)%TAU+TAU)%TAU, lit=Math.max(0,1-da/2.2), full=on>=n, me=CFG.mePkg&&r.pkg===CFG.mePkg, sel=S.sel&&S.sel.rel===r;
    if(me){ ctx.strokeStyle=col(GD,0.5); ctx.setLineDash([2,3]); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(S.cx,S.cy); ctx.lineTo(p[0],p[1]); ctx.stroke(); ctx.setLineDash([]); glow(GD,p[0],p[1],(20+lit*14)*U,0.85); phone(p[0],p[1],6.6*U,11.4*U,'gold',true,1); ctx.fillStyle=GOLD; ctx.font='700 '+Math.round(8*U)+'px monospace'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(CFG.meLabel||r.pkg,clamp(p[0],40*U,W-40*U),p[1]+8*U); continue; }
    if(sel) glow(CY,p[0],p[1],15*U,0.8); else if(selG&&r.votes.some(function(v){ return v.on&&(v.g===selG.key||v.g===selG.id); })) glow(GD,p[0],p[1],11*U,0.55); else if(full||lit>0.1) glow(MT,p[0],p[1],9*U,(full?0.16:0)+0.3*lit);
    phone(p[0],p[1],4.8*U,8.3*U,'in',on>0&&(full||lit>0.12||sel),al*(on>0?1:0.6)); } }
function drawEyes(){ var n=S.G.length, small=n>=5, i, look=S.actors.length?S.actors[S.actors.length-1]:null;
  for(i=0;i<n;i++){ var g=S.G[i], w=S.ew, sel=S.sel&&S.sel.g===g, e=S.t-g.blinkAt, lid=e<0?1:e<0.11?1-e/0.11:e<0.17?0:e<0.36?(e-0.17)/0.19:1, gap=Math.max(0.02,g.o*lid), tx=look?look.x:S.cx, ty=look?look.y:S.cy, dx=tx-g.x, dy=ty-g.y, d=Math.sqrt(dx*dx+dy*dy)||1, lx=dx/d*5.2+(look?0:Math.sin(S.t*0.4+i*2.1)*2.4), ly=dy/d*3.4;
    glow(CY,g.x,g.y,w*1.05,0.07+0.05*g.o+(sel?0.12:0)); if(g.hot>0) glow(GD,g.x,g.y,w*1.2,0.32*g.hot);
    eye(g.x,g.y,w,gap,lx,ly,CFG.logos&&g.logo&&g.logo.complete&&g.logo.naturalWidth>0?g.logo:null,g.hot);
    // Under the eye on a tall canvas; beside it on a wide one, where the eyes
    // stand in a column and a line under one would land on the next.
    var votes=S.tl?g.count:g.votes24h, tx0=S.vert?g.x:g.x+w/2+10*U, ly0=S.vert?g.y+w*0.36+13*U:g.y-1*U; ctx.textAlign=S.vert?'center':'left'; ctx.textBaseline='alphabetic';
    ctx.fillStyle=g.o>0.3?TEXT:MUTED; ctx.font='600 '+Math.round((small?9.5:11)*U)+'px sans-serif'; ctx.fillText(shorten(g.name||g.key,small?13:18),tx0,ly0);
    ctx.fillStyle=MUTED; ctx.font='600 '+Math.round((small?8:9)*U)+'px monospace'; ctx.fillText(fmt(votes)+' '+CFG.labels.votes+(g.median!=null&&!small&&!S.tl?' · '+secs(g.median):''),tx0,ly0+(small?10.5:12)*U); } }
function drawGazes(){ for(var i=0;i<S.gazes.length;i++){ var p=S.gazes[i], g=S.G[p.gi]; if(!g) continue; var a=p.rel.actor, to=a?[a.x,a.y]:place(p.rel), u=p.d1>0?clamp(p.t/p.d1,0,1):1, hx=g.x+(to[0]-g.x)*u, hy=g.y+(to[1]-g.y)*u, al=p.landed?Math.pow(clamp(1-(p.t-p.d1)/p.d2,0,1),1.4):1;
    ctx.lineCap='round'; ctx.strokeStyle=col(GD,0.16*al); ctx.lineWidth=6*U; ctx.beginPath(); ctx.moveTo(g.x,g.y); ctx.lineTo(hx,hy); ctx.stroke();
    ctx.strokeStyle=col(GD,0.9*al); ctx.lineWidth=1.3*U; ctx.beginPath(); ctx.moveTo(g.x,g.y); ctx.lineTo(hx,hy); ctx.stroke();
    glow(p.landed?GD:WH,hx,hy,(p.landed?12:9)*U,0.9*al); } }
function drawActors(now){ var i, j, newest=S.actors.length-1, n=S.G.length;
  for(i=0;i<S.actors.length;i++){ var a=S.actors[i], r=a.rel, pw=11*U*a.k, ph=19*U*a.k, al=a.al, full=n>0&&a.lit.length>=n, me=CFG.mePkg&&r.pkg===CFG.mePkg, upper=a.y<S.cy;
    glow(me||full?GD:MT,a.x,a.y,22*U*a.k,(full?0.4:0.2)*al);
    phone(a.x,a.y,pw,ph,me?'gold':'in',a.lit.length>0,al);
    if(a.phase==='settle') continue;
    var m=Math.max(n,a.lit.length), gapX=5.6*U, x0=a.x-(m-1)*gapX/2, py=a.y+(upper?1:-1)*(ph/2+6.5*U);
    for(j=0;j<m;j++){ ctx.beginPath(); ctx.arc(x0+j*gapX,py,1.8*U,0,TAU); ctx.fillStyle=j<a.lit.length?GOLD:'rgba(70,88,107,'+al+')'; ctx.fill(); }
    if(a.stamp){ var k=(S.t-a.stamp.t)/1.2; if(k<1){ var left=a.x>W-70*U; ctx.fillStyle=col(GD,1-k*k); ctx.font='700 '+Math.round(11*U)+'px monospace'; ctx.textAlign=left?'right':'left'; ctx.textBaseline='middle'; ctx.fillText(a.stamp.txt,a.x+(left?-1:1)*(pw/2+7*U),a.y-k*8*U); } }
    if(i>=newest-1&&a.phase!=='in'){ var ly=a.y+(upper?-1:1)*(ph/2+(upper?9:16)*U), down=(upper?-1:1)*11*U; ctx.textBaseline='alphabetic'; ctx.textAlign='center'; ctx.font='600 '+Math.round(9.5*U)+'px monospace';
      var txt=CFG.showPkg&&r.pkg?shorten(me&&CFG.meLabel?CFG.meLabel:r.pkg,24):'', half=ctx.measureText(txt).width/2+6*U, lx=clamp(a.x,half,W-half);
      if(txt){ ctx.fillStyle=col(WH,(i===newest?0.92:0.6)*al); ctx.fillText(txt,lx,ly); ly+=down; }
      if(a.mode==='replay'){ ctx.fillStyle=FAINT; ctx.font='600 '+Math.round(8.5*U)+'px monospace'; ctx.fillText(CFG.labels.ago.replace('{age}',age(now-r.at)),lx,ly); } } } }
function drawPings(){ for(var i=0;i<S.pings.length;i++){ var p=S.pings[i], k=(S.t-p.t)/(p.big?1.1:0.7); if(k>=1) continue; ctx.strokeStyle=col(GD,0.85*(1-k)); ctx.lineWidth=(p.big?2:1.5)*U; ctx.beginPath(); ctx.arc(p.x,p.y,(p.big?12:8)*U+eo(k)*(p.big?52:18)*U,0,TAU); ctx.stroke(); } }
function drawHud(now){ if(!CFG.hud) return; var y=S.insTop+16*U, x=14*U, L=CFG.labels, replaying=S.actors.some(function(a){ return a.mode==='replay'; }), word=S.tl?L.lapse:replaying?L.replay:L.live, tone=S.tl?GOLD:replaying?FAINT:'#7CF0BC';
  ctx.textBaseline='middle'; ctx.textAlign='left'; ctx.beginPath(); ctx.arc(x+3*U,y,3*U*(S.tl||replaying?1:0.8+0.2*Math.sin(S.t*3)),0,TAU); ctx.fillStyle=tone; ctx.fill();
  ctx.fillStyle=tone; ctx.font='700 '+Math.round(10*U)+'px sans-serif'; ctx.fillText(word,x+11*U,y+0.5); var wd=ctx.measureText(word).width;
  ctx.fillStyle=MUTED; ctx.font='600 '+Math.round(9.5*U)+'px monospace';
  if(S.tl){ var d=new Date(S.tl.vt*1000); ctx.fillText(two(d.getDate())+'.'+two(d.getMonth()+1)+' · '+two(d.getHours())+':'+two(d.getMinutes()),x+19*U+wd,y+0.5); }
  else if(S.lastVoteAt){ ctx.fillText(L.lastVote.replace('{age}',age(now-S.lastVoteAt)),x+19*U+wd,y+0.5); }
  if(S.totals){ ctx.textAlign='right'; ctx.fillStyle=FAINT; ctx.font='600 '+Math.round(9*U)+'px monospace'; ctx.fillText(fmt(S.totals.votes)+' '+L.votes+' · '+fmt(S.totals.apps)+' '+L.apps,W-14*U,y+0.5); }
  if(S.tl){ var k=clamp((S.t-S.tl.t0)/S.tl.dur,0,1); ctx.fillStyle=col(RING,0.16); ctx.fillRect(14*U,y+12*U,W-28*U,1.5); ctx.fillStyle=GOLD; ctx.fillRect(14*U,y+12*U,(W-28*U)*k,1.5); } }
function draw(){ if(W<2) return; var now=S.tl?S.tl.vt:nowS(), i, live=0; ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,W,H); if(S.bg) ctx.drawImage(S.bg,0,0,W,H);
  for(i=0;i<S.rels.length;i++) if(S.rels[i].at>=now-86400) live++;
  glow(CY,S.cx,S.cy,S.R1*1.15,0.05+0.02*Math.sin(S.t*0.9)+0.08*S.kick);
  drawRadar(now); drawBlips(now);
  moon(S.cx,S.cy,S.Rg); if(S.kick>0){ ctx.strokeStyle=col(GD,0.6*S.kick); ctx.lineWidth=1.6*U; ctx.beginPath(); ctx.arc(S.cx,S.cy,S.Rg+(1-S.kick)*6*U,0,TAU); ctx.stroke(); }
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(S.has){ ctx.fillStyle=TEXT; ctx.font='700 '+Math.round(S.Rg*0.72)+'px sans-serif'; ctx.fillText(String(S.tl?S.relCount:live),S.cx,S.cy-S.Rg*0.1); ctx.fillStyle=MUTED; ctx.font='600 '+Math.round(Math.max(6.5,S.Rg*0.2))+'px sans-serif'; ctx.fillText(CFG.labels.releases,S.cx,S.cy+S.Rg*0.44); }
  else { ctx.fillStyle=FAINT; ctx.font='600 '+Math.round(10*U)+'px sans-serif'; ctx.fillText(CFG.labels.waiting,S.cx,S.cy+S.R1+30*U); }
  drawEyes(); drawGazes(); drawActors(now); drawPings(); drawHud(now);
  if(S.sel&&S.t-S.sel.t>6) S.sel=null; }

// ---------- in and out ----------
window.__push=function(m){ try{ if(!m) return; var t=m.type;
  if(!t||t==='state'){ var st=m.state||m; if(st.guardians||st.events) ingest(st); }
  else if(t==='motion'){ S.motion=m.mode==='calm'||m.mode==='off'?m.mode:'live'; S.idle=0; }
  else if(t==='pause'){ S.paused=!!m.on; }
  else if(t==='inset'){ S.insTop=+m.top||0; S.insBot=+m.bottom||0; layout(); }
  else if(t==='timelapse'){ if(m.on===false){ if(S.tl) lapseEnd(); } else if(S.has) lapse(m.seconds); }
  else if(t==='config'){ ['logos','showPkg','hud','ambient','orient','mePkg','meLabel'].forEach(function(k){ if(m[k]!==undefined) CFG[k]=m[k]; }); if(m.labels) for(var k in m.labels) if(typeof m.labels[k]==='string') CFG.labels[k]=m.labels[k]; layout(); }
  draw(); }catch(e){} };
function hit(x,y){ var i, best=null, bd=1e9, d, p;
  for(i=0;i<S.G.length;i++){ var g=S.G[i]; if(S.vert?(Math.abs(x-g.x)<S.ew/2+8*U&&y>g.y-S.ew*0.42&&y<g.y+S.ew*0.36+30*U):(x>g.x-S.ew/2-8*U&&x<g.x+S.ew/2+110*U&&Math.abs(y-g.y)<S.ew*0.42+4*U)) return {g:g}; }
  for(i=0;i<S.actors.length;i++){ d=Math.hypot(x-S.actors[i].x,y-S.actors[i].y); if(d<24*U&&d<bd){ bd=d; best={rel:S.actors[i].rel}; } }
  if(best) return best;
  if(Math.hypot(x-S.cx,y-S.cy)<S.Rg) return {gate:true};
  for(i=0;i<S.rels.length;i++){ if(S.rels[i].hide) continue; p=place(S.rels[i]); d=Math.hypot(x-p[0],y-p[1]); if(d<16*U&&d<bd){ bd=d; best={rel:S.rels[i]}; } }
  return best; }
cv.addEventListener('click',function(e){ S.idle=0; var h=hit(e.clientX,e.clientY); if(!h){ S.sel=null; return; }
  if(h.gate){ post({type:'tap',kind:'gate'}); return; }
  S.sel={g:h.g||null,rel:h.rel||null,t:S.t};
  if(h.g) post({type:'tap',kind:'guardian',key:h.g.key,id:h.g.id,name:h.g.name,votes24h:h.g.votes24h,votesTotal:h.g.votesTotal,lastVoteAt:h.g.lastVoteAt,medianSeconds24h:h.g.median});
  else { var r=h.rel; post({type:'tap',kind:'request',app:r.app,pkg:r.pkg,versionCode:r.vc,sig:r.implicit?null:r.sig,at:r.at,slot:r.slot,votes:r.votes.map(function(v){ var g=S.G[findG(v.g)]; return {guardian:g?g.key:v.g,id:g?g.id:null,name:g?g.name:null,seconds:v.seconds,at:v.at,slot:v.slot,sig:v.sig}; })}); } });
document.addEventListener('touchstart',function(){ S.idle=0; },{passive:true});
// In a browser the prototype's page stands where React Native would.
if(!window.ReactNativeWebView){ window.__S=S; window.addEventListener('message',function(e){ if(e.data&&e.data.__push) window.__push(e.data.__push); }); }
Object.keys(LOGO_SRC).forEach(function(id){ if(LOGO_SRC[id].indexOf('data:')===0){ var im=new Image(); im.src=LOGO_SRC[id]; LOGO[id]=im; } });

// For a test and for the prototype's page: run the scene forward by hand.
window.__advance=function(sec){ var n=Math.round((sec||1)*30); for(var i=0;i<n;i++) step(1/30,false); draw(); };
var last=performance.now(), acc=0;
function loop(now){ var dt=Math.min(0.05,(now-last)/1000); last=now; acc+=dt;
  if(now-S.beatAt>3000){ S.beatAt=now; post({type:'beat'}); }
  var slow=!S.tl&&(S.motion!=='live'||S.idle>90);
  if(!S.paused){ try{ if(slow){ if(acc>=1){ step(acc,true); acc=0; draw(); } } else { acc=0; step(dt,false); draw(); } }catch(err){ var msg=String(err&&err.stack||err).slice(0,400); if(S.err!==msg){ S.err=msg; post({type:'error',message:msg}); } } }
  requestAnimationFrame(loop); }
size(); draw(); requestAnimationFrame(loop); window.addEventListener('resize',size); post({type:'ready'});
})();
</script></body></html>`;
