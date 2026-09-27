// The Iris: the whole network drawn as one eye, on a canvas inside a WebView.
//
// Nine rings around a black pupil. Every open Eye is a small ring on one of
// them: the outermost for a streak of nought or one, closer in as the streak
// grows, the innermost, in gold, for the Perfect Eyes. The Eyes that blinked
// today are lit; the rest are dim. Your own is ringed in gold with a callout.
//
// Where an Eye sits is a pure function of its serial and its ring — the
// golden angle times the serial, a little radial scatter from a hash of the
// serial — so the same Eye is in the same place every time anyone looks, and
// a blink that arrives for a serial not in the list still lands where that
// Eye would be.
//
// It draws once, into an offscreen base, and again only when the picture
// changes. The only frames it ever runs are the flashes: a blink arriving
// for a ring lights it for six hundred milliseconds, and when a burst of
// them lands together they ripple outward from the pupil. No idle loop, no
// shimmer, nothing for the battery to pay for between blinks.
//
// It lives in a WebView for the same reason the vault does: the canvas is
// proven, and the app's Skia is not linked. Everything it knows arrives
// through window.__push; it never fetches anything itself.
//
// Since 27.09 evening (Alex): every Eye is drawn as a small copy of the NFT's
// own eye, a glowing ring round a gold iris, open if it blinked today and
// shut (a seam across the lens) if it has not; past three hundred Eyes they
// fall back to the small rings above so the picture still reads. Each rail
// carries the streak it stands for (30+, 21, 14 … 1), so the rings explain
// themselves. The pupil holds the Eye itself, the NFT's portal, laid over the
// centre by the React side (it blinks); round it a light walks the rim, the
// one thing here that moves between blinks, while the tab is in front.

export const IRIS_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, DPR=Math.min(2,window.devicePixelRatio||1);
var GOLDEN=2.399963229728653, RINGS=9;
var LIT='rgba(124,240,188,1)', DIM='rgba(111,132,154,1)', GOLD='rgba(232,207,149,1)', CY='rgba(86,224,255,1)';
// The model: what the React side last said, plus the one thing the stream
// changes between reads (an Eye that blinked).
var M={eyes:[],bySerial:{},ringCounts:null,me:null,callout:null,empty:true,dotR:2.6,er:11};
var base=null, baseDirty=true;
var flashes=[], animating=false, paused=false, burst=[];
// The streak each rail stands for, innermost first (src/iris.mjs in the service).
var RAIL=['30+','21','14','10','7','5','3','2','1'];


function hash(n){ n=n|0; n=(n^61)^(n>>>16); n=n+(n<<3); n=n^(n>>>4); n=Math.imul(n,0x27d4eb2d); n=n^(n>>>15); return (n>>>0)/4294967296; }
function geom(){ var S=Math.min(W,H); return {cx:W/2,cy:H/2,S:S,pupil:S*0.165,r0:S*0.215,step:S*0.0325}; }
// Ring 0 is the innermost. The scatter across the band is deterministic too.
function place(serial,ring,g){ var R=g.r0+ring*g.step, a=serial*GOLDEN+ring*0.9, rr=R+(hash(serial)-0.5)*g.step*0.6; return {x:g.cx+rr*Math.cos(a),y:g.cy+rr*Math.sin(a)}; }
function placeGhost(i,ring,g){ var R=g.r0+ring*g.step, a=(i+0.5)*GOLDEN+ring*0.9+1.7, rr=R+(hash(i*7919+ring*31)-0.5)*g.step*0.6; return {x:g.cx+rr*Math.cos(a),y:g.cy+rr*Math.sin(a)}; }
// Smaller rings as the network grows, so two thousand still read as rings.
function dotRadius(total){ if(total<=400) return 3.4; if(total<=900) return 3; if(total<=1800) return 2.6; if(total<=3200) return 2.2; return 1.9; }
// Up to three hundred, every Eye is drawn as an eye; the fewer there are, the
// bigger. Nought means dots.
function eyeRadius(total){ if(total<=12) return 11; if(total<=40) return 8.5; if(total<=120) return 6.5; if(total<=300) return 5; return 0; }

