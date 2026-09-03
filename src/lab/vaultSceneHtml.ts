// The living vault: the rain of phones, drawn on a canvas inside a WebView.
//
// This is the same drawing Alex approved on the studio page, carried over
// unchanged in spirit: three depths of falling phones, a pile whose height is
// the staked share, a cooling layer where exits hang with a 48-hour ring, and
// labels only for moves of a thousand SKR and up. The drizzle is density, not
// transactions, and the screen says so.
//
// It lives in a WebView for one reason: speed of getting it onto a phone. The
// canvas code is proven in a browser; Skia is the destination later, with the
// same formulas. Everything the scene knows arrives through window.__push from
// the React side; it never fetches anything itself.
export const VAULT_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, DPR=Math.min(2,window.devicePixelRatio||1);
var IN='rgba(124,240,188,1)',OUT='rgba(255,143,90,1)',WD='rgba(255,196,107,1)',GD='rgba(201,169,106,1)',CY='rgba(86,224,255,1)';
function rnd(a,b){return a+Math.random()*(b-a);}
function fmt(n){ if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M'; if(n>=1e3) return (n/1e3).toFixed(n>=1e4?0:1)+'K'; return String(Math.round(n)); }
function left(sec){ if(sec<=0) return 'ready'; var h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); return h>0? h+'h '+String(m).padStart(2,'0')+'m left' : m+'m left'; }
var glowCache={};
function glow(color,r){ var k=color+'|'+r; if(glowCache[k]) return glowCache[k]; var c=document.createElement('canvas'); c.width=c.height=Math.ceil(r*2*DPR); var x=c.getContext('2d'); x.scale(DPR,DPR); var g=x.createRadialGradient(r,r,0,r,r,r); g.addColorStop(0,color); g.addColorStop(0.35,color.replace(/[\d.]+\)$/,'0.45)')); g.addColorStop(1,color.replace(/[\d.]+\)$/,'0)')); x.fillStyle=g; x.fillRect(0,0,r*2,r*2); glowCache[k]=c; return c; }
function drawGlow(c,color,x,y,r,a){ c.globalAlpha=a==null?1:a; c.drawImage(glow(color,r),x-r,y-r,r*2,r*2); c.globalAlpha=1; }
var SZ=[[4.2,7.4],[6,10.6],[8.4,14.8]];
var spriteCache={};
function sprite(L,lit,tone,text){ var k=L+'|'+lit+'|'+tone+'|'+(text||''); if(spriteCache[k]) return spriteCache[k]; var w=SZ[L][0],h=SZ[L][1]; var c=document.createElement('canvas'); c.width=Math.ceil((w+8)*DPR*2); c.height=Math.ceil((h+8)*DPR*2); var x=c.getContext('2d'); x.scale(DPR*2,DPR*2); x.translate(4,4);
  var body=tone==='out'?'#5a2f26':tone==='gold'?'#6b5630':tone==='ready'?'#1e3d4a':'#2a3f4c', edge=tone==='out'?'#ff9f7a':tone==='gold'?'#e8cf95':tone==='ready'?'#7fe6ff':'#5f8494';
  x.fillStyle=body; x.strokeStyle=edge; x.lineWidth=0.7; x.beginPath(); x.roundRect(0,0,w,h,w*0.22); x.fill(); x.stroke();
  var scr=lit?(tone==='out'?'#ffb08a':tone==='gold'?'#ffe9b8':tone==='ready'?'#bff2ff':'#9ff6d2'):'#173a48';
  x.fillStyle=scr; x.beginPath(); x.roundRect(w*0.12,h*0.09,w*0.76,h*0.82,w*0.14); x.fill();
  if(!lit){ x.fillStyle='rgba(120,220,255,.35)'; x.beginPath(); x.roundRect(w*0.2,h*0.16,w*0.6,h*0.22,w*0.1); x.fill(); }
  x.fillStyle=lit?'rgba(0,0,0,.35)':'#213240'; x.beginPath(); x.arc(w*0.5,h*0.13,w*0.06,0,6.283); x.fill();
  if(text&&lit){ x.fillStyle='#07131A'; x.font='700 '+(text.length>3?3.4:4)+'px sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(text,w/2,h*0.55); }
  spriteCache[k]=c; return c; }
function drawPhone(L,lit,tone,text,x,y,rot,alpha){ var w=SZ[L][0],h=SZ[L][1]; var sp=sprite(L,lit,tone,text); ctx.save(); ctx.translate(x,y); ctx.rotate(rot||0); ctx.globalAlpha=alpha==null?1:alpha; ctx.drawImage(sp,-w/2-4,-h/2-4,w+8,h+8); ctx.restore(); }

var S={marks:[],storyK:1,story:null,night:false,lit:0.1,zoom:{k:1,target:1,cx:0,cy:0},lastTap:0,t:0,frozen:false,motion:'live',paused:false,idle:0,p:[],hang:[],tags:[],cols:0,pile:[],bump:[],piled:[],shock:0,percent:0.47,todayIn:0,todayOut:0,dustGap:0.4,me:null,last:null,now:Math.floor(Date.now()/1000),tickAt:performance.now(),ready:false,lastQueueKeys:''};
function pileTop(x){ var i=Math.min(S.cols-1,Math.max(0,Math.floor(x/8))); return H-(S.pile[i]+S.bump[i])*S.storyK; }
function size(){ W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); initPile(); }
function pileH(){ return H*(0.13+S.percent*0.24); }
function initPile(){ S.cols=Math.floor(W/8)+1; S.pile=[]; S.bump=[]; for(var i=0;i<S.cols;i++){ S.pile.push(pileH()*(0.97+0.04*Math.sin(i*0.22)+0.015*Math.sin(i*0.9))); S.bump.push(0);} S.piled=[]; for(var j=0;j<Math.round(S.cols*0.8);j++){ var col=Math.floor(Math.random()*S.cols); var depth=Math.pow(Math.random(),2)*0.3; S.piled.push({x:col*8+rnd(1,6),y:H-(1-depth)*(S.pile[col]-6),L:Math.floor(rnd(0,2)),rot:rnd(-0.12,0.12),dim:0.3+0.4*(1-depth/0.3),lit:0,tone:'in',win:Math.random()<S.lit,wph:Math.random()*6}); } S.piled.sort(function(a,b){return a.y-b.y;}); S.meX=W*0.8; }
function retarget(){ // the pile follows the real share smoothly
  for(var i=0;i<S.cols;i++){ var target=pileH()*(0.97+0.04*Math.sin(i*0.22)+0.015*Math.sin(i*0.9)); S.pile[i]+=(target-S.pile[i])*0.02; } }
