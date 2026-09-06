import { GLYPH_DATA_URL } from './vaultSceneHtml';

// The radar: everybody who stakes, arranged by place around the monument.
//
// Six rings, one per tier, the closer to the centre the higher the place. The
// inner ring carries the top people as phones with their names; the outer
// rings are dots, a sample of each tier's count, because forty six thousand
// sprites would draw nothing anybody could read. The beam sweeps and lights
// what it passes; the person looking is gold, with a thread to the centre.
//
// Same approach as the vault: a canvas in a WebView, fed through window.__push,
// never fetching anything itself. The monument at the centre is the vault's
// own moon, the token's mark as a mask, drawn with the same gradient.
export const RADAR_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, DPR=Math.min(2,window.devicePixelRatio||1);
var GD='rgba(201,169,106,A)', CY='rgba(86,224,255,A)', GOLD='#C9A96A';
var GLYPH=new Image(); GLYPH.src='${GLYPH_DATA_URL}';
function post(m){ try{ window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
function compact(n){ n=+n||0; if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(2)+'M'; if(n>=1e3) return (n/1e3).toFixed(n>=1e5?0:1)+'K'; return String(Math.round(n)); }
function fmt(n){ return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,' '); }
function phone(c,x,y,w,h,tone,lit,alpha){ var body=tone==='gold'?'#6b5630':'#2a3f4c', edge=tone==='gold'?'#e8cf95':'#5f8494', scr=lit?(tone==='gold'?'#ffe9b8':'#9ff6d2'):'#173a48'; c.save(); c.translate(x,y); c.globalAlpha=alpha==null?1:alpha; c.fillStyle=body; c.strokeStyle=edge; c.lineWidth=Math.max(0.6,w*0.09); c.beginPath(); c.roundRect(-w/2,-h/2,w,h,w*0.22); c.fill(); c.stroke(); c.fillStyle=scr; c.beginPath(); c.roundRect(-w/2+w*0.12,-h/2+h*0.09,w*0.76,h*0.82,w*0.14); c.fill(); c.restore(); }
function glow(c,color,x,y,r,a){ var g=c.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,color.replace('A)',a+')')); g.addColorStop(0.35,color.replace('A)',(a*0.45)+')')); g.addColorStop(1,color.replace('A)','0)')); c.fillStyle=g; c.fillRect(x-r,y-r,r*2,r*2); }
var monoG=null;
function monument(c,cx,cy,R){ var body=c.createRadialGradient(cx-R*0.35,cy-R*0.45,R*0.1,cx,cy,R); body.addColorStop(0,'rgba(16,36,50,0.9)'); body.addColorStop(1,'rgba(4,10,16,0.95)'); c.beginPath(); c.arc(cx,cy,R,0,6.283); c.fillStyle=body; c.fill(); c.lineWidth=1.2; c.strokeStyle='rgba(140,190,215,0.16)'; c.stroke(); if(GLYPH.complete&&GLYPH.naturalWidth>0){ if(!monoG){ monoG=document.createElement('canvas'); monoG.width=256; monoG.height=256; var gx=monoG.getContext('2d'); gx.drawImage(GLYPH,0,0); gx.globalCompositeOperation='source-in'; gx.fillStyle='rgba(150,200,225,1)'; gx.fillRect(0,0,256,256); } c.save(); c.globalAlpha=0.13; c.drawImage(monoG,cx-R,cy-R,R*2,R*2); c.restore(); } var hz=c.createLinearGradient(0,cy+R*0.45,0,cy+R); hz.addColorStop(0,'rgba(10,26,38,0)'); hz.addColorStop(1,'rgba(11,31,43,0.6)'); c.fillStyle=hz; c.fillRect(cx-R-2,cy+R*0.45,R*2+4,R*0.55+2); }

