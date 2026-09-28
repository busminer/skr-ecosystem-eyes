// The Iris: the whole network drawn as one radar, on a canvas inside a WebView.
//
// The field is the radar's from the Top tab, on purpose and to the pixel: the
// same night-sky gradient with its grain and stars, the same thin rings, the
// same beam that sweeps round and lights what it passes, and the same hands:
// one finger drags, two pinch (0.8 to 6 times), a tap picks the nearest Eye.
// On that field nine rings around the centre, one per streak (30+ innermost,
// then 21, 14, 10, 7, 5, 3, 2, 1). Every open Eye is a small copy of the
// NFT's own eye on its ring: open if it blinked today, shut (a seam across
// the lens) if it has not, gold if it is a Perfect Eye. Past three hundred
// Eyes they become dots so the picture still reads. Yours is gold with a
// thread to the centre and a plate that says so. The centre itself is the
// Eye, the NFT's portal, laid over the canvas by the React side (it blinks);
// this page tells it the zoom and the pan so it moves with the field.
//
// Where an Eye sits is a pure function of its serial and its ring, so the
// same Eye is in the same place every time anyone looks, and a blink that
// arrives for a serial not in the list still lands where that Eye would be.
// The rings themselves are fitted to the field (geom below): the outermost
// keeps a whole Eye and its glow inside the edge, the innermost keeps clear
// of the portal at the centre, and the streaks are written as one scale at
// twelve o'clock.
//
// What it costs: the sky is drawn once and blitted. Everything that zooms
// is drawn per frame under the transform, the way the radar does it: the
// rings and the scale as lines and text, each Eye as a sprite cached per
// size and zoom step so it stays sharp, the beam, the glow on what the beam
// is passing, the thread and pulse on yours, the halo, any flashes. Thirty
// frames a second while the tab is in front; nothing at all while the app is
// in the background, and one frame per touch when the person turned motion
// off.
//
// Everything it knows arrives through window.__push; it never fetches.

export const IRIS_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, DPR=Math.min(2,window.devicePixelRatio||1);
var GOLDEN=2.399963229728653, RINGS=9, TAU=6.283185307179586, CONIC=typeof ctx.createConicGradient==='function';
var LIT='rgba(124,240,188,1)', DIM='rgba(111,132,154,1)', GOLD='rgba(232,207,149,1)', GD='rgba(201,169,106,1)', CY='rgba(86,224,255,1)', SOFT='rgba(140,190,215,1)';
// The model: what the React side last said, plus the one thing the stream
// changes between reads (an Eye that blinked), plus the beam's own angle.
var M={eyes:[],bySerial:{},ghosts:[],ringCounts:null,me:null,mine:null,mp:null,callout:null,empty:true,dotR:2.6,er:11,motion:'live',ang:-1.2};
// The view: how far in and where to, the radar's own numbers.
var V={zoom:1,panX:0,panY:0}, viewDirty=false;
var sky=null, skyKey='', layoutDirty=true;
var flashes=[], animating=false, paused=false, burst=[];
// The streak each ring stands for, innermost first (src/iris.mjs in the service).
var RAIL=['30+','21','14','10','7','5','3','2','1'];