var glowCache={};
function glow(color,r){ var k=color+'|'+Math.round(r*4); if(glowCache[k]) return glowCache[k]; var c=document.createElement('canvas'); c.width=c.height=Math.max(2,Math.ceil(r*2*DPR)); var x=c.getContext('2d'); x.scale(DPR,DPR); var gr=x.createRadialGradient(r,r,0,r,r,r); gr.addColorStop(0,color); gr.addColorStop(0.3,color.replace(/[\d.]+\)$/,'0.4)')); gr.addColorStop(1,color.replace(/[\d.]+\)$/,'0)')); x.fillStyle=gr; x.fillRect(0,0,r*2,r*2); glowCache[k]=c; return c; }
function drawGlow(c,color,x,y,r,a){ c.globalAlpha=a==null?1:a; c.drawImage(glow(color,r),x-r,y-r,r*2,r*2); c.globalAlpha=1; }
function ring(c,p,r,color,width,alpha){ c.globalAlpha=alpha; c.strokeStyle=color; c.lineWidth=width; c.beginPath(); c.arc(p.x,p.y,r,0,6.2832); c.stroke(); c.globalAlpha=1; }
function dot(c,p,r,color,alpha){ c.globalAlpha=alpha; c.fillStyle=color; c.beginPath(); c.arc(p.x,p.y,r,0,6.2832); c.fill(); c.globalAlpha=1; }
// One Eye as the NFT draws it, small: the glowing ring, the dark lens, the
// gold iris with its pupil and glint. Shut (a seam, no iris) when it has not
// blinked today. Gold ring for a Perfect Eye.
function eyeGlyph(c,p,r,open,perfect){
  var tone=perfect?GOLD:open?'rgba(110,240,255,1)':'rgba(96,120,140,1)';
  if(open) drawGlow(c,perfect?GOLD:CY,p.x,p.y,r*2.7,perfect?0.55:0.5);
  c.strokeStyle=tone; c.lineWidth=Math.max(1.2,r*0.26); c.globalAlpha=open?1:0.7; c.beginPath(); c.arc(p.x,p.y,r,0,6.2832); c.stroke(); c.globalAlpha=1;
  c.fillStyle='#050B10'; c.beginPath(); c.arc(p.x,p.y,r*0.76,0,6.2832); c.fill();
  if(!open){ c.strokeStyle='rgba(58,91,104,1)'; c.lineWidth=Math.max(0.9,r*0.13); c.beginPath(); c.moveTo(p.x-r*0.56,p.y); c.lineTo(p.x+r*0.56,p.y); c.stroke(); return; }
  var ir=r*0.44, gr=c.createRadialGradient(p.x-ir*0.2,p.y-ir*0.25,0,p.x,p.y,ir); gr.addColorStop(0,'#F0D898'); gr.addColorStop(0.55,'#D6B56A'); gr.addColorStop(1,'#5A4219');
  c.fillStyle=gr; c.beginPath(); c.arc(p.x,p.y,ir,0,6.2832); c.fill();
  c.fillStyle='#020304'; c.beginPath(); c.arc(p.x,p.y,ir*0.46,0,6.2832); c.fill();
  if(r>=6){ c.fillStyle='rgba(244,251,253,0.92)'; c.beginPath(); c.arc(p.x-ir*0.42,p.y-ir*0.46,ir*0.22,0,6.2832); c.fill(); } }