var S={ready:false,paused:false,motion:'live',ang:-1.2,t:0,zoom:1,panX:0,panY:0,people:0,tiers:[],rows:[],me:null,rings:[],dots:[],meDot:null,R0:0,cx:0,cy:0,sel:null,high:null,inner:[],bg:null,bgKey:''};
var LABELS_SHOW=6;
function size(){ if(window.innerWidth<2||window.innerHeight<2){ setTimeout(size,120); return; } W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); layout(); }
function sky(){ var key=W+'x'+H; if(S.bgKey===key) return; var bg=document.createElement('canvas'); bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR); var x=bg.getContext('2d'); x.scale(DPR,DPR); var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0A1722'); g.addColorStop(0.5,'#0C2030'); g.addColorStop(1,'#0B1F2B'); x.fillStyle=g; x.fillRect(0,0,W,H); var s=17; function rnd(){ s=(s*16807)%2147483647; return s/2147483647; } for(var i=0;i<W*H*0.05;i++){ x.fillStyle=(i&1)?'rgba(255,255,255,0.028)':'rgba(0,0,0,0.05)'; x.fillRect(rnd()*W,rnd()*H,1,1); } for(var j=0;j<90;j++){ x.fillStyle='rgba(160,205,225,'+(0.14+0.22*rnd())+')'; x.fillRect(rnd()*W,rnd()*H*0.6,1.2,1.2); } S.bg=bg; S.bgKey=key; }
// Rings by tier, the widths chosen so the inner ring has room for phones with
// names and the outer ones hold their dust. Scaled to the shorter side, so a
// tall phone and a short one both get the whole radar on screen.
function layout(){ sky(); if(!S.tiers.length) return; var base=Math.min(W,H*0.78); var unit=base/368; S.cx=W/2; S.cy=H*0.47; S.R0=58*unit; var widths=[68,42,36,32,28,26,22]; var acc=S.R0; S.rings=S.tiers.map(function(t,i){ var w=(widths[i]||24)*unit; acc+=w; return {label:t.label,count:t.count,cut:t.cut,r:acc,inner:acc-w}; });
  var s=3; function rnd(){ s=(s*16807)%2147483647; return s/2147483647; } S.dots=[]; var cursor=0; var caps=[46,415,900,1200,1500,1500,1500];
  S.rings.forEach(function(rg,i){ var n=Math.min(rg.count,caps[i]||1200); for(var j=0;j<n;j++){ var row=(i===0&&cursor<S.rows.length&&j<rg.count)?S.rows[cursor]:null; if(row) cursor++; var a=rnd()*6.283, rr=rg.inner+7*unit+rnd()*(rg.r-rg.inner-14*unit); S.dots.push({a:a,r:rr,ring:i,row:row,me:!!(row&&S.me&&row.wallet===S.me.wallet)}); } });
  S.meDot=null; if(S.me&&S.me.found){ S.meDot=S.dots.find(function(d){return d.me;}); if(!S.meDot){ var ri=ringFor(S.me.rank); var rg=S.rings[ri]||S.rings[S.rings.length-1]; S.meDot={a:-1.1,r:rg.inner+(rg.r-rg.inner)*0.5,ring:ri,row:S.me,me:true}; S.dots.push(S.meDot); } S.meDot.a=-1.1; }
  S.inner=S.dots.filter(function(d){return d.ring===0&&d.row;}); }