function spawnDust(){ var L=Math.floor(rnd(0,3)); S.p.push({k:'in',x:rnd(6,W-6),y:-16,vy:rnd(36,60)*[0.6,0.85,1.15][L],vx:rnd(-5,5),L:L,lit:false,tone:'in',sw:Math.random()*6,life:1}); }
function spawnStake(amount,who,sig,x){ var big=amount>=1e5; x=x!=null?x:rnd(30,W-30);
  if(!big){ var L=amount>=1000?2:amount>=10?1:0; S.p.push({k:'in',x:x,y:-18,vy:L===2?52:L===1?44:36,vx:0,L:L,lit:true,tone:'in',sw:Math.random()*6,life:1,amt:amount,who:who,sig:sig,text:fmt(amount)}); return; }
  var n=Math.min(40,Math.round(10+10*Math.log10(amount/1e4))); for(var i=0;i<n;i++){ (function(i){ setTimeout(function(){ if(S.frozen) return; var L=Math.floor(rnd(1,3)); S.p.push({k:'in',x:x+rnd(-34,34),y:-18,vy:rnd(50,70)*(L?1.15:0.85),vx:rnd(-4,4),L:L,lit:true,tone:'in',sw:Math.random()*6,life:1,amt:i===0?amount:0,who:i===0?who:null,sig:i===0?sig:null,text:i===0?fmt(amount):'',lead:i===0}); },i*26); })(i); }
  tag(x,H*0.52,fmt(amount)+' SKR staked',who,'#9ff6d2',2.6,true); S.last={v:amount,who:who,kind:'staked',at:S.t}; }