function boxHitsPupil(bx,by,bw,bh,g){ var nx=Math.max(bx,Math.min(bx+bw,g.cx)), ny=Math.max(by,Math.min(by+bh,g.cy)); return Math.hypot(nx-g.cx,ny-g.cy)<g.pupil+8; }
// The callout: a plate near your ring, on the side away from the pupil,
// pushed further out if it would still cover the pupil, and a hair of gold
// from the ring to the plate.
function drawCallout(x,g,p){ var title=M.callout.title||'', sub=M.callout.sub||'';
  x.font='700 11.5px sans-serif'; var tw=x.measureText(title).width; x.font='500 10px sans-serif'; var sw=x.measureText(sub).width;
  var bw=Math.max(tw,sw)+20, bh=sub?36:24, above=p.y<g.cy;
  var bx=p.x-bw/2+(p.x>=g.cx?18:-18), by=above?p.y-16-bh:p.y+16;
  var ux=p.x-g.cx, uy=p.y-g.cy, ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
  for(var k=0;k<8&&boxHitsPupil(bx,by,bw,bh,g);k++){ bx+=ux*12; by+=uy*12; }
  bx=Math.max(6,Math.min(W-bw-6,bx)); by=Math.max(6,Math.min(H-bh-6,by));
  var lx=Math.max(bx,Math.min(bx+bw,p.x)), ly=Math.max(by,Math.min(by+bh,p.y));
  x.strokeStyle='rgba(201,169,106,0.7)'; x.lineWidth=1; x.beginPath(); x.moveTo(p.x,p.y); x.lineTo(lx,ly); x.stroke();
  x.fillStyle='rgba(4,7,11,0.86)'; x.beginPath(); x.roundRect(bx,by,bw,bh,6); x.fill(); x.strokeStyle='rgba(201,169,106,0.35)'; x.lineWidth=1; x.stroke();
  x.textAlign='left'; x.textBaseline='alphabetic';
  x.fillStyle='#E8CF95'; x.font='700 11.5px sans-serif'; x.fillText(title,bx+10,by+15.5);
  if(sub){ x.fillStyle='#8296A8'; x.font='500 10px sans-serif'; x.fillText(sub,bx+10,by+29); } }