function post(m){ try{ window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
function hash(n){ n=n|0; n=(n^61)^(n>>>16); n=n+(n<<3); n=n^(n>>>4); n=Math.imul(n,0x27d4eb2d); n=n^(n>>>15); return (n>>>0)/4294967296; }
// The rings are fitted to the field from both ends. Inside, the innermost
// ring keeps its Eyes clear of the portal the React side lays over the
// centre (0.39 of the field wide, so 0.195 in radius). Outside, an Eye on
// the outermost ring, with its scatter across the band and its whole glow,
// stays inside the field's edge. The Eye's size follows the network's size
// (eyeRadius below), so the spacing does too: a little tighter while the
// network is small and its Eyes are big.
function geom(){ var S=Math.min(W,H), P=S*0.195, e=M.er>0?M.er:M.dotR, step=(S/2-P-4-3.1*e)/8.6, r0=P+2+e+0.3*step; return {cx:W/2,cy:H/2,S:S,pupil:S*0.165,r0:r0,step:step,outer:r0+(RINGS-1)*step+step*0.5}; }
// Ring 0 is the innermost. The scatter across the band is deterministic too.
function place(serial,ring,g){ var R=g.r0+ring*g.step, a=serial*GOLDEN+ring*0.9, rr=R+(hash(serial)-0.5)*g.step*0.6; return {x:g.cx+rr*Math.cos(a),y:g.cy+rr*Math.sin(a),a:a}; }
function placeGhost(i,ring,g){ var R=g.r0+ring*g.step, a=(i+0.5)*GOLDEN+ring*0.9+1.7, rr=R+(hash(i*7919+ring*31)-0.5)*g.step*0.6; return {x:g.cx+rr*Math.cos(a),y:g.cy+rr*Math.sin(a),a:a}; }
// Smaller dots as the network grows, so two thousand still read as a crowd.
function dotRadius(total){ if(total<=400) return 3.4; if(total<=900) return 3; if(total<=1800) return 2.6; if(total<=3200) return 2.2; return 1.9; }
// Up to three hundred, every Eye is drawn as an eye; the fewer there are, the
// bigger. Nought means dots.
function eyeRadius(total){ if(total<=12) return 10; if(total<=40) return 8; if(total<=120) return 6.5; if(total<=300) return 5; return 0; }
// How lit a thing at angle a is by the beam: the radar's own formula.
function litBy(a){ var da=((a-M.ang)%TAU+TAU)%TAU; return Math.max(0,1-da/2.4); }
// Screen to scene and back, through the radar's transform.
function toScene(x,y){ var g=geom(); return {x:(x-g.cx-V.panX)/V.zoom+g.cx, y:(y-g.cy-V.panY)/V.zoom+g.cy}; }
function toScreen(p){ var g=geom(); return {x:(p.x-g.cx)*V.zoom+g.cx+V.panX, y:(p.y-g.cy)*V.zoom+g.cy+V.panY}; }

var glowCache={};
function glow(color,r){ var k=color+'|'+Math.round(r*4); if(glowCache[k]) return glowCache[k]; var c=document.createElement('canvas'); c.width=c.height=Math.max(2,Math.ceil(r*2*DPR)); var x=c.getContext('2d'); x.scale(DPR,DPR); var gr=x.createRadialGradient(r,r,0,r,r,r); gr.addColorStop(0,color); gr.addColorStop(0.35,color.replace(/[\d.]+\)$/,'0.45)')); gr.addColorStop(1,color.replace(/[\d.]+\)$/,'0)')); x.fillStyle=gr; x.fillRect(0,0,r*2,r*2); glowCache[k]=c; return c; }
function drawGlow(c,color,x,y,r,a){ c.globalAlpha=a==null?1:a; c.drawImage(glow(color,r),x-r,y-r,r*2,r*2); c.globalAlpha=1; }
function ring(c,p,r,color,width,alpha){ c.globalAlpha=alpha; c.strokeStyle=color; c.lineWidth=width; c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.stroke(); c.globalAlpha=1; }
// One Eye as the NFT draws it, small: the ring, the dark lens, the gold iris
// with its pupil and glint. Shut (a seam, no iris) when it has not blinked
// today. Gold ring for a Perfect Eye. The glow round an open one is drawn
// by the caller, so the sprite stays small.
function eyeGlyph(c,p,r,open,perfect){
  var tone=perfect?GOLD:open?'rgba(110,240,255,1)':'rgba(96,120,140,1)';
  c.strokeStyle=tone; c.lineWidth=Math.max(1.2,r*0.26); c.globalAlpha=open?1:0.7; c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.stroke(); c.globalAlpha=1;
  c.fillStyle='#050B10'; c.beginPath(); c.arc(p.x,p.y,r*0.76,0,TAU); c.fill();
  if(!open){ c.strokeStyle='rgba(58,91,104,1)'; c.lineWidth=Math.max(0.9,r*0.13); c.beginPath(); c.moveTo(p.x-r*0.56,p.y); c.lineTo(p.x+r*0.56,p.y); c.stroke(); return; }
  var ir=r*0.44, gr=c.createRadialGradient(p.x-ir*0.2,p.y-ir*0.25,0,p.x,p.y,ir); gr.addColorStop(0,'#F0D898'); gr.addColorStop(0.55,'#D6B56A'); gr.addColorStop(1,'#5A4219');
  c.fillStyle=gr; c.beginPath(); c.arc(p.x,p.y,ir,0,TAU); c.fill();
  c.fillStyle='#020304'; c.beginPath(); c.arc(p.x,p.y,ir*0.46,0,TAU); c.fill();
  if(r>=6){ c.fillStyle='rgba(244,251,253,0.92)'; c.beginPath(); c.arc(p.x-ir*0.42,p.y-ir*0.46,ir*0.22,0,TAU); c.fill(); } }