function liftExit(amount,who,sig,big){ var col=Math.floor(rnd(4,S.cols-4)); var x=col*8+4; var top=pileTop(x); for(var i=0;i<S.cols;i++){ var d=Math.abs(i-col); if(d<5) S.bump[i]+=6*(1-d/5); }
  var n=big?Math.min(24,Math.round(8+6*Math.log10(amount/1e5))):Math.max(1,Math.round(Math.log10(amount/1e3))+1); var raft=[]; for(var j=0;j<n;j++) raft.push({dx:rnd(-16,16)*(big?1.6:1),dy:rnd(-6,6),L:big?Math.floor(rnd(1,3)):2,rot:rnd(-0.2,0.2)});
  S.hang.push({x:x,y:top-6,vy:-rnd(16,22),hangY:rnd(H*0.46,H*0.52),t:0,hold:big?9:6,amt:amount,who:who,sig:sig,raft:raft,big:big,state:'rise',life:1,sw:Math.random()*6,temp:true,frac:0});
  if(big){ tag(x,H*0.44,fmt(amount)+' SKR asked out',who,'#ffb08a',2.6,true); S.last={v:amount,who:who,kind:'asked out',at:S.t}; } }
function tag(x,y,txt,sub,tone,hold,rise,big){ S.tags=[]; S.tags.push({x:Math.max(70,Math.min(W-70,x)),y:y,txt:txt,sub:sub,tone:tone,t:0,hold:hold,rise:rise,big:big}); }
// Persistent hangs come from the real queue: one per pending position, placed
// by the real remaining time. Only the largest twelve are drawn, so a busy day
// does not turn the cooling layer into a wall.
function syncQueue(items){ var keys=items.map(function(q){return q.k;}).join(','); if(keys===S.lastQueueKeys){ items.forEach(function(q){ var h=S.hang.find(function(x){return x.key===q.k;}); if(h){ h.amt=q.amount; h.unlockAt=q.unlockAt; } }); return; } S.lastQueueKeys=keys;
  var keep={}; var slots=Math.max(1,items.length); items.forEach(function(q,i){ keep[q.k]=1; var h=S.hang.find(function(x){return x.key===q.k;}); if(!h){ var n=Math.max(1,Math.min(6,Math.round(Math.log10(Math.max(1000,q.amount)/1e4))+2)); var raft=[]; for(var j=0;j<n;j++) raft.push({dx:rnd(-11,11),dy:rnd(-4,4),L:q.amount>=1e5?Math.floor(rnd(1,3)):1,rot:rnd(-0.2,0.2)}); var x=slots===1?W/2:34+(W-68)*(i/(slots-1)); S.hang.push({key:q.k,x:x,y:H*0.45,vy:-14,hangY:(i%2===0?H*0.2:H*0.33),t:0,hold:1e9,amt:q.amount,who:q.who,unlockAt:q.unlockAt,startAt:q.startAt,raft:raft,big:q.amount>=1e5,state:'rise',life:1,sw:Math.random()*6}); } });
  S.hang.forEach(function(h){ if(h.key&&!keep[h.key]&&h.state!=='fly'&&h.state!=='fall'){ h.state='fly'; h.vy=0; } }); }