// Everything that does not move, drawn once.
function buildBase(){ if(W<2||H<2) return; var g=geom(); base=document.createElement('canvas'); base.width=Math.round(W*DPR); base.height=Math.round(H*DPR); var x=base.getContext('2d'); x.scale(DPR,DPR);
  x.fillStyle='#04070B'; x.fillRect(0,0,W,H);
  var outer=g.r0+(RINGS-1)*g.step+g.step*0.9;
  var hz=x.createRadialGradient(g.cx,g.cy,g.pupil*0.9,g.cx,g.cy,outer); hz.addColorStop(0,'rgba(18,42,56,0.6)'); hz.addColorStop(0.55,'rgba(10,26,38,0.35)'); hz.addColorStop(1,'rgba(4,7,11,0)'); x.fillStyle=hz; x.beginPath(); x.arc(g.cx,g.cy,outer,0,6.2832); x.fill();
  // The nine rails, faint, so the shape of the eye is there even before the
  // first Eye is.
  x.lineWidth=1; for(var r=0;r<RINGS;r++){ x.strokeStyle=r===0?'rgba(201,169,106,0.22)':'rgba(120,200,230,0.11)'; x.beginPath(); x.arc(g.cx,g.cy,g.r0+r*g.step,0,6.2832); x.stroke(); }
  // Each rail's streak, written where the rail crosses the upper right.
  x.font='600 8.5px sans-serif'; x.textAlign='center'; x.textBaseline='middle';
  for(var rl=0;rl<RINGS;rl++){ var ra=-1.05, rx=g.cx+(g.r0+rl*g.step)*Math.cos(ra), ry=g.cy+(g.r0+rl*g.step)*Math.sin(ra); x.fillStyle='rgba(4,7,11,0.9)'; x.beginPath(); x.arc(rx,ry,6.5,0,6.2832); x.fill(); x.fillStyle=rl===0?'rgba(232,207,149,0.95)':'rgba(150,190,210,0.75)'; x.fillText(RAIL[rl],rx,ry+0.5); }
  var dr=M.dotR, listed=[0,0,0,0,0,0,0,0,0];
  M.eyes.forEach(function(e){ e.p=place(e.s,e.r,g); if(e.r>=0&&e.r<RINGS) listed[e.r]++; });
  // Placeholders for the Eyes the server counted but did not list.
  if(M.ringCounts){ for(var rr=0;rr<RINGS;rr++){ var extra=Math.max(0,(M.ringCounts[rr]||0)-listed[rr]); for(var i=0;i<extra&&i<4000;i++){ dot(x,placeGhost(i,rr,g),dr*0.5,DIM,0.22); } } }
  var mine=null, mp=null; if(M.me){ mine=M.bySerial[M.me.serial]; mp=mine?mine.p:place(M.me.serial,M.me.ring,g); }
  if(M.er>0){
    // Eyes as eyes: shut ones first, open over them, yours last with a gold halo.
    if(mp) drawGlow(x,GOLD,mp.x,mp.y,M.er*3.4,0.7);
    M.eyes.forEach(function(e){ if(!e.b&&(!mine||e!==mine)) eyeGlyph(x,e.p,M.er,false,!!e.pf); });
    M.eyes.forEach(function(e){ if(e.b&&(!mine||e!==mine)) eyeGlyph(x,e.p,M.er,true,!!e.pf); });
    if(mp){ eyeGlyph(x,mp,M.er*1.15,mine?!!mine.b:true,mine?!!mine.pf:false); ring(x,mp,M.er*1.55,GOLD,1.4,0.95); if(M.callout) drawCallout(x,g,mp); }
  } else {
    // Dim first, lit over them, gold over both, you on top.
    M.eyes.forEach(function(e){ if(!e.b&&!e.pf) ring(x,e.p,dr,DIM,1.1,0.5); });
    M.eyes.forEach(function(e){ if(e.b&&!e.pf){ drawGlow(x,LIT,e.p.x,e.p.y,dr*3.2,0.45); ring(x,e.p,dr,LIT,1.25,0.95); } });
    M.eyes.forEach(function(e){ if(e.pf){ drawGlow(x,GOLD,e.p.x,e.p.y,dr*3.6,e.b?0.6:0.3); ring(x,e.p,dr,GOLD,1.3,e.b?1:0.7); dot(x,e.p,dr*0.42,GOLD,e.b?1:0.6); } });
    if(mp){ drawGlow(x,GOLD,mp.x,mp.y,dr*5.5,0.85); ring(x,mp,dr*2.1,GOLD,1.6,1); if(!mine) ring(x,mp,dr,LIT,1.25,0.95); if(M.callout) drawCallout(x,g,mp); }
  }
  // The pupil: a halo, the black, a rim of the app's accent.
  drawGlow(x,CY,g.cx,g.cy,g.pupil*1.45,0.28);
  x.beginPath(); x.arc(g.cx,g.cy,g.pupil,0,6.2832); x.fillStyle='#02050A'; x.fill();
  var iv=x.createRadialGradient(g.cx,g.cy,g.pupil*0.55,g.cx,g.cy,g.pupil); iv.addColorStop(0,'rgba(0,0,0,0)'); iv.addColorStop(1,'rgba(86,224,255,0.12)'); x.fillStyle=iv; x.beginPath(); x.arc(g.cx,g.cy,g.pupil,0,6.2832); x.fill();
  x.lineWidth=1.5; x.strokeStyle='rgba(86,224,255,0.6)'; x.beginPath(); x.arc(g.cx,g.cy,g.pupil,0,6.2832); x.stroke();
  baseDirty=false; }