// The glyph as a sprite, one per size, state and zoom step, so a frame
// draws each Eye with one drawImage and a zoomed Eye is still sharp.
var spriteCache={};
function sprite(r,open,perfect,k){ var key=r+'|'+(open?1:0)+'|'+(perfect?1:0)+'|'+k, sp=spriteCache[key]; if(sp) return sp; var off=r*1.4, size=off*2; var c=document.createElement('canvas'); c.width=c.height=Math.max(2,Math.ceil(size*k)); var x=c.getContext('2d'); x.scale(k,k); eyeGlyph(x,{x:off,y:off},r,open,perfect); sp={c:c,size:size,off:off}; spriteCache[key]=sp; return sp; }
function drawEye(c,p,r,open,perfect,k){ if(open) drawGlow(c,perfect?GOLD:CY,p.x,p.y,r*2.7,perfect?0.5:0.42); var sp=sprite(r,open,perfect,k); c.drawImage(sp.c,p.x-sp.off,p.y-sp.off,sp.size,sp.size); }

// The sky, cached by size: the radar's gradient, its grain, its stars, and
// two things of the NFT card's own night: a faint green aurora in the upper
// right and a teal horizon low in the field. It does not zoom; it is the sky.
function buildSky(){ var key=W+'x'+H; if(skyKey===key&&sky) return; sky=document.createElement('canvas'); sky.width=Math.round(W*DPR); sky.height=Math.round(H*DPR); var x=sky.getContext('2d'); x.scale(DPR,DPR);
  var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0A1722'); g.addColorStop(0.5,'#0C2030'); g.addColorStop(1,'#0B1F2B'); x.fillStyle=g; x.fillRect(0,0,W,H);
  var s=17; function rnd(){ s=(s*16807)%2147483647; return s/2147483647; }
  for(var i=0;i<W*H*0.05;i++){ x.fillStyle=(i&1)?'rgba(255,255,255,0.028)':'rgba(0,0,0,0.05)'; x.fillRect(rnd()*W,rnd()*H,1,1); }
  for(var j=0;j<90;j++){ x.fillStyle='rgba(160,205,225,'+(0.14+0.22*rnd())+')'; x.fillRect(rnd()*W,rnd()*H*0.6,1.2,1.2); }
  var au=x.createLinearGradient(W*0.45,0,W,H*0.5); au.addColorStop(0,'rgba(124,240,188,0)'); au.addColorStop(0.55,'rgba(124,240,188,0.06)'); au.addColorStop(1,'rgba(86,224,255,0)'); x.fillStyle=au; x.fillRect(0,0,W,H*0.62);
  var hz=x.createLinearGradient(0,H*0.66,0,H); hz.addColorStop(0,'rgba(86,224,255,0)'); hz.addColorStop(0.44,'rgba(86,224,255,0.05)'); hz.addColorStop(0.5,'rgba(120,240,230,0.11)'); hz.addColorStop(0.56,'rgba(86,224,255,0.05)'); hz.addColorStop(1,'rgba(10,26,38,0)'); x.fillStyle=hz; x.fillRect(0,H*0.66,W,H*0.34);
  skyKey=key; }

// Where everything sits, worked out once per picture: the Eyes on their
// rings, the dust for the Eyes the server counted but did not list (at most
// six thousand of it, spread over the rings by their counts), and you.
function layout(){ if(W<2||H<2) return; var g=geom(), listed=[0,0,0,0,0,0,0,0,0];
  M.eyes.forEach(function(e){ e.p=place(e.s,e.r,g); if(e.r>=0&&e.r<RINGS) listed[e.r]++; });
  M.ghosts=[]; if(M.ringCounts){ var extra=[], total=0; for(var rr=0;rr<RINGS;rr++){ extra[rr]=Math.max(0,(M.ringCounts[rr]||0)-listed[rr]); total+=extra[rr]; } var share=total>6000?6000/total:1; for(var r2=0;r2<RINGS;r2++){ var n=Math.ceil(extra[r2]*share); for(var i=0;i<n;i++) M.ghosts.push(placeGhost(i,r2,g)); } }
  M.mine=M.me?M.bySerial[M.me.serial]||null:null; M.mp=M.me?(M.mine?M.mine.p:place(M.me.serial,M.me.ring,g)):null;
  layoutDirty=false; }