function spawnSixteen(){ var x=S.meX; for(var i=0;i<16;i++){ (function(i){ setTimeout(function(){ S.p.push({k:'in',x:x-18+(i%8)*5.2,y:-18-(i>7?12:0),vy:64,vx:0,L:1,lit:true,tone:'gold',sw:0,life:1,amt:0,text:'1',gold:true,lead:i===15}); },i*70); })(i); } }
var acc=0;
function step(dt){ S.t+=dt; S.idle+=dt; var calm=S.motion==='calm'||(S.motion==='live'&&S.idle>90); var density=calm?0.12:1;
  S.shock=Math.max(0,S.shock-dt); retarget();
  S.zoom.k+=(S.zoom.target-S.zoom.k)*Math.min(1,dt*3);
  if(S.story){ S.story.t+=dt; var sp=Math.min(1,S.story.t/6); S.storyK=0.05+0.95*(1-Math.pow(1-sp,3)); if(S.story.t>7){ S.story=null; S.storyK=1; } }
  for(var i=0;i<S.cols;i++) S.bump[i]*=Math.pow(0.05,dt);
  S.p.forEach(function(q){ var sz=[0.6,0.85,1.15][q.L]; q.vy+=110*dt*sz; q.y+=q.vy*dt; q.x+=(q.gold?0:Math.sin(S.t*2+q.sw)*7*dt)+q.vx*dt; var top=pileTop(q.x); if(q.y>=top-5){ q.dead=1; var col=Math.min(S.cols-1,Math.max(0,Math.floor(q.x/8))); S.bump[col]+=q.lit?2.5:0.8; if(col>0) S.bump[col-1]+=1; if(col<S.cols-1) S.bump[col+1]+=1; if(q.lit&&q.lead) S.shock=Math.max(S.shock,0.7); S.piled.push({x:q.x,y:top-5,L:q.L,rot:rnd(-0.12,0.12),lit:q.lit?1:0,dim:0.9,tone:q.tone,text:q.text,win:Math.random()<S.lit,wph:Math.random()*6}); if(S.piled.length>Math.round(S.cols*3)) S.piled.shift(); if(q.amt){ S.todayIn+=q.amt; } } });
  S.p=S.p.filter(function(q){return !q.dead;});
  S.hang.forEach(function(h){ if(h.state==='rise'){ h.y+=h.vy*dt; if(h.y<=h.hangY){ h.state='hang'; } } else if(h.state==='hang'){ h.t+=dt; h.y=h.hangY+Math.sin(S.t*1.2+h.sw)*2; h.x+=Math.sin(S.t*0.6+h.sw)*2*dt; if(h.temp&&h.t>h.hold){ h.life-=dt*0.8; } if(h.unlockAt&&h.unlockAt<=S.now) h.state='ready'; } else if(h.state==='ready'){ h.y=h.hangY+Math.sin(S.t*6)*1.2; } else if(h.state==='fly'){ h.vy=(h.vy||0)-160*dt; h.y+=h.vy*dt; h.life-=dt*0.5; if(h.y<-30) h.dead=1; } else if(h.state==='fall'){ h.vy+=200*dt; h.y+=h.vy*dt; if(h.y>=pileTop(h.x)-6){ h.dead=1; S.bump[Math.min(S.cols-1,Math.floor(h.x/8))]+=5; } } });
  S.hang=S.hang.filter(function(h){return !h.dead&&h.life>0;});
  S.tags.forEach(function(t){ t.t+=dt; if(t.rise) t.y-=8*dt; }); S.tags=S.tags.filter(function(t){return t.t<t.hold;});
  S.piled.forEach(function(q){ if(q.lit) q.lit=Math.max(0,q.lit-dt*0.18); });
}
var BG=null, bgKey='';
function background(c){ var mood=S.todayOut>S.todayIn?0:1; var key=W+'x'+H+'|'+mood+'|'+(S.night?1:0); if(bgKey!==key){ BG=document.createElement('canvas'); BG.width=Math.round(W*DPR); BG.height=Math.round(H*DPR); var x=BG.getContext('2d'); x.scale(DPR,DPR); var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,S.night?'#070E15':'#0A1722'); g.addColorStop(0.5,S.night?'#081420':mood?'#0C2030':'#0A1A26'); g.addColorStop(1,S.night?'#0A1A24':'#0B1F2B'); x.fillStyle=g; x.fillRect(0,0,W,H);
  for(var i=0;i<W*H*0.06;i++){ var px=Math.random()*W, py=Math.random()*H; x.fillStyle=(i&1)?'rgba(255,255,255,0.028)':'rgba(0,0,0,0.05)'; x.fillRect(px,py,1,1); }
  for(var di=0;di<70;di++){ x.fillStyle='rgba(160,205,225,'+(0.14+0.22*Math.random())+')'; x.fillRect(Math.random()*W,Math.random()*H*0.6,1.2,1.2); }
  x.fillStyle='rgba(255,196,107,.035)'; x.fillRect(0,H*0.12,W,H*0.3); x.strokeStyle='rgba(255,196,107,.1)'; x.setLineDash([2,6]); x.lineWidth=1; x.beginPath(); x.moveTo(0,H*0.12); x.lineTo(W,H*0.12); x.moveTo(0,H*0.42); x.lineTo(W,H*0.42); x.stroke(); x.setLineDash([]);
  bgKey=key; } c.drawImage(BG,0,0,W,H); }