function ringFor(rank){ var acc=0; for(var i=0;i<S.rings.length;i++){ acc+=S.rings[i].count; if(rank<=acc) return i; } return S.rings.length-1; }
function px(d){ return {x:S.cx+Math.cos(d.a)*d.r, y:S.cy+Math.sin(d.a)*d.r}; }
function draw(){ var c=ctx; c.setTransform(DPR,0,0,DPR,0,0); c.clearRect(0,0,W,H); if(S.bg) c.drawImage(S.bg,0,0,W,H); if(!S.rings.length){ return; }
  c.save(); c.translate(S.cx+S.panX,S.cy+S.panY); c.scale(S.zoom,S.zoom); c.translate(-S.cx,-S.cy); var Z=S.zoom; var outer=S.rings[S.rings.length-1].r;
  S.rings.forEach(function(rg,i){ c.beginPath(); c.arc(S.cx,S.cy,rg.r,0,6.283); c.strokeStyle=S.high===i?'rgba(86,224,255,0.7)':'rgba(120,180,205,0.16)'; c.lineWidth=(S.high===i?1.5:1)/Z; c.stroke(); if(S.high===i){ c.beginPath(); c.arc(S.cx,S.cy,rg.r,0,6.283); c.arc(S.cx,S.cy,rg.inner,0,6.283,true); c.fillStyle='rgba(86,224,255,0.06)'; c.fill(); } c.fillStyle=i===0?'rgba(201,169,106,1)':'rgba(130,150,168,0.9)'; c.font='700 '+(8.5/Math.sqrt(Z))+'px monospace'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(rg.label.toUpperCase(),S.cx,S.cy-rg.r+9/Math.sqrt(Z)); });
  var g=c.createConicGradient(S.ang,S.cx,S.cy); g.addColorStop(0,'rgba(86,224,255,0.22)'); g.addColorStop(0.12,'rgba(86,224,255,0)'); g.addColorStop(1,'rgba(86,224,255,0)'); c.fillStyle=g; c.beginPath(); c.arc(S.cx,S.cy,outer,0,6.283); c.fill(); c.strokeStyle='rgba(86,224,255,0.6)'; c.lineWidth=1/Z; c.beginPath(); c.moveTo(S.cx,S.cy); c.lineTo(S.cx+Math.cos(S.ang)*outer,S.cy+Math.sin(S.ang)*outer); c.stroke();
  for(var i=0;i<S.dots.length;i++){ var d=S.dots[i]; if(d.me) continue; var p=px(d); var da=((d.a-S.ang)%6.283+6.283)%6.283; var lit=Math.max(0,1-da/2.4);
    if(d.ring===0){ var selected=S.sel&&d.row&&S.sel===d.row.wallet; if(selected) glow(c,CY,p.x,p.y,14,0.8); phone(c,p.x,p.y,5.5,9.5,'in',lit>0.15||selected,0.92); }
    else { var a=d.ring<3?1:0.6; c.fillStyle='rgba(124,240,188,'+((0.18+0.5*lit)*a)+')'; var s=1.6/Math.sqrt(Z); c.fillRect(p.x-s/2,p.y-s/2,s,s); } }
  var labels=Z>=2.2?S.inner.length:Z>=1.5?Math.min(S.inner.length,20):LABELS_SHOW; c.textAlign='center'; c.textBaseline='top'; c.font='600 '+(7.5/Math.sqrt(Z))+'px monospace'; S.inner.slice(0,labels).forEach(function(d){ var p=px(d); c.fillStyle='rgba(242,247,251,0.8)'; c.fillText(d.row.name||(d.row.wallet.slice(0,4)+'…'+d.row.wallet.slice(-4)),p.x,p.y+6); });
  monument(c,S.cx,S.cy,S.R0-4);
  if(S.meDot){ var m=px(S.meDot); var dme=((S.meDot.a-S.ang)%6.283+6.283)%6.283; var pulse=Math.max(0,1-dme/0.6); c.strokeStyle='rgba(201,169,106,0.5)'; c.setLineDash([2/Z,3/Z]); c.lineWidth=1/Z; c.beginPath(); c.moveTo(S.cx,S.cy); c.lineTo(m.x,m.y); c.stroke(); c.setLineDash([]); glow(c,GD,m.x,m.y,22+pulse*18,0.9); phone(c,m.x,m.y,7,12,'gold',true,1); c.fillStyle=GOLD; c.font='700 '+(8/Math.sqrt(Z))+'px monospace'; c.textAlign='center'; c.textBaseline='top'; c.fillText('#'+fmt(S.me.rank)+' · '+(S.me.name||'you'),m.x,m.y+8); }
  c.restore();
  if(S.sel&&S.selRow){ var r=S.selRow; var txt='#'+fmt(r.rank)+'  '+(r.name?r.name+'.skr':r.wallet.slice(0,4)+'…'+r.wallet.slice(-4))+'  '+compact(r.staked)+' SKR'; c.font='600 12px monospace'; var w=c.measureText(txt).width+24; c.fillStyle='rgba(4,7,11,0.86)'; c.strokeStyle='rgba(34,50,63,1)'; c.lineWidth=1; c.beginPath(); c.roundRect(W/2-w/2,H-64,w,30,10); c.fill(); c.stroke(); c.fillStyle='#F2F7FB'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(txt,W/2,H-49); }
  if(S.high!=null&&S.rings[S.high]){ var rg=S.rings[S.high]; var t2=rg.label+' · '+fmt(rg.count)+' people · from '+compact(rg.cut)+' SKR'; c.font='600 11px monospace'; var w2=c.measureText(t2).width+24; c.fillStyle='rgba(4,7,11,0.86)'; c.strokeStyle='rgba(34,50,63,1)'; c.beginPath(); c.roundRect(W/2-w2/2,H-100,w2,26,9); c.fill(); c.stroke(); c.fillStyle='#8296A8'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(t2,W/2,H-87); } }