function boxHits(bx,by,bw,bh,cc,R){ var nx=Math.max(bx,Math.min(bx+bw,cc.x)), ny=Math.max(by,Math.min(by+bh,cc.y)); return Math.hypot(nx-cc.x,ny-cc.y)<R; }
// The plate by your Eye, in screen space so it reads the same at any zoom:
// on the side away from the centre, pushed further out if it would still
// cover the centre, kept on the canvas, and a hair of gold from the Eye to it.
function drawCallout(x,p,cc,avoid){ var title=M.callout.title||'', sub=M.callout.sub||'';
  x.font='700 11.5px sans-serif'; var tw=x.measureText(title).width; x.font='700 9.5px monospace'; var sw=x.measureText(sub).width;
  var bw=Math.max(tw,sw)+20, bh=sub?36:24, above=p.y<cc.y;
  var bx=p.x-bw/2+(p.x>=cc.x?18:-18), by=above?p.y-16-bh:p.y+16;
  var ux=p.x-cc.x, uy=p.y-cc.y, ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
  for(var k=0;k<8&&boxHits(bx,by,bw,bh,cc,avoid);k++){ bx+=ux*12; by+=uy*12; }
  bx=Math.max(6,Math.min(W-bw-6,bx)); by=Math.max(6,Math.min(H-bh-6,by));
  var lx=Math.max(bx,Math.min(bx+bw,p.x)), ly=Math.max(by,Math.min(by+bh,p.y));
  x.strokeStyle='rgba(201,169,106,0.7)'; x.lineWidth=1; x.beginPath(); x.moveTo(p.x,p.y); x.lineTo(lx,ly); x.stroke();
  x.fillStyle='rgba(4,7,11,0.86)'; x.beginPath(); x.roundRect(bx,by,bw,bh,6); x.fill(); x.strokeStyle='rgba(201,169,106,0.35)'; x.lineWidth=1; x.stroke();
  x.textAlign='left'; x.textBaseline='alphabetic';
  x.fillStyle='#E8CF95'; x.font='700 11.5px sans-serif'; x.fillText(title,bx+10,by+15.5);
  if(sub){ x.fillStyle='#8296A8'; x.font='700 9.5px monospace'; x.fillText(sub,bx+10,by+29); } }