function draw(now){ if(W<2||H<2) return; if(!base||baseDirty) buildBase(); if(!base) return; ctx.clearRect(0,0,W,H); ctx.drawImage(base,0,0,W,H);
  // The pupil breathes and a light walks round its rim, once every six seconds.
  var g=geom(), ph=(now%6000)/6000*6.2832, br=0.5+0.5*Math.sin(now/1300);
  drawGlow(ctx,CY,g.cx,g.cy,g.pupil*1.5,0.10+0.12*br);
  var lr=g.pupil*1.2+2; ctx.lineCap='round'; for(var k=0;k<8;k++){ ctx.globalAlpha=0.8*(1-k/8); ctx.strokeStyle='rgba(150,240,255,1)'; ctx.lineWidth=2.2; ctx.beginPath(); ctx.arc(g.cx,g.cy,lr,ph-k*0.1,ph-(k+1)*0.1,true); ctx.stroke(); } ctx.globalAlpha=1; ctx.lineCap='butt';
  flashes.forEach(function(f){ var t=(now-f.at)/f.dur; if(t<0||t>1) return; var ease=1-Math.pow(1-t,3), a=1-t, color=f.gold?GOLD:LIT; drawGlow(ctx,color,f.x,f.y,M.dotR*(3+7*ease),0.9*a); ring(ctx,{x:f.x,y:f.y},M.dotR*(1+2.6*ease),color,1.4,a); ring(ctx,{x:f.x,y:f.y},M.dotR,color,1.25,1); }); }
var lastFrame=0;
function loop(now){ if(paused){ animating=false; return; } if(now-lastFrame>=32){ lastFrame=now; draw(now); flashes=flashes.filter(function(f){ return now<f.at+f.dur; }); } requestAnimationFrame(loop); }
function start(){ if(!animating&&!paused){ animating=true; requestAnimationFrame(loop); } }
function flash(serial,ringIndex,delay){ var g=geom(); var e=M.bySerial[serial]; var p=e&&e.p?e.p:place(serial,ringIndex,g); var gold=!!(e&&e.pf)||!!(M.me&&M.me.serial===serial); flashes.push({x:p.x,y:p.y,at:performance.now()+delay,dur:600,gold:gold}); if(e&&!e.b){ e.b=1; baseDirty=true; } start(); }
// A burst — more than three in half a second — ripples outward from the pupil.
function onBlinks(items){ var now=performance.now(); burst=burst.filter(function(t){ return now-t<500; }); var ripple=burst.length+items.length>3; items.forEach(function(it){ burst.push(now); flash(it.serial,it.ring,ripple?Math.max(0,it.ring)*70:0); }); }

function size(){ if(window.innerWidth<2||window.innerHeight<2){ setTimeout(size,120); return; } W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); baseDirty=true; try{ draw(performance.now()); }catch(err){} }
size();
start();
window.addEventListener('resize',size);
cv.addEventListener('click',function(e){ var x=e.clientX, y=e.clientY, best=null, bd=Math.max(14,M.dotR*4); M.eyes.forEach(function(ey){ if(!ey.p) return; var d=Math.hypot(ey.p.x-x,ey.p.y-y); if(d<bd){ bd=d; best=ey; } }); if(best&&window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'tap',serial:best.s})); });
window.__push=function(m){ try{ if(!m) return;
  if(m.type==='network'){ M.eyes=m.eyes||[]; M.bySerial={}; M.eyes.forEach(function(e){ M.bySerial[e.s]=e; }); M.ringCounts=m.ringCounts||null; M.me=m.me||null; M.callout=m.callout||null; M.empty=!!m.empty; var total=M.ringCounts?M.ringCounts.reduce(function(a,b){return a+(b||0);},0):0; var n=Math.max(total,M.eyes.length); M.er=eyeRadius(n); M.dotR=M.er>0?M.er*0.8:dotRadius(n); baseDirty=true; if(!animating) draw(performance.now()); }
  else if(m.type==='blink'){ onBlinks(m.items||[]); }
  else if(m.type==='pause'){ paused=!!m.on; if(!paused) start(); }
 }catch(err){} };
if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
})();
</script></body></html>`;