function draw(){ var c=ctx; var Z=S.zoom.k, K=S.storyK, LBL=Z<1.3;
  background(c);
  c.save(); c.translate(S.zoom.cx,S.zoom.cy); c.scale(Z,Z); c.translate(-S.zoom.cx,-S.zoom.cy);
  if(LBL){ c.fillStyle='rgba(255,214,150,.85)'; c.font='600 10px sans-serif'; c.textAlign='left'; c.fillText('COOLING 48H · '+fmt(S.pending||0)+' SKR',12,H*0.12-6); }
  c.beginPath(); c.moveTo(0,H); for(var i=0;i<S.cols;i++){ var x=i*8; var y=H-(S.pile[i]+S.bump[i])*K+(S.shock>0?Math.sin(i*0.7+S.t*14)*3*S.shock:0); c.lineTo(x,y);} c.lineTo(W,H); c.closePath(); if(!S.pg||S.pgH!==H){ S.pg=c.createLinearGradient(0,H*0.5,0,H); S.pg.addColorStop(0,'#0F2A36'); S.pg.addColorStop(1,'#050C12'); S.pe=c.createLinearGradient(0,H*0.5,0,H*0.63); S.pe.addColorStop(0,'rgba(124,240,188,.2)'); S.pe.addColorStop(1,'rgba(124,240,188,0)'); S.pgH=H; } c.fillStyle=S.pg; c.fill(); c.fillStyle=S.pe; c.fill();
  c.save(); c.clip();
  S.piled.forEach(function(q){ var y=H-(H-q.y)*K; var win=S.night&&q.win; if(q.lit>0.05){ drawGlow(c,q.tone==='gold'?GD:IN,q.x,y,13,q.lit*0.8); } else if(win){ drawGlow(c,'rgba(255,228,170,1)',q.x,y,8,0.3+0.2*Math.sin(S.t*2+q.wph)); } drawPhone(q.L,q.lit>0.05||win,win&&q.lit<=0.05?'gold':q.tone,q.text,q.x,y,q.rot,(q.lit>0.05||win)?1:q.dim); });
  c.restore();
  S.marks.forEach(function(mk){ var my2=pileTop(mk.x)+8; drawGlow(c,IN,mk.x,my2,24,0.5+0.15*Math.sin(S.t*1.5+mk.ph)); mk.raft.forEach(function(r){ drawPhone(r.L,true,'in','',mk.x+r.dx,my2+r.dy,r.rot,1); }); if(LBL){ c.fillStyle='#9ff6d2'; c.font='700 11px sans-serif'; c.textAlign='center'; c.fillText(fmt(mk.amount)+' SKR',mk.x,my2-18); if(mk.who){ c.fillStyle='rgba(232,207,149,.95)'; c.font='600 9.5px sans-serif'; c.fillText(mk.who,mk.x,my2-7); } } });
  if(S.me){ var mx=S.meX,my=pileTop(mx)+10; if(!LBL){ c.fillStyle='#F2E7C9'; c.font='600 3.4px sans-serif'; c.textAlign='center'; c.fillText(S.me.name+' · '+fmt(S.me.amount)+' SKR · this is you',mx,my-9); } drawGlow(c,GD,mx,my,26,0.75); for(var k=0;k<5;k++) drawPhone(1,true,'gold',k===2?'you':'',mx-14+k*7,my+(k%2)*3,(k-2)*0.03,1); if(LBL){ c.fillStyle='#F2E7C9'; c.font='600 11.5px sans-serif'; c.textAlign='center'; c.fillText(S.me.name+' · '+fmt(S.me.amount)+(S.me.days?' · '+S.me.days+' days':''),mx,my-17); } }
  if(LBL&&S.tags.length===0&&S.last&&S.t-S.last.at>40){ c.fillStyle='rgba(255,196,107,.45)'; c.font='600 9px sans-serif'; c.textAlign='center'; c.fillText('LAST BIG MOVE · '+fmt(S.last.v)+' '+S.last.kind.toUpperCase()+(S.last.who?' · '+S.last.who:''),W/2,H*0.5); }
  S.hang.forEach(function(h){ var a=Math.min(1,h.life); var tone='out'; var col=OUT; drawGlow(c,col,h.x,h.y,h.big?30:16,0.38*a); h.raft.forEach(function(r){ drawPhone(r.L,true,tone,'',h.x+r.dx,h.y+r.dy,r.rot+Math.sin(S.t+h.sw)*0.05,a); });
    if(LBL&&(h.state==='hang'||h.state==='ready')){ var R=(h.big?26:14); var frac=h.unlockAt&&h.startAt?Math.max(0,Math.min(1,1-(S.now-h.startAt)/172800)):Math.max(0,1-h.t/h.hold); c.strokeStyle=h.state==='ready'?'rgba(86,224,255,.9)':'rgba(255,196,107,.85)'; c.lineWidth=1.3; c.globalAlpha=a; c.beginPath(); c.arc(h.x,h.y,R,-1.571,-1.571+6.283*frac); c.stroke(); c.strokeStyle='rgba(255,255,255,.08)'; c.beginPath(); c.arc(h.x,h.y,R,0,6.283); c.stroke();
      c.fillStyle='#ffd58f'; c.font='700 12px sans-serif'; c.textAlign='center'; c.fillText(fmt(h.amt)+' SKR',h.x,h.y+R+13); c.fillStyle='rgba(255,255,255,.85)'; c.font='500 9.5px sans-serif'; if(h.state==='ready'){ c.fillStyle='#bff2ff'; } c.fillText(h.state==='ready'?'ready':h.unlockAt?left(h.unlockAt-S.now).replace(' left',''):'cooling',h.x,h.y+R+25); c.globalAlpha=1; } });
  [0,1,2].forEach(function(L){ S.p.forEach(function(q){ if(q.L!==L) return; var rot=q.gold?0:Math.sin(S.t*2+q.sw)*0.15; var al=q.life*(0.5+L*0.25); if(q.lit){ drawGlow(c,q.tone==='gold'?GD:IN,q.x,q.y,SZ[L][1]*1.3,0.7); al=1; } drawPhone(L,q.lit,q.tone,q.text,q.x,q.y,rot,al); if(q.lit&&q.text&&!q.gold&&L===2){ c.fillStyle=L===2?'rgba(159,246,210,1)':'rgba(159,246,210,.85)'; c.font=(L===2?'700 11px':'600 9.5px')+' sans-serif'; c.textAlign='left'; c.fillText(q.text,q.x+(L===2?9:6),q.y+3); } }); });
  if(LBL) S.tags.forEach(function(t){ var a=t.t<0.25?t.t/0.25:t.t>t.hold-0.5?(t.hold-t.t)/0.5:1; c.globalAlpha=a; c.font=(t.big?'700 18px':'700 12px')+' sans-serif'; c.textAlign='center'; var w=c.measureText(t.txt).width+20; c.fillStyle='rgba(6,10,14,.85)'; c.beginPath(); c.roundRect(t.x-w/2,t.y-(t.big?26:15),w,t.big?44:32,8); c.fill(); c.strokeStyle=t.tone; c.globalAlpha=a*0.6; c.stroke(); c.globalAlpha=a; c.fillStyle=t.tone; c.fillText(t.txt,t.x,t.y-1); if(t.sub){ c.fillStyle='#C9A96A'; c.font='600 9px sans-serif'; c.fillText(t.sub,t.x,t.y+11); } c.globalAlpha=1; });
  c.restore();
  if(!LBL){ c.fillStyle='rgba(242,231,201,.8)'; c.font='600 9px sans-serif'; c.textAlign='center'; c.fillText('INSIDE THE VAULT · double-tap to leave',W/2,H*0.12); }
  if(S.story){ c.fillStyle='rgba(242,247,251,.85)'; c.font='600 10px sans-serif'; c.textAlign='center'; c.fillText('HOW THE VAULT WAS BUILT · SINCE JANUARY 2026',W/2,H*0.12); }
  if(S.night&&LBL){ c.fillStyle='rgba(255,228,170,.6)'; c.font='600 8px sans-serif'; c.textAlign='left'; c.fillText('NIGHT · lit windows are wallets that staked today',12,H*0.56); }
  if(S.replayUntil&&S.t<S.replayUntil){ c.fillStyle='rgba(159,246,210,.7)'; c.font='600 10px sans-serif'; c.textAlign='right'; c.fillText('replaying the last '+(S.replayCount||0)+' moves',W-12,H*0.55); }
  if(S.frozen){ c.fillStyle='rgba(200,225,240,.10)'; c.fillRect(0,0,W,H); c.fillStyle='#FFC46B'; c.font='600 10px sans-serif'; c.textAlign='left'; c.fillText('FROZEN · WAITING FOR A FINALIZED ANSWER',12,H*0.1); }
}
var last=performance.now(), a2=0;
function loop(now){ var dt=Math.min(0.05,(now-last)/1000); last=now; a2+=dt; var calm=S.motion==='calm'||(S.motion==='live'&&S.idle>90); if(!S.paused&&S.motion!=='off'){ if(calm){ if(a2>=1){ var st=Math.min(a2,1); a2=0; if(!S.frozen) step(st); draw(); } } else { a2=0; if(now-S.tickAt>1000){ S.now=Math.floor(Date.now()/1000); S.tickAt=now; } if(!S.frozen) step(dt); draw(); } } requestAnimationFrame(loop); }
size(); draw(); requestAnimationFrame(loop);
window.addEventListener('resize',size);
document.addEventListener('touchstart',function(){ S.idle=0; },{passive:true});
cv.addEventListener('click',function(e){ var x=e.clientX, y=e.clientY, hit=null; var nowMs=performance.now(); if(nowMs-S.lastTap<350&&S.me){ S.zoom.target=S.zoom.target>1?1:3; S.zoom.cx=S.meX; S.zoom.cy=pileTop(S.meX)+6; S.lastTap=0; S.idle=0; return; } S.lastTap=nowMs; S.hang.forEach(function(h){ if(Math.hypot(h.x-x,h.y-y)<32) hit={kind:'exit',amount:h.amt,who:h.who||'',sig:h.sig||'',unlockAt:h.unlockAt||0,ready:h.state==='ready'}; }); S.p.forEach(function(q){ if(q.lit&&q.text&&!q.gold&&Math.hypot(q.x-x,q.y-y)<18) hit={kind:'stake',amount:q.amt||0,who:q.who||'',sig:q.sig||''}; }); S.marks.forEach(function(mk){ if(Math.hypot(mk.x-x,pileTop(mk.x)+8-y)<26) hit={kind:'stake',amount:mk.amount,who:mk.who||'',sig:mk.sig||''}; }); if(hit&&window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'tap',hit:hit})); } S.idle=0; });
window.__push=function(m){ try{ if(!m) return;
  if(m.type==='state'){ if(typeof m.percent==='number') S.percent=Math.max(0.02,Math.min(0.95,m.percent/100)); S.pending=m.pending||0; if(typeof m.todayIn==='number') S.todayIn=m.todayIn; if(typeof m.todayOut==='number') S.todayOut=m.todayOut; if(m.eventsLastHour){ S.dustGap=Math.max(0.15,Math.min(0.6,60/Math.max(20,m.eventsLastHour))); } if(m.queue) syncQueue(m.queue); if(m.now) S.now=m.now; }
  else if(m.type==='events'){ var items=m.items||[]; var gapMs=m.replay?Math.min(900,45000/Math.max(1,items.length)):160; if(m.replay){ S.replayUntil=S.t+Math.min(50,items.length*gapMs/1000+2); S.replayCount=items.length; } items.forEach(function(e,i){ setTimeout(function(){ if(S.frozen) return; var a=e.amount||0; if(e.kind==='stake'){ spawnStake(a,e.who,e.sig); } else if(e.kind==='unstake'){ if(a>=1000) liftExit(a,e.who,e.sig,a>=1e5); } else if(e.kind==='withdraw'){ var h=S.hang.find(function(x){return x.who&&x.who===e.who&&x.state!=='fly';}); if(h){ h.state='fly'; h.vy=0; } if(a>=1000) tag(rnd(70,W-70),H*0.58,fmt(a)+' SKR withdrawn',e.who,'#9ff6d2',2,true); } else if(e.kind==='cancel_unstake'){ var h2=S.hang.find(function(x){return x.who&&x.who===e.who&&x.state==='hang';}); if(h2){ h2.state='fall'; h2.vy=10; } tag(rnd(70,W-70),H*0.58,'exit cancelled'+(a>=1000?' · '+fmt(a)+' SKR':''),e.who,'#56E0FF',1.8,false); } },i*gapMs); }); }
  else if(m.type==='me'){ S.me=m.me||null; if(m.sixteen) spawnSixteen(); }
  else if(m.type==='freeze'){ S.frozen=!!m.on; }
  else if(m.type==='story'){ S.story={t:0}; S.storyK=0.05; }
  else if(m.type==='landmarks'){ var slots=[0.14,0.36,0.58]; S.marks=(m.items||[]).slice(0,3).map(function(e,i){ var n=Math.max(3,Math.min(7,Math.round(Math.log10(Math.max(1,e.amount)/1e3))+2)); var raft=[]; for(var j=0;j<n;j++) raft.push({dx:rnd(-12,12),dy:rnd(-3,3),L:Math.floor(rnd(1,3)),rot:rnd(-0.15,0.15)}); return {x:W*slots[i],amount:e.amount,who:e.who,sig:e.sig,raft:raft,ph:Math.random()*6}; }); }
  else if(m.type==='night'){ S.night=!!m.on; if(typeof m.lit==='number'){ S.lit=Math.max(0.04,Math.min(0.5,m.lit)); S.piled.forEach(function(q){ q.win=Math.random()<S.lit; }); } }
  else if(m.type==='motion'){ S.motion=m.mode||'live'; S.idle=0; if(S.motion==='off') draw(); }
  else if(m.type==='pause'){ S.paused=!!m.on; if(!S.paused){ last=performance.now(); } }
  else if(m.type==='demo'){ if(m.what==='whalein') spawnStake(412000,'demo',null); if(m.what==='whaleout') liftExit(2100000,'demo',null,true); }
 }catch(err){} };
S.ready=true; if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
})();
</script></body></html>`;