function draw(now){ if(W<2||H<2) return; if(layoutDirty) layout(); buildSky(); var c=ctx, g=geom(), Z=V.zoom, rZ=Math.sqrt(Z), K=DPR*Math.min(4,Math.ceil(Z)), moving=M.motion!=='off';
  c.setTransform(DPR,0,0,DPR,0,0); c.clearRect(0,0,W,H); c.drawImage(sky,0,0,W,H);
  c.save(); c.translate(g.cx+V.panX,g.cy+V.panY); c.scale(Z,Z); c.translate(-g.cx,-g.cy);
  // The nine rings, the radar's thin line, so the shape is there before the
  // first Eye is. The innermost, for the Perfect Eyes, carries a little gold.
  c.lineWidth=1/Z; for(var r=0;r<RINGS;r++){ c.strokeStyle=r===0?'rgba(201,169,106,0.32)':'rgba(120,180,205,0.16)'; c.beginPath(); c.arc(g.cx,g.cy,g.r0+r*g.step,0,TAU); c.stroke(); }
  // The scale: each ring's streak written at twelve o'clock, where the radar
  // writes its labels, on one dark strip from the outermost ring to the
  // innermost so the numbers read as a ruler and no line runs through them.
  // Under the Eyes while they are eyes (an Eye is worth more than a number),
  // over them once they are dust (a dot under the scale is no loss).
  var sw=19/rZ, pad=6/rZ, sTop=g.cy-(g.r0+(RINGS-1)*g.step)-pad, sBot=g.cy-g.r0+pad;
  function scale(){ c.fillStyle='rgba(8,18,26,0.9)'; c.beginPath(); c.roundRect(g.cx-sw/2,sTop,sw,sBot-sTop,5/rZ); c.fill();
    c.font='700 '+(8/rZ)+'px monospace'; c.textAlign='center'; c.textBaseline='middle';
    for(var rl=0;rl<RINGS;rl++){ c.fillStyle=rl===0?'rgba(201,169,106,1)':'rgba(130,150,168,0.9)'; c.fillText(RAIL[rl],g.cx,g.cy-(g.r0+rl*g.step)+0.5/rZ); } }
  if(M.er>0) scale();
  // The beam: the radar's wedge and its edge, round the whole field.
  if(moving){ if(CONIC){ var bg=c.createConicGradient(M.ang,g.cx,g.cy); bg.addColorStop(0,'rgba(86,224,255,0.22)'); bg.addColorStop(0.12,'rgba(86,224,255,0)'); bg.addColorStop(1,'rgba(86,224,255,0)'); c.fillStyle=bg; c.beginPath(); c.arc(g.cx,g.cy,g.outer,0,TAU); c.fill(); }
    else { c.fillStyle='rgba(86,224,255,0.07)'; c.beginPath(); c.moveTo(g.cx,g.cy); c.arc(g.cx,g.cy,g.outer,M.ang,M.ang+0.75); c.closePath(); c.fill(); }
    c.strokeStyle='rgba(86,224,255,0.6)'; c.lineWidth=1/Z; c.beginPath(); c.moveTo(g.cx+Math.cos(M.ang)*g.pupil*1.12,g.cy+Math.sin(M.ang)*g.pupil*1.12); c.lineTo(g.cx+Math.cos(M.ang)*g.outer,g.cy+Math.sin(M.ang)*g.outer); c.stroke(); }
  // The dust: the Eyes the server counted but did not list, lit as the beam passes.
  var gs=1.6/rZ; for(var gi=0;gi<M.ghosts.length;gi++){ var gh=M.ghosts[gi], gl=moving?litBy(gh.a):0; c.fillStyle='rgba(124,240,188,'+(0.18+0.4*gl)+')'; c.fillRect(gh.x-gs/2,gh.y-gs/2,gs,gs); }
  var er=M.er, dr=M.dotR, mine=M.mine;
  if(er>0){
    // Eyes as eyes: shut ones first, open over them, yours last with a gold halo.
    for(var i=0;i<M.eyes.length;i++){ var e=M.eyes[i]; if(!e.p||e===mine||e.b) continue; drawEye(c,e.p,er,false,!!e.pf,K); }
    for(var j=0;j<M.eyes.length;j++){ var e2=M.eyes[j]; if(!e2.p||e2===mine||!e2.b) continue; drawEye(c,e2.p,er,true,!!e2.pf,K); }
    // What the beam is passing lights up: added light, so the Eye under it stays itself.
    if(moving){ c.globalCompositeOperation='lighter'; for(var q=0;q<M.eyes.length;q++){ var e3=M.eyes[q]; if(!e3.p||e3===mine) continue; var lit=litBy(e3.p.a); if(lit<0.04) continue; if(e3.b) drawGlow(c,e3.pf?GOLD:CY,e3.p.x,e3.p.y,er*2.6,0.5*lit); else drawGlow(c,SOFT,e3.p.x,e3.p.y,er*1.7,0.2*lit); } c.globalCompositeOperation='source-over'; }
    if(M.mp){ drawGlow(c,GOLD,M.mp.x,M.mp.y,er*3.4,0.55); drawEye(c,M.mp,er*1.15,mine?!!mine.b:true,mine?!!mine.pf:false,K); ring(c,M.mp,er*1.55,GOLD,1.4/Z,0.95); }
  } else {
    // Dots, the radar's dust made of Eyes: dim, lit, gold, and you on top.
    var ds=dr*1.6/rZ;
    for(var d=0;d<M.eyes.length;d++){ var e4=M.eyes[d]; if(!e4.p||e4===mine) continue; var l2=moving?litBy(e4.p.a):0; if(e4.pf){ drawGlow(c,GOLD,e4.p.x,e4.p.y,dr*3.6,e4.b?0.5:0.3); c.fillStyle='rgba(232,207,149,'+(e4.b?1:0.7)+')'; } else c.fillStyle=e4.b?'rgba(124,240,188,'+(0.5+0.5*l2)+')':'rgba(111,132,154,'+(0.35+0.3*l2)+')'; c.fillRect(e4.p.x-ds/2,e4.p.y-ds/2,ds,ds); }
    if(M.mp){ drawGlow(c,GOLD,M.mp.x,M.mp.y,dr*5.5,0.8); ring(c,M.mp,dr*2.1,GOLD,1.6/Z,1); c.fillStyle=GOLD; c.fillRect(M.mp.x-ds*0.7,M.mp.y-ds*0.7,ds*1.4,ds*1.4); }
    scale();
  }
  // You: a thread to the centre, and a pulse of gold as the beam goes by.
  if(M.mp){ var mp=M.mp, pulse=moving?Math.max(0,1-(((mp.a-M.ang)%TAU+TAU)%TAU)/0.6):0; c.strokeStyle='rgba(201,169,106,0.5)'; c.setLineDash([2/Z,3/Z]); c.lineWidth=1/Z; c.beginPath(); c.moveTo(g.cx+Math.cos(mp.a)*g.pupil*1.12,g.cy+Math.sin(mp.a)*g.pupil*1.12); c.lineTo(mp.x,mp.y); c.stroke(); c.setLineDash([]); if(pulse>0.02){ c.globalCompositeOperation='lighter'; drawGlow(c,GD,mp.x,mp.y,(er>0?er*2.2:dr*3)+pulse*18,0.7*pulse); c.globalCompositeOperation='source-over'; } }
  // The centre as the radar draws its monument: a dark disc with a soft body
  // and a thin rim, and a halo that breathes. The Eye itself sits over it.
  var R=g.pupil*1.12, body=c.createRadialGradient(g.cx-R*0.35,g.cy-R*0.45,R*0.1,g.cx,g.cy,R); body.addColorStop(0,'rgba(16,36,50,0.9)'); body.addColorStop(1,'rgba(4,10,16,0.95)'); c.beginPath(); c.arc(g.cx,g.cy,R,0,TAU); c.fillStyle=body; c.fill(); c.lineWidth=1.2/Z; c.strokeStyle='rgba(140,190,215,0.16)'; c.stroke();
  var br=moving?0.5+0.5*Math.sin(now/1300):0.5; drawGlow(c,CY,g.cx,g.cy,g.pupil*1.5,0.10+0.12*br);
  flashes.forEach(function(f){ var t=(now-f.at)/f.dur; if(t<0||t>1) return; var ease=1-Math.pow(1-t,3), a=1-t, color=f.gold?GOLD:LIT; drawGlow(c,color,f.x,f.y,dr*(3+7*ease),0.9*a); ring(c,{x:f.x,y:f.y},dr*(1+2.6*ease),color,1.4/Z,a); ring(c,{x:f.x,y:f.y},dr,color,1.25/Z,1); });
  c.restore();
  if(M.mp&&M.callout) drawCallout(c,toScreen(M.mp),{x:g.cx+V.panX,y:g.cy+V.panY},g.r0*Z); }