var beatAt=0;
function loop(now){ requestAnimationFrame(loop); if(S.paused) return; if(S.motion!=='off') S.ang+=S.motion==='calm'?0.006:0.012; try{ draw(); }catch(e){} if(now-beatAt>3000){ beatAt=now; post({type:'beat'}); } }
// Touch: one finger drags, two pinch, a tap picks the nearest phone or ring.
var touch={pts:{},startD:0,startZ:1,moved:false,startX:0,startY:0,panX:0,panY:0};
function pt(e){ var out={}; for(var i=0;i<e.touches.length;i++){ var t=e.touches[i]; out[t.identifier]={x:t.clientX,y:t.clientY}; } return out; }
function dist(p){ var k=Object.keys(p); if(k.length<2) return 0; var a=p[k[0]],b=p[k[1]]; return Math.hypot(a.x-b.x,a.y-b.y); }
cv.addEventListener('touchstart',function(e){ e.preventDefault(); touch.pts=pt(e); touch.moved=false; var k=Object.keys(touch.pts); if(k.length===1){ touch.startX=touch.pts[k[0]].x; touch.startY=touch.pts[k[0]].y; touch.panX=S.panX; touch.panY=S.panY; } else if(k.length>=2){ touch.startD=dist(touch.pts); touch.startZ=S.zoom; } },{passive:false});
cv.addEventListener('touchmove',function(e){ e.preventDefault(); var p=pt(e); var k=Object.keys(p); if(k.length===1&&Object.keys(touch.pts).length===1){ var dx=p[k[0]].x-touch.startX, dy=p[k[0]].y-touch.startY; if(Math.hypot(dx,dy)>6) touch.moved=true; S.panX=touch.panX+dx; S.panY=touch.panY+dy; clampPan(); } else if(k.length>=2){ touch.moved=true; var d=dist(p); if(touch.startD>0){ S.zoom=Math.max(0.8,Math.min(6,touch.startZ*d/touch.startD)); clampPan(); } } touch.pts=p; },{passive:false});
cv.addEventListener('touchend',function(e){ e.preventDefault(); if(e.touches.length===0){ if(!touch.moved) tap(touch.startX,touch.startY); touch.pts={}; } else { touch.pts=pt(e); var k=Object.keys(touch.pts); if(k.length===1){ touch.startX=touch.pts[k[0]].x; touch.startY=touch.pts[k[0]].y; touch.panX=S.panX; touch.panY=S.panY; touch.moved=true; } } },{passive:false});
function clampPan(){ var lim=Math.max(W,H)*S.zoom*0.6; S.panX=Math.max(-lim,Math.min(lim,S.panX)); S.panY=Math.max(-lim,Math.min(lim,S.panY)); }
function toScene(x,y){ return {x:(x-S.cx-S.panX)/S.zoom+S.cx, y:(y-S.cy-S.panY)/S.zoom+S.cy}; }
function tap(x,y){ var s=toScene(x,y); var best=null, bd=18/S.zoom; S.inner.concat(S.meDot?[S.meDot]:[]).forEach(function(d){ var p=px(d); var dd=Math.hypot(p.x-s.x,p.y-s.y); if(dd<bd){ bd=dd; best=d; } }); if(best){ S.sel=best.row.wallet; S.selRow=best.row; S.high=null; post({type:'tap',row:best.row}); return; } var r=Math.hypot(s.x-S.cx,s.y-S.cy); var ring=null; for(var i=0;i<S.rings.length;i++){ if(r<=S.rings[i].r&&r>S.rings[i].inner){ ring=i; break; } } S.sel=null; S.selRow=null; S.high=S.high===ring?null:ring; }
window.__push=function(m){ try{ if(m.type==='data'){ S.people=m.people; S.tiers=m.tiers||[]; S.rows=m.rows||[]; S.me=m.me&&m.me.found?m.me:null; layout(); } else if(m.type==='motion'){ S.motion=m.mode; } else if(m.type==='pause'){ S.paused=!!m.on; } else if(m.type==='reset'){ S.zoom=1; S.panX=0; S.panY=0; S.sel=null; S.selRow=null; S.high=null; } }catch(e){} };
window.addEventListener('resize',size); size(); requestAnimationFrame(loop); S.ready=true; post({type:'ready'});
})();
</script></body></html>`;