var lastFrame=0, lastTick=0;
function postView(){ viewDirty=false; post({type:'view',zoom:V.zoom,panX:V.panX,panY:V.panY}); }
// Thirty frames a second, the beam moved by the clock rather than by the
// frame, so a slow phone gets a slower picture and not a slower sweep.
function loop(now){ if(paused){ animating=false; return; } if(now-lastFrame>=32){ var dt=lastTick?Math.min(0.1,(now-lastTick)/1000):0; lastTick=now; lastFrame=now; if(M.motion==='live') M.ang+=0.72*dt; else if(M.motion==='calm') M.ang+=0.36*dt; try{ draw(now); }catch(err){} if(viewDirty) postView(); flashes=flashes.filter(function(f){ return now<f.at+f.dur; }); if(M.motion==='off'&&!flashes.length){ animating=false; return; } } requestAnimationFrame(loop); }
function start(){ if(!animating&&!paused){ animating=true; lastTick=0; requestAnimationFrame(loop); } }
// A frame now, for a touch while nothing else is moving.
function redraw(){ if(animating) return; try{ draw(performance.now()); }catch(err){} if(viewDirty) postView(); }
function flash(serial,ringIndex,delay){ var g=geom(); var e=M.bySerial[serial]; var p=e&&e.p?e.p:place(serial,ringIndex,g); var gold=!!(e&&e.pf)||!!(M.me&&M.me.serial===serial); flashes.push({x:p.x,y:p.y,at:performance.now()+delay,dur:600,gold:gold}); if(e&&!e.b) e.b=1; start(); }
// A burst, more than three in half a second, ripples outward from the centre.
function onBlinks(items){ var now=performance.now(); burst=burst.filter(function(t){ return now-t<500; }); var ripple=burst.length+items.length>3; items.forEach(function(it){ burst.push(now); flash(it.serial,it.ring,ripple?Math.max(0,it.ring)*70:0); }); }

function size(){ if(window.innerWidth<2||window.innerHeight<2){ setTimeout(size,120); return; } W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); layoutDirty=true; try{ draw(performance.now()); }catch(err){} }
// Touch, the radar's own: one finger drags, two pinch, a tap picks the nearest Eye.
var touch={pts:{},startD:0,startZ:1,moved:false,startX:0,startY:0,panX:0,panY:0};
function pt(e){ var out={}; for(var i=0;i<e.touches.length;i++){ var t=e.touches[i]; out[t.identifier]={x:t.clientX,y:t.clientY}; } return out; }
function dist(p){ var k=Object.keys(p); if(k.length<2) return 0; var a=p[k[0]],b=p[k[1]]; return Math.hypot(a.x-b.x,a.y-b.y); }
cv.addEventListener('touchstart',function(e){ e.preventDefault(); touch.pts=pt(e); touch.moved=false; var k=Object.keys(touch.pts); if(k.length===1){ touch.startX=touch.pts[k[0]].x; touch.startY=touch.pts[k[0]].y; touch.panX=V.panX; touch.panY=V.panY; } else if(k.length>=2){ touch.startD=dist(touch.pts); touch.startZ=V.zoom; } },{passive:false});
cv.addEventListener('touchmove',function(e){ e.preventDefault(); var p=pt(e); var k=Object.keys(p); if(k.length===1&&Object.keys(touch.pts).length===1){ var dx=p[k[0]].x-touch.startX, dy=p[k[0]].y-touch.startY; if(Math.hypot(dx,dy)>6) touch.moved=true; V.panX=touch.panX+dx; V.panY=touch.panY+dy; clampPan(); } else if(k.length>=2){ touch.moved=true; var d=dist(p); if(touch.startD>0){ V.zoom=Math.max(0.8,Math.min(6,touch.startZ*d/touch.startD)); clampPan(); } } touch.pts=p; viewDirty=true; redraw(); },{passive:false});
cv.addEventListener('touchend',function(e){ e.preventDefault(); if(e.touches.length===0){ if(!touch.moved) tap(touch.startX,touch.startY); touch.pts={}; } else { touch.pts=pt(e); var k=Object.keys(touch.pts); if(k.length===1){ touch.startX=touch.pts[k[0]].x; touch.startY=touch.pts[k[0]].y; touch.panX=V.panX; touch.panY=V.panY; touch.moved=true; } } viewDirty=true; redraw(); },{passive:false});
function clampPan(){ var lim=Math.max(W,H)*V.zoom*0.6; V.panX=Math.max(-lim,Math.min(lim,V.panX)); V.panY=Math.max(-lim,Math.min(lim,V.panY)); }
function tap(x,y){ var s=toScene(x,y), best=null, bd=Math.max(14/V.zoom,M.er>0?M.er*1.3:M.dotR*2.5); M.eyes.forEach(function(ey){ if(!ey.p) return; var d=Math.hypot(ey.p.x-s.x,ey.p.y-s.y); if(d<bd){ bd=d; best=ey; } }); if(best) post({type:'tap',serial:best.s}); }
size();
start();
window.addEventListener('resize',size);
window.__push=function(m){ try{ if(!m) return;
  if(m.type==='network'){ M.eyes=m.eyes||[]; M.bySerial={}; M.eyes.forEach(function(e){ M.bySerial[e.s]=e; }); M.ringCounts=m.ringCounts||null; M.me=m.me||null; M.callout=m.callout||null; M.empty=!!m.empty; var total=M.ringCounts?M.ringCounts.reduce(function(a,b){return a+(b||0);},0):0; var n=Math.max(total,M.eyes.length); M.er=eyeRadius(n); M.dotR=M.er>0?M.er*0.8:dotRadius(n); layoutDirty=true; redraw(); }
  else if(m.type==='blink'){ onBlinks(m.items||[]); }
  else if(m.type==='motion'){ M.motion=m.mode==='off'?'off':m.mode==='calm'?'calm':'live'; if(M.motion==='off') redraw(); else start(); }
  else if(m.type==='pause'){ paused=!!m.on; if(!paused) start(); }
  else if(m.type==='reset'){ V.zoom=1; V.panX=0; V.panY=0; viewDirty=true; redraw(); }
 }catch(err){} };
post({type:'ready'});
})();
</script></body></html>`;
