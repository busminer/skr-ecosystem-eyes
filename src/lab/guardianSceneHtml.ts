import { GUARDIAN_BRAND, GUARDIAN_MARKS } from './guardianLogos';
import { GLYPH_DATA_URL } from './vaultSceneHtml';

// The guardians at work: a small world where a release comes in, is looked at,
// and either goes down into the store or does not.
//
// The ground is the night every tab stands in. Along the bottom rises the
// store: the vault's own moon with the token's mark, lit windows on it, and
// along its edge the day's releases standing where they came down. Across the
// middle runs the belt, a rail of light the apps ride in on from the left,
// with the plate at its centre. Over the plate hang the guardians.
//
// A guardian is a medallion: a thick coin in its own colours with its own mark
// struck into the face, lit from the upper left. It sways, so the milled edge
// and the glint on the face are never still. When it votes it jumps, turns
// once round, comes to rest facing the app, and its light falls on the tile:
// green for yes, red for no, with the seconds the vote took written under its
// name.
//
// An app is its own icon from the store, under its own store name; while it
// has none yet, its initials. Its frame takes the colour of the votes as they
// land: one yes of three is a light green, two is deeper, three is the full
// colour, and a no takes its share of the frame in red, so a split vote reads
// as a split tile. Passed, the trapdoor under the plate opens and the app
// falls to the store's shelf; turned away, the trapdoor stays shut, the tile
// shakes and is carried off the end of the belt. An app that passed on two
// votes waits a while for the third, so the third can land where it is seen.
// Our own release is gold.
//
// Live, real votes play as they arrive. On opening, the last two releases go
// through once more, and between real events one past release does now and
// then; both carry their age under the name. The 24 hour replay sends the
// whole day down the belt again in twenty seconds.
//
// Same approach as the vault and the radar: a canvas in a WebView, fed through
// window.__push. Push the server's summary as it is, or the same under
// `type: 'state'`; the scene reads `guardians` and `releases` and finds what
// is new by release key and vote signature. It fetches nothing of its own
// except the app icons, which are images from the URLs the server names
// (joined to `iconBase` when they start with a slash).

export type GuardianSceneState = {
  updatedAt: number | string;
  iconBase?: string | null;
  guardians: Array<{ key: string; id: string | null; name: string | null; lastVoteAt?: number | null }>;
  releases: Array<{
    key: string;
    app: string;
    pkg?: string | null;
    versionCode?: number | null;
    name?: string | null;
    icon?: string | null;
    requestedAt: number | string;
    sig?: string | null;
    votes: Array<{ guardian: string; approve: boolean; at: number | string; seconds?: number | null; sig?: string | null }>;
    verdict: 'pending' | 'approved' | 'rejected';
    liveAt?: number | null;
    ours?: boolean;
  }>;
};

// Words the scene draws. `ago` and `lastVote` take `{age}`.
export type GuardianSceneLabels = Partial<Record<'live' | 'lapse' | 'passed' | 'ago' | 'lastVote' | 'waiting', string>>;

export type GuardianSceneMessage =
  | ({ type: 'state' } & GuardianSceneState)
  | { type: 'motion'; mode: 'live' | 'calm' | 'off' }
  | { type: 'pause'; on: boolean }
  | { type: 'inset'; top: number; bottom?: number }
  // Twenty four hours replayed in `seconds` (20 by default); `on: false` stops it.
  | { type: 'timelapse'; on: boolean; seconds?: number }
  // `logos: false` strikes the guardians' initials into plain medallions instead
  // of their marks. `ambient: false` stops the look back between real events.
  | { type: 'config'; logos?: boolean; hud?: boolean; ambient?: boolean; iconBase?: string; labels?: GuardianSceneLabels };

export type GuardianSceneEvent =
  | { type: 'ready' }
  | { type: 'beat' }
  | { type: 'error'; message: string }
  | { type: 'timelapse'; state: 'start' | 'end' }
  // A real vote or verdict has just been played (never a replayed one): for a buzz.
  | { type: 'cue'; kind: 'vote'; approve: boolean; key: string }
  | { type: 'cue'; kind: 'approved' | 'rejected'; key: string }
  | { type: 'tap'; kind: 'none' | 'store' }
  | { type: 'tap'; kind: 'guardian'; key: string; id: string | null; name: string | null }
  | { type: 'tap'; kind: 'release'; key: string; app: string; pkg: string | null; versionCode: number | null; name: string; sig: string | null; verdict: 'pending' | 'approved' | 'rejected' };

export const GUARDIAN_SCENE_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;background:#04070B;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="cv"></canvas>
<script>
(function(){
var cv=document.getElementById('cv'), ctx=cv.getContext('2d'), W=0, H=0, U=1, DPR=Math.min(2,window.devicePixelRatio||1), TAU=Math.PI*2;
var TEXT='#F2F7FB', MUTED='#8296A8', FAINT='#6F849A', ACCENT='#56E0FF', GOLD='#C9A96A', GREEN='#7CF0BC', RED='#FF7E79';
var MARK_SRC={solana_mobile:'${GUARDIAN_MARKS.solana_mobile}',jito:'${GUARDIAN_MARKS.jito}',helius:'${GUARDIAN_MARKS.helius}'}, MARK={};
var BRAND=${JSON.stringify(GUARDIAN_BRAND)};
var GLYPH=new Image(); GLYPH.src='${GLYPH_DATA_URL}';
var CFG={logos:true,hud:true,ambient:true,iconBase:'',labels:{live:'LIVE',lapse:'24 HOURS',passed:'passed · 24h',ago:'{age} ago',lastVote:'last vote {age} ago',waiting:'waiting for the next release'}};
var S={t:0,idle:0,motion:'live',paused:false,insTop:0,insBot:0,off:0,has:false,G:[],R:{},order:[],shelf:[],rej:0,rejects:[],rbump:0,N:0,actors:[],q:[],plate:null,parked:[],checks:[],pings:[],tl:null,beatAt:0,amb:0,door:0,lock:0,bump:0,f:1,sel:null,bg:null,bgKey:'',lastVoteAt:0,img:{},M:11};

function post(m){ try{ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); else if(window.parent&&window.parent!==window) window.parent.postMessage({__scene:m},'*'); }catch(e){} }
function clamp(x,a,b){ return x<a?a:x>b?b:x; }
function eo(k){ return 1-Math.pow(1-k,3); }
function eio(k){ return k<0.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2; }
function rgb(hex){ var n=parseInt(String(hex).slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function rgba(hex,a){ var c=rgb(hex); return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')'; }
function mix(hex,to,k,a){ var p=rgb(hex), q=rgb(to); return 'rgba('+Math.round(p[0]+(q[0]-p[0])*k)+','+Math.round(p[1]+(q[1]-p[1])*k)+','+Math.round(p[2]+(q[2]-p[2])*k)+','+(a==null?1:a)+')'; }
function nowS(){ return Date.now()/1000+S.off; }
function stamp(v){ return typeof v==='number'?v:(v?Date.parse(v)/1000:0); }
function age(sec){ sec=Math.max(0,Math.round(sec)); if(sec<60) return sec+'s'; if(sec<3600) return Math.round(sec/60)+'m'; if(sec<86400) return Math.round(sec/3600)+'h'; return Math.round(sec/86400)+'d'; }
function secs(s){ s=Math.max(0,Math.round(+s||0)); return s<100?s+'s':Math.floor(s/60)+'m'+(s%60<10?'0':'')+(s%60); }
function two(n){ return n<10?'0'+n:''+n; }
function initials(name,fallback){ var w=String(name||'').replace(/([a-z])([A-Z])/g,'$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean); if(!w.length) return String(fallback||'?').slice(0,2).toUpperCase(); var a=Array.from(w[0]), b=w.length>1?Array.from(w[1]):null; return b?(a[0]+b[0]).toUpperCase():a[0].toUpperCase()+(a[1]||'').toLowerCase(); }
function hash(s){ var h=7; s=String(s); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%100003; return h; }
// An app with no icon yet wears its initials on one of four quiet tones, so a
// shelf of new arrivals is not a row of the same tile.
var PAL=[['#123040','#081620','#9FDDF2'],['#16294A','#0A1428','#AFC9FF'],['#1F2B37','#0D141B','#C9D6E1'],['#103A36','#071B19','#A2F2DD']];
function glow(hex,x,y,r,a){ if(a<=0.004||r<=0) return; var g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,rgba(hex,a)); g.addColorStop(0.4,rgba(hex,a*0.42)); g.addColorStop(1,rgba(hex,0)); ctx.fillStyle=g; ctx.fillRect(x-r,y-r,r*2,r*2); }
function rr(x,y,w,h,r){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
// A name cut to the room it has, once per width: measuring on every frame is
// the kind of small cost that shows as a stutter on a phone.
function fit(r,text,font,max){ var key=font+'|'+Math.round(max), c=r.fits||(r.fits={}); if(c[key]) return c[key]; ctx.font=font; var s=String(text||''); if(ctx.measureText(s).width>max){ while(s.length>2&&ctx.measureText(s+'…').width>max) s=s.slice(0,-1); s=s.replace(/\s+$/,'')+'…'; } c[key]=s; return s; }
// A long name takes a second line before it loses letters.
function wrap(r,text,font,max){ var key='w'+font+'|'+Math.round(max), c=r.fits||(r.fits={}); if(c[key]) return c[key]; ctx.font=font; var s=String(text||''), out; if(ctx.measureText(s).width<=max) out=[s]; else { var w=s.split(' '), a='', i=0; while(i<w.length&&ctx.measureText((a?a+' ':'')+w[i]).width<=max){ a=(a?a+' ':'')+w[i]; i++; } if(!a) out=[fit(r,s,font,max)]; else { var b=w.slice(i).join(' '); if(ctx.measureText(b).width>max){ while(b.length>2&&ctx.measureText(b+'…').width>max) b=b.slice(0,-1); b=b.replace(/\s+$/,'')+'…'; } out=[a,b]; } } c[key]=out; return out; }
function picture(url){ if(!url) return null; if(url.charAt(0)==='/') url=(CFG.iconBase||'')+url; var e=S.img[url]; if(!e){ e=S.img[url]={im:new Image(),ok:false}; e.im.onload=function(){ e.ok=true; }; e.im.src=url; } return e; }

function size(){ if(window.innerWidth<2||window.innerHeight<2){ setTimeout(size,120); return; } W=window.innerWidth; H=window.innerHeight; cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); layout(); }
// The night every tab stands in (AppSky): its gradient, its breath of aurora
// high on the right, its teal glow low on the left, its stars.
function sky(){ var key=W+'x'+H; if(S.bgKey===key) return; var bg=document.createElement('canvas'); bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR); var x=bg.getContext('2d'); x.scale(DPR,DPR);
  var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,'#060A11'); g.addColorStop(0.45,'#050910'); g.addColorStop(1,'#03060A'); x.fillStyle=g; x.fillRect(0,0,W,H);
  var au=x.createLinearGradient(0,H*0.02,0,H*0.3); au.addColorStop(0,'rgba(60,242,192,0)'); au.addColorStop(0.5,'rgba(60,242,192,0.05)'); au.addColorStop(1,'rgba(86,224,255,0)'); x.fillStyle=au; x.beginPath(); x.moveTo(W*0.35,H*0.02); x.bezierCurveTo(W*0.62,H*0.06,W*0.8,H*0.04,W*1.02,H*0.12); x.lineTo(W*1.02,H*0.3); x.bezierCurveTo(W*0.8,H*0.2,W*0.6,H*0.22,W*0.38,H*0.14); x.closePath(); x.fill();
  x.save(); x.translate(W*0.18,H*0.9); x.scale(W*0.7,H*0.35); var low=x.createRadialGradient(0,0,0,0,0,1); low.addColorStop(0,'rgba(18,128,143,0.07)'); low.addColorStop(1,'rgba(18,128,143,0)'); x.fillStyle=low; x.fillRect(-1,-1,2,2); x.restore();
  function hs(n){ var v=Math.sin(n*12.9898+78.233)*43758.5453; return v-Math.floor(v); }
  for(var i=0;i<64;i++){ x.globalAlpha=0.08+hs(i*13+4)*0.24; x.fillStyle='#D8F4FF'; x.beginPath(); x.arc(hs(i*3+1)*W,hs(i*7+2)*0.62*H,0.5+hs(i*11+3)*0.9,0,TAU); x.fill(); } x.globalAlpha=1; S.bg=bg; S.bgKey=key; }

// Top to bottom, the way a release goes: the guardians above, the belt with
// the plate in the middle of it, the store below.
var MED=[0,36,36,33,28,24,20.5];
function layout(){ sky(); var top=S.insTop, bot=S.insBot, h=Math.max(60,H-top-bot), n=Math.max(1,Math.min(6,S.G.length)), i;
  U=Math.min(W/360,h/430); S.cx=W/2; S.Rm=MED[n]*U; var gap=n>1?Math.min(W*0.30,(W-2*S.Rm-22*U)/(n-1)):0;
  for(i=0;i<S.G.length;i++){ var g=S.G[i], k=Math.min(i,n-1)-(n-1)/2; g.x=S.cx+k*gap; var kk=(g.x-S.cx)/(W/2); g.y=top+27*U+S.Rm+13*U*kk*kk; }
  S.St=58*U; S.Sq=38*U; S.yRail=top+h*0.585; S.xq=S.cx-W*0.335; S.xp=S.cx+W*0.335;
  S.Rs=W*0.80; S.limb=H-bot-h*0.20; S.cys=S.limb+S.Rs; S.mini=21*U; S.M=Math.max(5,Math.min(11,Math.floor((W-24*U)/(S.mini+6*U))));
  S.shelf.forEach(function(r){ var p=shelfPos(r); r.sx=p[0]; r.sy=p[1]; }); }
function trayPos(){ return [W-14*U-S.mini/2,S.yRail-9*U-S.mini/2]; }
function trayRel(){ for(var i=S.rejects.length-1;i>=0;i--) if(S.rejects[i].trayed) return S.rejects[i]; return null; }
function yFor(s){ return S.yRail-9*U-S.St*s/2; }
function slotQ(i){ return i===0?{x:S.xq,s:S.Sq/S.St,a:1}:i===1?{x:-S.Sq*0.1,s:S.Sq/S.St*0.92,a:0.75}:{x:-80*U,s:0.5,a:0}; }
function slotP(i){ return i===0?{x:S.xp,s:S.Sq/S.St,a:1}:{x:W+S.Sq*0.1,s:S.Sq/S.St*0.92,a:0.75}; }
function shelfList(){ return S.shelf.slice(-S.M); }
function shelfPos(r){ var L=shelfList(), j=L.indexOf(r), m=L.length, d=(S.mini+6*U)/S.Rs; if(j<0) j=-1.4; var a=-Math.PI/2+(j-(m-1)/2)*d, rad=S.Rs+S.mini*0.64; return [S.cx+Math.cos(a)*rad,S.cys+Math.sin(a)*rad]; }

// ---------- state ----------
function findG(ref){ if(ref==null) return -1; for(var i=0;i<S.G.length;i++) if(S.G[i].key===ref||S.G[i].id===ref) return i; return -1; }
function mk(r,mode){ var a={r:r,mode:mode,st:'q',x:-80*U,s:0.5,al:0,started:0,rev:0,nextAt:0,settledAt:0,t:0,flash:0,shake:0}; S.actors.push(a); return a; }
function enqueue(r,mode){ var a=mk(r,mode); S.q.push(a); if(mode==='replay') r.acting=a; return a; }
function drop(a){ var i=S.actors.indexOf(a); if(i>=0) S.actors.splice(i,1); i=S.q.indexOf(a); if(i>=0) S.q.splice(i,1); i=S.parked.indexOf(a); if(i>=0) S.parked.splice(i,1); if(S.plate===a) S.plate=null; if(a.r.acting===a) a.r.acting=null; }
function clearStage(){ S.actors=[]; S.q=[]; S.plate=null; S.parked=[]; S.checks=[]; S.pings=[]; S.door=0; S.lock=0; S.order.forEach(function(r){ r.acting=null; }); }
// Everything the last day decided, put where it ended up: on the store's
// shelf, or turned away. What is still undecided waits on the plate.
function settle(){ S.shelf=[]; S.rej=0; S.rejects=[];
  S.order.forEach(function(r){ r.vis=r.votes.length; r.landed=true; if(r.verdict==='approved'){ r.place='shelf'; S.shelf.push(r); } else if(r.verdict==='rejected'){ r.place='rejected'; S.rej++; S.rejects.push(r); r.trayed=true; } else r.place=null; });
  S.shelf.forEach(function(r){ var p=shelfPos(r); r.sx=p[0]; r.sy=p[1]; });
  var pend=S.order.filter(function(r){ return !r.place; }).slice(-3);
  pend.forEach(function(r,i){ var a=mk(r,'live'); a.started=a.rev=r.votes.length; a.al=1; if(i===pend.length-1){ a.st='plate'; S.plate=a; a.x=S.cx; a.s=1; } else { a.st='park'; S.parked.push(a); var p=slotP(S.parked.length-1); a.x=p.x; a.s=p.s; } }); }
function ingest(st){ var first=!S.has, up=stamp(st.updatedAt), fresh=[], late=[], seen={};
  if(up>0) S.off=up-Date.now()/1000;
  if(st.iconBase&&!CFG.iconBase) CFG.iconBase=st.iconBase;
  if(st.guardians){ var old={}, changed=st.guardians.length!==S.G.length; S.G.forEach(function(g){ old[g.key]=g; });
    S.G=st.guardians.slice(0,6).map(function(d){ var g=old[d.key]||{yaw:0,tilt:0,spinT:9,spinD:1,hot:0,lab:null,aim:null,x:0,y:0,tex:null}; if(!old[d.key]) changed=true; g.key=d.key; g.id=d.id||null; g.name=d.name||null; g.lastVoteAt=+d.lastVoteAt||0; if(g.lastVoteAt>S.lastVoteAt) S.lastVoteAt=g.lastVoteAt; return g; });
    if(changed){ S.G.forEach(function(g){ g.tex=null; }); layout(); } }
  S.N=+st.activeGuardians>0?+st.activeGuardians:S.G.length;
  if(!st.releases) return;
  st.releases.forEach(function(d){ if(!d||!d.key) return; seen[d.key]=1; var r=S.R[d.key], isNew=!r;
    if(isNew){ r=S.R[d.key]={key:d.key,votes:[],sigs:{},place:null,vis:0,landed:false,acting:null,sx:0,sy:0}; S.order.push(r); }
    r.app=d.app; r.pkg=d.pkg||null; r.vc=d.versionCode==null?null:d.versionCode; r.name=d.name||d.pkg||String(d.app||'').slice(0,6); r.verdict=d.verdict||'pending'; r.ours=!!d.ours; r.liveAt=d.liveAt||null; r.at=stamp(d.requestedAt); r.sig=d.sig||null; r.pic=picture(d.icon); r.fits=r.nameWas===r.name?r.fits:null; r.nameWas=r.name;
    (d.votes||[]).slice().sort(function(a,b){ return stamp(a.at)-stamp(b.at); }).forEach(function(v){ var id=v.sig||(v.guardian+':'+v.at); if(r.sigs[id]) return; r.sigs[id]=1; var o={g:v.guardian,yes:v.approve===false?false:true,at:stamp(v.at),seconds:v.seconds==null?Math.max(0,stamp(v.at)-r.at):+v.seconds,sig:v.sig||null}; r.votes.push(o); if(o.at>S.lastVoteAt) S.lastVoteAt=o.at; if(!isNew) late.push({r:r,v:o}); });
    if(isNew) fresh.push(r); });
  // Yesterday leaves the shelf.
  S.order=S.order.filter(function(r){ if(seen[r.key]) return true; if(r.acting) return true; delete S.R[r.key]; var i=S.shelf.indexOf(r); if(i>=0) S.shelf.splice(i,1); i=S.rejects.indexOf(r); if(i>=0){ S.rejects.splice(i,1); S.rej=S.rejects.length; } S.actors.slice().forEach(function(a){ if(a.r===r) drop(a); }); return false; });
  S.order.sort(function(a,b){ return a.at-b.at; });
  if(first){ S.has=true; settle(); intro(); return; }
  if(S.tl) return;
  // News. A phone that was away for hours does not replay the whole queue it
  // missed: the last two walk in, the rest are simply where they ended up.
  S.idle=0; fresh.sort(function(a,b){ return a.at-b.at; });
  fresh.forEach(function(r,i){ if(i<fresh.length-2){ r.vis=r.votes.length; r.landed=true; if(r.verdict==='approved'){ r.place='shelf'; S.shelf.push(r); var p=shelfPos(r); r.sx=p[0]; r.sy=p[1]; } else if(r.verdict==='rejected'){ r.place='rejected'; S.rej++; S.rejects.push(r); r.trayed=true; } } else enqueue(r,'live'); });
  late.forEach(function(l){ var has=S.actors.some(function(a){ return a.r===l.r&&a.mode!=='replay'; }); if(!has&&l.r.place==='shelf') S.checks.push({a:null,r:l.r,v:l.v,gi:findG(l.v.g),t:0,hit:0.5,dur:1.3,done:false,L:false,live:true}); });
}
// On opening, the last two releases go through once more, so the first look is
// at the thing happening. Their age is written under the name: it is a memory.
function intro(){ var pool=S.order.filter(function(r){ return r.place&&r.votes.length; }).slice(-2); pool.forEach(function(r){ enqueue(r,'replay'); }); S.amb=S.t+16; }

// ---------- the director ----------
function verdict(a){ var r=a.r, N=Math.max(1,S.N||S.G.length), need=Math.floor(N/2)+1, y=0, n=0, i; for(i=0;i<a.rev&&i<r.votes.length;i++){ if(r.votes[i].yes===false) n++; else y++; }
  if(y>=need) return 'approved'; if(n>=need) return 'rejected'; if(y+n>=N) return y>n?'approved':'rejected';
  if(a.mode!=='live'&&a.rev>=r.votes.length&&r.verdict!=='pending') return r.verdict; return null; }
// A vote: the guardian's medallion jumps, turns once round and comes to rest
// facing the app; its light falls on the tile, and where it lands the tile
// takes the colour of the vote.
function startVote(a){ var v=a.r.votes[a.started++], gi=findG(v.g), g=S.G[gi], L=a.mode==='lapse', f=L?S.f:1; a.settledAt=0;
  S.checks.push({a:a,r:a.r,v:v,gi:gi,t:0,hit:(L?0.17:0.52)/f,dur:(L?0.55:1.35)/f,done:false,L:L,live:a.mode==='live'});
  if(g){ g.spinT=0; g.spinD=(L?0.36:0.7)/f; g.hot=1; g.aim=a; g.lab={txt:'+'+secs(v.seconds),yes:v.yes,t:S.t,d:L?0.75:1.7}; } }
function landVote(c){ var p=target(c), yes=c.v.yes; if(c.a){ c.a.rev++; c.a.flash=1; } else c.r.vis=c.r.votes.length; S.pings.push({x:p[0],y:p[1],t:S.t,r0:p[2]*0.62,hex:yes?GREEN:RED,big:false}); if(c.live) post({type:'cue',kind:'vote',approve:yes,key:c.r.key}); }
function target(c){ if(c.a) return [c.a.x+c.a.shake,yFor(c.a.s),S.St*c.a.s]; return [c.r.sx,c.r.sy,S.mini]; }
function exitDrop(a){ var r=a.r; a.st='drop'; a.t=0; a.fx=a.x; a.fy=yFor(a.s); a.fs=a.s; a.dur=a.mode==='lapse'?0.44/Math.min(1.6,S.f):0.85; if(S.plate===a){ S.plate=null; S.door=1; } var i=S.parked.indexOf(a); if(i>=0) S.parked.splice(i,1);
  if(a.mode!=='replay'&&r.place!=='shelf'){ r.place='shelf'; r.landed=false; r.vis=r.votes.length; S.shelf.push(r); var p=shelfPos(r); r.sx=p[0]; r.sy=p[1]; } }
function exitEject(a){ a.st='eject'; a.t=0; a.ex=a.x; a.es=a.s; a.dur=a.mode==='lapse'?0.7:1.35; if(S.plate===a){ S.plate=null; S.lock=1; } var i=S.parked.indexOf(a); if(i>=0) S.parked.splice(i,1); }
function park(a){ a.st='park'; S.plate=null; S.parked.push(a); if(S.parked.length>2){ var old=S.parked.shift(); old.st='fade'; } }
function direct(){ var i, a;
  if(!S.plate&&S.q.length){ a=S.q.shift(); a.st='plate'; S.plate=a; a.nextAt=S.t+(a.mode==='lapse'?0.27/S.f:0.85); a.settledAt=0; }
  var list=S.plate?[S.plate].concat(S.parked):S.parked.slice();
  for(i=0;i<list.length;i++){ a=list[i]; var r=a.r, L=a.mode==='lapse';
    if(a.started<r.votes.length){ if(S.t>=a.nextAt){ startVote(a); a.nextAt=S.t+(L?0.18/S.f:a.mode==='replay'?1.0:1.4); } continue; }
    if(a.rev<a.started) continue;
    if(!a.settledAt) a.settledAt=S.t;
    var dec=verdict(a), N=Math.max(1,S.N||S.G.length), busy=S.q.length>0, hold=L?(busy?0.12:0.24)/S.f:a.mode==='replay'?1.15:dec?(a.rev>=N||busy?1.5:28):(busy&&a===S.plate?1.3:1e9);
    if(S.t-a.settledAt<hold) continue;
    if(dec==='approved') exitDrop(a); else if(dec==='rejected') exitEject(a); else if(a===S.plate) park(a); } }

// Twenty four hours in twenty seconds: every release of the day comes down
// the belt again in the order it was requested, and is voted on as it was.
function lapse(sec){ var now=nowS(); clearStage(); S.shelf=[]; S.rej=0; S.rejects=[]; S.order.forEach(function(r){ r.place=null; r.landed=false; r.trayed=false; r.vis=0; });
  var list=S.order.slice().sort(function(a,b){ return a.at-b.at; }); S.tl={t0:S.t+0.5,dur:Math.max(6,+sec||20),from:now-86400,list:list,i:0,vt:now-86400}; S.idle=0; post({type:'timelapse',state:'start'}); }
function lapseEnd(){ S.tl=null; S.f=1; clearStage(); settle(); S.amb=S.t+8; post({type:'timelapse',state:'end'}); }

function step(dt,coarse){ var i, a, k; S.t+=dt; S.idle+=dt; S.door=Math.max(0,S.door-dt*1.5); S.lock=Math.max(0,S.lock-dt*1.4); S.bump=Math.max(0,S.bump-dt*2.4); S.rbump=Math.max(0,S.rbump-dt*2.4);
  if(S.tl){ k=(S.t-S.tl.t0)/S.tl.dur; S.tl.vt=S.tl.from+clamp(k,0,1)*86400; S.f=clamp(1+0.3*S.q.length,1,2.6);
    while(S.tl.i<S.tl.list.length&&S.tl.list[S.tl.i].at<=S.tl.vt) enqueue(S.tl.list[S.tl.i++],'lapse');
    if((k>=1&&S.tl.i>=S.tl.list.length&&!S.actors.length&&!S.checks.length)||k>2.4) lapseEnd(); }
  direct();
  for(i=S.checks.length-1;i>=0;i--){ var c=S.checks[i]; c.t+=coarse?9:dt; if(!c.done&&c.t>=c.hit){ c.done=true; landVote(c); } if(c.t>=c.dur) S.checks.splice(i,1); }
  for(i=S.pings.length-1;i>=0;i--) if(S.t-S.pings[i].t>(S.pings[i].big?1.0:0.6)) S.pings.splice(i,1);
  for(i=0;i<S.G.length;i++){ var g=S.G[i]; g.hot=Math.max(0,g.hot-dt*0.9); if(g.spinT<g.spinD) g.spinT+=dt; var aim=g.hot>0.25&&g.aim?clamp((g.aim.x-g.x)/(W*0.5),-1,1)*0.5:0; g.tilt+=(aim-g.tilt)*Math.min(1,dt*6); }
  for(i=S.actors.length-1;i>=0;i--){ a=S.actors[i]; a.flash=Math.max(0,a.flash-dt*2.2); var L=a.mode==='lapse', rate=1-Math.exp(-dt*(L?13*S.f:6.5)), tg=null;
    if(a.st==='q') tg=slotQ(S.q.indexOf(a)); else if(a.st==='plate') tg={x:S.cx,s:1,a:1}; else if(a.st==='park') tg=slotP(S.parked.indexOf(a));
    if(tg){ a.x+=(tg.x-a.x)*rate; a.s+=(tg.s-a.s)*rate; a.al+=(tg.a-a.al)*rate; a.shake=0; continue; }
    a.t+=dt;
    if(a.st==='drop'){ if(a.t>=a.dur||coarse){ var r=a.r; r.landed=true; if(r.place!=='shelf'&&a.mode!=='replay'){ r.place='shelf'; } S.bump=1; S.pings.push({x:r.sx,y:r.sy,t:S.t,r0:S.mini*0.7,hex:r.ours?GOLD:GREEN,big:true}); if(a.mode==='live') post({type:'cue',kind:'approved',key:r.key}); drop(a); } }
    else if(a.st==='eject'){ var k2=a.t/a.dur; a.shake=k2<0.3?Math.sin(a.t*58)*3.2*U*(1-k2/0.3):0; if(k2>=1||coarse){ var rj=a.r, tq=trayPos(); if(a.mode!=='replay'&&rj.place!=='rejected'){ rj.place='rejected'; S.rej++; S.rejects.push(rj); rj.vis=rj.votes.length; } rj.trayed=true; S.rbump=1; S.pings.push({x:tq[0],y:tq[1],t:S.t,r0:S.mini*0.7,hex:RED,big:true}); if(a.mode==='live') post({type:'cue',kind:'rejected',key:rj.key}); drop(a); } }
    else if(a.st==='fade'){ a.al-=dt*2; a.x+=dt*40*U; if(a.al<=0||coarse) drop(a); } }
  var sm=1-Math.exp(-dt*7); for(i=0;i<S.shelf.length;i++){ var s=S.shelf[i], p=shelfPos(s); s.sx+=(p[0]-s.sx)*sm; s.sy+=(p[1]-s.sy)*sm; }
  // Between real events the scene looks back now and then: one past release
  // goes down the belt again, with its age written under the name.
  if(CFG.ambient&&!coarse&&!S.tl&&S.has&&!S.actors.length&&S.t>S.amb){ var pool=S.order.filter(function(r){ return r.place&&r.votes.length; }); if(pool.length){ var pk=Math.pow(Math.random(),1.6); enqueue(pool[pool.length-1-Math.floor(pk*pool.length)],'replay'); } S.amb=S.t+17+Math.random()*9; }
}

// ---------- drawing ----------
// The store is the vault's moon risen from below: the same body, the same
// mark, and along its edge the day's releases stand where they came down.
function store(now){ var cx=S.cx, cy=S.cys, R=S.Rs, i;
  var halo=ctx.createRadialGradient(cx,cy,R*0.985,cx,cy,R*1.09); halo.addColorStop(0,'rgba(86,224,255,'+(0.16+0.1*S.bump)+')'); halo.addColorStop(0.35,'rgba(60,200,220,0.05)'); halo.addColorStop(1,'rgba(60,200,220,0)'); ctx.fillStyle=halo; ctx.fillRect(0,S.limb-R*0.1,W,R*0.2);
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.clip();
  var body=ctx.createLinearGradient(0,S.limb,0,S.limb+R*0.36); body.addColorStop(0,'#12293A'); body.addColorStop(0.3,'#0A1A26'); body.addColorStop(1,'#050C13'); ctx.fillStyle=body; ctx.fillRect(0,S.limb-2,W,H-S.limb+4);
  if(GLYPH.complete&&GLYPH.naturalWidth>0){ if(!S.mono){ S.mono=document.createElement('canvas'); S.mono.width=256; S.mono.height=256; var gx=S.mono.getContext('2d'); gx.drawImage(GLYPH,0,0,256,256); gx.globalCompositeOperation='source-in'; gx.fillStyle='rgba(150,200,225,1)'; gx.fillRect(0,0,256,256); } var gs=150*U; ctx.globalAlpha=0.075; ctx.drawImage(S.mono,cx-gs/2,S.limb+8*U,gs,gs); ctx.globalAlpha=1; }
  // Lit windows, as on the vault after nine in the evening.
  for(i=0;i<46;i++){ var hx=Math.sin(i*91.7)*0.5+0.5, hy=Math.sin(i*53.3+1.7)*0.5+0.5, tw=0.5+0.5*Math.sin(S.t*(0.5+hx)+i*2.3); ctx.fillStyle=i%5===0?'rgba(201,169,106,'+(0.10+0.22*tw)+')':'rgba(124,240,188,'+(0.06+0.16*tw)+')'; ctx.fillRect(hx*W,S.limb+16*U+hy*(H-S.limb-10*U),1.4*U,1.4*U); }
  ctx.restore();
  ctx.lineWidth=1.3; ctx.strokeStyle='rgba(150,205,230,'+(0.42+0.4*S.bump)+')'; ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.stroke();
  var n=0; for(i=0;i<S.shelf.length;i++) if(S.shelf[i].landed) n++;
  ctx.textAlign='center'; ctx.textBaseline='middle'; var sc=1+0.22*S.bump; ctx.fillStyle=TEXT; ctx.font='700 '+Math.round(27*U*sc)+'px sans-serif'; ctx.fillText(String(n),cx,S.limb+43*U);
  ctx.fillStyle=MUTED; ctx.font='600 '+Math.round(9.5*U)+'px sans-serif'; ctx.fillText(CFG.labels.passed,cx,S.limb+63*U); }
function shelf(){ var L=shelfList(), i; for(i=0;i<S.shelf.length;i++){ var r=S.shelf[i]; if(!r.landed) continue; var vis=L.indexOf(r)>=0, al=(vis?1:0)*(r.acting?0.28:1); if(al<=0) continue;
    glow(r.ours?GOLD:GREEN,r.sx,r.sy+S.mini*0.5,S.mini*0.95,0.20*al); tile(r,r.sx,r.sy,S.mini,al,r.vis,0,S.sel===r);
    if(r.liveAt){ ctx.beginPath(); ctx.arc(r.sx+S.mini*0.52,r.sy-S.mini*0.52,2.1*U,0,TAU); ctx.fillStyle=TEXT; ctx.globalAlpha=al; ctx.fill(); ctx.globalAlpha=1; } } }
// The belt: a rail of light the apps ride in on, left to right, with the plate
// in the middle where the guardians look. Its two halves under the plate are a
// trapdoor: it opens for an app that passed and stays shut for one that did not.
function belt(){ var y=S.yRail, half=S.St*0.5+10*U, x0=S.cx-half, x1=S.cx+half, open=Math.sin(Math.min(1,S.door)*Math.PI*0.5)*1.05, i, busy=S.plate||S.q.length;
  var g=ctx.createLinearGradient(0,0,W,0); g.addColorStop(0,'rgba(120,180,205,0)'); g.addColorStop(0.16,'rgba(120,180,205,0.34)'); g.addColorStop(0.84,'rgba(120,180,205,0.34)'); g.addColorStop(1,'rgba(120,180,205,0)');
  var bed=ctx.createLinearGradient(0,y,0,y+20*U); bed.addColorStop(0,'rgba(86,224,255,0.07)'); bed.addColorStop(1,'rgba(86,224,255,0)'); ctx.fillStyle=bed; ctx.fillRect(W*0.06,y,W*0.88,20*U);
  ctx.lineCap='round'; ctx.strokeStyle=g; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(x0,y); ctx.moveTo(x1,y); ctx.lineTo(W,y); ctx.stroke();
  ctx.strokeStyle='rgba(120,180,205,0.10)'; ctx.beginPath(); ctx.moveTo(0,y+5*U); ctx.lineTo(x0,y+5*U); ctx.moveTo(x1,y+5*U); ctx.lineTo(W,y+5*U); ctx.stroke();
  ctx.save(); ctx.strokeStyle=g; ctx.lineWidth=2.2*U; ctx.setLineDash([5*U,21*U]); ctx.lineDashOffset=-(S.t*(busy?46:13)*U)%(26*U); ctx.globalAlpha=0.8; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(x0,y); ctx.moveTo(x1,y); ctx.lineTo(W,y); ctx.stroke(); ctx.restore();
  var tone=S.lock>0?RED:(S.plate?ACCENT:'#78B4CD'), al=S.lock>0?0.5+0.5*S.lock:(S.plate?0.75+0.2*Math.sin(S.t*3.2):0.42);
  ctx.strokeStyle=rgba(tone,al); ctx.lineWidth=2*U;
  for(i=-1;i<=1;i+=2){ var hx=S.cx+i*half; ctx.beginPath(); ctx.moveTo(hx,y); ctx.lineTo(hx-i*Math.cos(open)*half,y+Math.sin(open)*half); ctx.stroke(); ctx.beginPath(); ctx.arc(hx,y,2.2*U,0,TAU); ctx.fillStyle=rgba(tone,al); ctx.fill(); }
  glow(S.lock>0?RED:ACCENT,S.cx,y,half*1.5,(S.plate?0.13:0.06)+0.2*S.lock);
  // The far end of the belt: the last app that was turned away rests there,
  // dimmed, with the day's count over it. It did not go down into the store.
  var out=trayRel(), tp=trayPos(), cnt=0; for(i=0;i<S.rejects.length;i++) if(S.rejects[i].trayed) cnt++;
  if(out){ tile(out,tp[0],tp[1],S.mini,out.acting?0.3:1,out.votes.length,0,S.sel===out); rr(tp[0]-S.mini/2,tp[1]-S.mini/2,S.mini,S.mini,S.mini*0.235); ctx.fillStyle='rgba(4,7,11,0.28)'; ctx.fill(); }
  if(cnt>0){ var rx=tp[0]+S.mini/2-4*U, ry=tp[1]-S.mini/2-11*U, k=1+0.35*S.rbump; ctx.strokeStyle=rgba(RED,0.9); ctx.lineWidth=1.5*U*k; ctx.beginPath(); ctx.moveTo(rx-3.4*U*k,ry-3.4*U*k); ctx.lineTo(rx+3.4*U*k,ry+3.4*U*k); ctx.moveTo(rx+3.4*U*k,ry-3.4*U*k); ctx.lineTo(rx-3.4*U*k,ry+3.4*U*k); ctx.stroke(); ctx.fillStyle=rgba(RED,0.95); ctx.font='700 '+Math.round(10.5*U*k)+'px monospace'; ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText(String(cnt),rx-8*U,ry+0.5); } }
// An app: its own icon from the store, or its initials while it has none yet,
// in a frame that takes the colour of the votes as they land. One yes of three
// is a light green; two is deeper; all three is the full colour. A no takes its
// share of the frame in red, so a split vote reads as a split tile.
function tile(r,x,y,sz,al,rev,flash,sel){ if(al<=0.01) return; var half=sz/2, rad=sz*0.235, N=Math.max(1,S.N||S.G.length), yes=0, no=0, i; for(i=0;i<rev&&i<r.votes.length;i++){ if(r.votes[i].yes===false) no++; else yes++; }
  var cast=yes+no, lvl=clamp(cast/N,0,1), gs=cast?yes/cast:0, gw=sz*gs, green=mix('#B4F7DA','#2EE596',lvl,1), big=sz>30*U;
  ctx.save(); ctx.globalAlpha=al;
  if(big){ if(yes) glow(GREEN,x-(no?sz*0.22:0),y,sz*(0.95+0.5*lvl),0.10+0.24*lvl+0.25*flash); if(no) glow(RED,x+(yes?sz*0.22:0),y,sz*(0.95+0.5*lvl),0.10+0.24*lvl+0.25*flash); if(!cast&&r.ours) glow(GOLD,x,y,sz*1.1,0.2); }
  rr(x-half,y-half,sz,sz,rad); ctx.fillStyle='#0B141C'; ctx.fill();
  ctx.save(); rr(x-half,y-half,sz,sz,rad); ctx.clip();
  if(r.pic&&r.pic.ok){ ctx.drawImage(r.pic.im,x-half,y-half,sz,sz); }
  else { var mg=ctx.createLinearGradient(x-half,y-half,x+half,y+half); var pl=PAL[hash(r.key)%PAL.length]; mg.addColorStop(0,r.ours?'#3A2F17':pl[0]); mg.addColorStop(1,r.ours?'#16110A':pl[1]); ctx.fillStyle=mg; ctx.fillRect(x-half,y-half,sz,sz); ctx.fillStyle=r.ours?GOLD:pl[2]; ctx.font='700 '+Math.round(sz*0.4)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(r.mono||(r.mono=initials(r.name,r.pkg)),x,y+sz*0.03); }
  var gl=ctx.createLinearGradient(0,y-half,0,y); gl.addColorStop(0,'rgba(255,255,255,0.13)'); gl.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=gl; ctx.fillRect(x-half,y-half,sz,half);
  if(cast){ var wa=0.05+0.13*lvl+0.32*flash; if(yes){ ctx.fillStyle=mix('#B4F7DA','#2EE596',lvl,wa); ctx.fillRect(x-half,y-half,gw,sz); } if(no){ ctx.fillStyle=rgba(RED,wa*1.1); ctx.fillRect(x-half+gw,y-half,sz-gw,sz); } }
  ctx.restore();
  var fo=Math.max(2*U,sz*0.085), fx=x-half-fo, fy=y-half-fo, fs=sz+fo*2; ctx.lineWidth=Math.max(1.4*U,sz*0.05);
  rr(fx,fy,fs,fs,rad+fo); ctx.strokeStyle=sel?TEXT:(r.ours?rgba(GOLD,0.8):'rgba(120,180,205,0.26)'); ctx.stroke();
  if(cast&&!sel){ var fa=0.5+0.5*lvl; if(yes){ ctx.save(); ctx.beginPath(); ctx.rect(fx-4,fy-4,no?fo+gw+4:fs+8,fs+8); ctx.clip(); rr(fx,fy,fs,fs,rad+fo); ctx.strokeStyle=mix('#B4F7DA','#2EE596',lvl,fa); ctx.stroke(); ctx.restore(); }
    if(no){ ctx.save(); ctx.beginPath(); ctx.rect(yes?fx+fo+gw:fx-4,fy-4,fs+8,fs+8); ctx.clip(); rr(fx,fy,fs,fs,rad+fo); ctx.strokeStyle=rgba(RED,fa); ctx.stroke(); ctx.restore(); } }
  ctx.restore(); }
function actorTile(a,now){ var r=a.r, sz=S.St*a.s, x=a.x+a.shake, y=yFor(a.s), al=a.al, big=a.st==='plate', i;
  if(a.st==='drop'){ var k=clamp(a.t/a.dur,0,1), p=r.acting===a||r.place==='shelf'?[r.sx,r.sy]:[S.cx,S.limb], e=eio(k); x=a.fx+(p[0]-a.fx)*e; y=a.fy+(p[1]-a.fy)*k*k; sz=S.St*(a.fs+(S.mini/S.St-a.fs)*e);
    var tr=ctx.createLinearGradient(0,a.fy,0,y); tr.addColorStop(0,rgba(r.ours?GOLD:GREEN,0)); tr.addColorStop(1,rgba(r.ours?GOLD:GREEN,0.5*(1-k*0.5))); ctx.strokeStyle=tr; ctx.lineWidth=sz*0.5; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(a.fx+(x-a.fx)*0.5,a.fy+(y-a.fy)*0.25); ctx.lineTo(x,y); ctx.stroke();
    glow(r.ours?GOLD:GREEN,x,y,sz*1.6,0.35); tile(r,x,y,sz,1,a.rev,0,false); return; }
  if(a.st==='eject'){ var ke=clamp((a.t/a.dur-0.3)/0.7,0,1), e2=eio(ke), tq=trayPos(); x=a.ex+(tq[0]-a.ex)*e2+a.shake; sz=S.St*(a.es+(S.mini/S.St-a.es)*e2); y=S.yRail-9*U-sz/2; glow(RED,x,y,sz*1.3,0.25*(1-e2)); tile(r,x,y,sz,1,a.rev,a.flash,false); if(e2>0){ rr(x-sz/2,y-sz/2,sz,sz,sz*0.235); ctx.fillStyle='rgba(4,7,11,'+(0.28*e2)+')'; ctx.fill(); } return; }
  tile(r,x,y,sz,al,a.rev,a.flash,S.sel===r);
  if(al<0.25||a.st==='fade'||(a.st==='q'&&S.q.indexOf(a)>0)||(a.st==='park'&&S.parked.indexOf(a)>0)) return;
  // The name, where it can be read: white on the night, under the rail.
  var f=big?'600 '+Math.round(12.5*U)+'px sans-serif':'600 '+Math.round(10*U)+'px sans-serif', max=big?W*0.46:W*0.27, ny=S.yRail+(big?18:15)*U, nx=clamp(x,max/2+4*U,W-max/2-4*U), lines=big?wrap(r,r.name,f,max):[fit(r,r.name,f,max)];
  ctx.font=f; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.save(); ctx.globalAlpha=al; ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=5*U; ctx.fillStyle=r.ours?GOLD:TEXT; ctx.fillText(lines[0],nx,ny); if(lines[1]){ ny+=14*U; ctx.fillText(lines[1],nx,ny); } ctx.restore();
  if(!big&&a.st!=='park') return;
  // Under it, the seconds each vote took, in the colour of the vote.
  var parts=[], tw=0, sep=' · '; ctx.font='600 '+Math.round((big?10:8.5)*U)+'px monospace';
  for(i=0;i<a.rev&&i<r.votes.length;i++){ parts.push({t:secs(r.votes[i].seconds),c:r.votes[i].yes===false?RED:GREEN}); }
  if(a.mode==='replay'&&big) parts.push({t:CFG.labels.ago.replace('{age}',age(now-r.at)),c:FAINT});
  for(i=0;i<parts.length;i++){ parts[i].w=ctx.measureText(parts[i].t).width; tw+=parts[i].w+(i?ctx.measureText(sep).width:0); }
  var px=nx-tw/2, sw=ctx.measureText(sep).width; ctx.textAlign='left'; ctx.globalAlpha=al;
  for(i=0;i<parts.length;i++){ if(i){ ctx.fillStyle=FAINT; ctx.fillText(sep,px,ny+13*U); px+=sw; } ctx.fillStyle=parts[i].c; ctx.fillText(parts[i].t,px,ny+13*U); px+=parts[i].w; } ctx.globalAlpha=1; }

// A guardian is a medallion: a thick coin in its own colours with its own
// mark struck into the face. The face is painted once, lit from the upper
// left; turning it is a matter of how wide the face is drawn and how much of
// the milled edge shows beside it.
function face(g){ var c=document.createElement('canvas'), R=100, o=110, x=c.getContext('2d'), b=BRAND[g.id]||{face:'#0E1721',accent:'#8FB8CC'}, mark=CFG.logos&&g.id?MARK[g.id]:null; c.width=c.height=220; g.accent=b.accent; g.faceHex=b.face;
  var cg=x.createConicGradient(-Math.PI*0.75,o,o), lt=mix(b.accent,'#FFFFFF',0.6), dk=mix(b.accent,'#000000',0.62), md=mix(b.accent,'#000000',0.15);
  cg.addColorStop(0,lt); cg.addColorStop(0.13,md); cg.addColorStop(0.27,dk); cg.addColorStop(0.5,mix(b.accent,'#000000',0.74)); cg.addColorStop(0.63,md); cg.addColorStop(0.76,lt); cg.addColorStop(0.88,md); cg.addColorStop(1,lt);
  x.fillStyle=cg; x.beginPath(); x.arc(o,o,R,0,TAU); x.fill();
  x.lineWidth=2.2; x.strokeStyle='rgba(0,0,0,0.6)'; x.beginPath(); x.arc(o,o,R*0.855,0,TAU); x.stroke(); x.lineWidth=1.2; x.strokeStyle='rgba(255,255,255,0.22)'; x.beginPath(); x.arc(o,o,R*0.985,0,TAU); x.stroke();
  var fg=x.createRadialGradient(o-R*0.34,o-R*0.4,R*0.05,o,o,R*0.9); fg.addColorStop(0,mix(b.face,'#FFFFFF',0.2)); fg.addColorStop(0.45,mix(b.face,'#FFFFFF',0.05)); fg.addColorStop(1,mix(b.face,'#000000',0.5)); x.fillStyle=fg; x.beginPath(); x.arc(o,o,R*0.84,0,TAU); x.fill();
  var ig=x.createLinearGradient(o-R*0.6,o-R*0.6,o+R*0.6,o+R*0.6); ig.addColorStop(0,'rgba(0,0,0,0.7)'); ig.addColorStop(0.5,'rgba(0,0,0,0)'); ig.addColorStop(1,'rgba(255,255,255,0.2)'); x.lineWidth=7; x.strokeStyle=ig; x.beginPath(); x.arc(o,o,R*0.8,0,TAU); x.stroke();
  x.save(); x.beginPath(); x.arc(o,o,R*0.8,0,TAU); x.clip();
  var m=R*1.1;
  if(mark&&mark.complete&&mark.naturalWidth>0){ var t=document.createElement('canvas'); t.width=t.height=256; var tx=t.getContext('2d');
    tx.drawImage(mark,0,0,256,256); tx.globalCompositeOperation='source-in'; tx.fillStyle='#000'; tx.fillRect(0,0,256,256); x.globalAlpha=0.7; x.drawImage(t,o-m/2+3.2,o-m/2+4.2,m,m);
    tx.globalCompositeOperation='source-over'; tx.clearRect(0,0,256,256); tx.drawImage(mark,0,0,256,256); tx.globalCompositeOperation='source-in'; tx.fillStyle='#FFF'; tx.fillRect(0,0,256,256); x.globalAlpha=0.28; x.drawImage(t,o-m/2-1.4,o-m/2-1.8,m,m);
    x.globalAlpha=1; x.drawImage(mark,o-m/2,o-m/2,m,m); }
  else { var tx2=initials(g.name,g.key); x.font='700 '+(tx2.length>1?64:78)+'px sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillStyle='rgba(0,0,0,0.7)'; x.fillText(tx2,o+3,o+7); x.fillStyle='rgba(255,255,255,0.3)'; x.fillText(tx2,o-1.4,o+2.4); x.fillStyle=mix(b.accent,'#FFFFFF',0.25); x.fillText(tx2,o,o+4); }
  var dome=x.createLinearGradient(0,o-R*0.8,0,o+R*0.05); dome.addColorStop(0,'rgba(255,255,255,0.24)'); dome.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=dome; x.beginPath(); x.ellipse(o,o-R*0.4,R*0.74,R*0.46,0,0,TAU); x.fill(); x.restore();
  g.tex=c; g.texLogos=CFG.logos; g.texOk=!CFG.logos||!g.id||!MARK[g.id]||(MARK[g.id].complete&&MARK[g.id].naturalWidth>0); }
function medallion(g,i){ if(!g.tex||g.texLogos!==CFG.logos||!g.texOk) face(g);
  var R=S.Rm, k=g.spinT<g.spinD?g.spinT/g.spinD:1, spin=k<1?TAU*eo(k):0, hop=k<1?Math.sin(Math.PI*k):0, yaw=0.3*Math.sin(S.t*0.55+i*1.9)+g.tilt+spin, c=Math.cos(yaw), s=Math.sin(yaw), th=R*0.26;
  var x=g.x, y=g.y+2.4*U*Math.sin(S.t*0.9+i*1.3)-12*U*hop, sc=1+0.07*hop, rx=Math.max(0.03,Math.abs(c))*R*sc, ry=R*sc, sg=c>=0?1:-1, xv=x+sg*s*th/2, xh=x-sg*s*th/2, acc=g.accent||'#8FB8CC';
  glow(acc,x,y,R*2.1,0.07+0.3*g.hot); ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x,g.y+R+11*U,R*0.72*(1-0.25*hop),3.2*U,0,0,TAU); ctx.fill();
  // the edge: the hull of the two faces, lit from above, with its milling
  var eg=ctx.createLinearGradient(0,y-ry,0,y+ry); eg.addColorStop(0,mix(acc,'#FFFFFF',0.45)); eg.addColorStop(0.35,mix(acc,'#000000',0.2)); eg.addColorStop(1,mix(acc,'#000000',0.78)); ctx.fillStyle=eg;
  ctx.beginPath(); ctx.ellipse(xh,y,rx,ry,0,0,TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(xv,y,rx,ry,0,0,TAU); ctx.fill(); ctx.fillRect(Math.min(xh,xv),y-ry,Math.abs(xv-xh),ry*2);
  var band=Math.abs(xv-xh); if(band>1.2){ ctx.save(); ctx.beginPath(); ctx.ellipse(xh,y,rx,ry,0,0,TAU); ctx.rect(Math.min(xh,xv),y-ry,band,ry*2); ctx.clip(); ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=0.8; var a0=Math.min(xh,xv)-rx, a1=Math.max(xh,xv)+rx; for(var m=a0;m<a1;m+=2.3*U){ ctx.beginPath(); ctx.moveTo(m,y-ry); ctx.lineTo(m,y+ry); ctx.stroke(); } ctx.restore(); }
  // the face, as wide as the turn leaves it
  ctx.drawImage(g.tex,xv-rx*1.1,y-ry*1.1,rx*2.2,ry*2.2);
  ctx.save(); ctx.beginPath(); ctx.ellipse(xv,y,rx,ry,0,0,TAU); ctx.clip();
  var dark=(1-Math.abs(c))*0.55+(g.hot>0.05||k<1?0:0.1); if(dark>0.01){ ctx.fillStyle='rgba(0,0,0,'+dark+')'; ctx.fillRect(xv-rx,y-ry,rx*2,ry*2); }
  // the glint: a soft bar of light that slides across the face as it turns
  var off=-s*1.7, gx0=xv+rx*(off-0.55), gx1=xv+rx*(off+0.55), sp=ctx.createLinearGradient(gx0,y-ry,gx1,y+ry*0.5); sp.addColorStop(0,'rgba(255,255,255,0)'); sp.addColorStop(0.5,'rgba(255,255,255,'+(0.2+0.36*g.hot)*Math.abs(c)+')'); sp.addColorStop(1,'rgba(255,255,255,0)'); ctx.globalCompositeOperation='lighter'; ctx.fillStyle=sp; ctx.fillRect(xv-rx,y-ry,rx*2,ry*2); ctx.restore();
  ctx.lineWidth=1.1; ctx.strokeStyle='rgba(255,255,255,'+(0.28*Math.abs(c))+')'; ctx.beginPath(); ctx.ellipse(xv,y,rx*0.985,ry*0.985,0,Math.PI*1.05,Math.PI*1.6); ctx.stroke();
  g.px=x; g.py=y;
  var small=S.G.length>=5; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillStyle=g.hot>0.1?TEXT:'#C5D2DD'; ctx.font='600 '+Math.round((small?9:10.5)*U)+'px sans-serif'; ctx.fillText(g.name||String(g.key).slice(0,4)+'…'+String(g.key).slice(-4),g.x,g.y+R+26*U);
  if(g.lab){ var lk=(S.t-g.lab.t)/g.lab.d; if(lk>=1) g.lab=null; else { ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='700 '+Math.round(13*U)+'px monospace'; ctx.save(); ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=4*U; ctx.fillStyle=rgba(g.lab.yes===false?RED:GREEN,lk<0.7?1:1-(lk-0.7)/0.3); ctx.fillText(g.lab.txt,g.x,g.y+R+42*U-lk*5*U); ctx.restore(); } } }
// The look itself: a cone of light from the medallion down onto the tile, in
// the colour of the vote, bright as it lands and gone a moment after.
function beams(){ for(var i=0;i<S.checks.length;i++){ var c=S.checks[i], g=S.G[c.gi]; if(!g) continue; var p=target(c), hex=c.v.yes===false?RED:GREEN, k=c.t<c.hit?c.t/c.hit:1, al=c.t<c.hit?0.35+0.65*k:Math.pow(clamp(1-(c.t-c.hit)/(c.dur-c.hit),0,1),1.6), gx=g.px==null?g.x:g.px, gy=(g.py==null?g.y:g.py)+S.Rm*0.5, tx=p[0], ty=p[1]-p[2]*0.2, hw=p[2]*0.5, ex=gx+(tx-gx)*k, ey=gy+(ty-gy)*k, ew=4*U+(hw-4*U)*k;
    var lg=ctx.createLinearGradient(gx,gy,tx,ty); lg.addColorStop(0,rgba(hex,0.02)); lg.addColorStop(1,rgba(hex,0.5*al)); ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.fillStyle=lg; ctx.beginPath(); ctx.moveTo(gx-4*U,gy); ctx.lineTo(gx+4*U,gy); ctx.lineTo(ex+ew,ey); ctx.lineTo(ex-ew,ey); ctx.closePath(); ctx.fill();
    ctx.strokeStyle=rgba(hex,0.75*al); ctx.lineWidth=1.3*U; ctx.beginPath(); ctx.moveTo(gx,gy); ctx.lineTo(ex,ey); ctx.stroke(); glow(hex,ex,ey,(c.t<c.hit?12:20)*U,0.75*al); ctx.restore(); } }
function pings(){ for(var i=0;i<S.pings.length;i++){ var p=S.pings[i], k=(S.t-p.t)/(p.big?1.0:0.6); if(k>=1) continue; ctx.strokeStyle=rgba(p.hex,0.85*(1-k)); ctx.lineWidth=(p.big?2:1.6)*U; ctx.beginPath(); ctx.arc(p.x,p.y,p.r0+eo(k)*(p.big?17:20)*U,0,TAU); ctx.stroke(); } }
function hud(now){ if(!CFG.hud) return; var y=S.insTop+13*U, x=13*U, L=CFG.labels, word=S.tl?L.lapse:L.live, tone=S.tl?GOLD:GREEN;
  ctx.textBaseline='middle'; ctx.textAlign='left'; ctx.beginPath(); ctx.arc(x+3*U,y,3*U*(S.tl?1:0.8+0.2*Math.sin(S.t*3)),0,TAU); ctx.fillStyle=tone; ctx.fill();
  ctx.fillStyle=tone; ctx.font='700 '+Math.round(10*U)+'px sans-serif'; ctx.fillText(word,x+11*U,y+0.5); var wd=ctx.measureText(word).width;
  ctx.fillStyle=MUTED; ctx.font='600 '+Math.round(9.5*U)+'px monospace';
  if(S.tl){ var d=new Date(S.tl.vt*1000); ctx.fillText(two(d.getDate())+'.'+two(d.getMonth()+1)+' · '+two(d.getHours())+':'+two(d.getMinutes()),x+19*U+wd,y+0.5); var k=clamp((S.t-S.tl.t0)/S.tl.dur,0,1); ctx.fillStyle='rgba(120,180,205,0.16)'; ctx.fillRect(13*U,y+11*U,W-26*U,1.5); ctx.fillStyle=GOLD; ctx.fillRect(13*U,y+11*U,(W-26*U)*k,1.5); }
  else if(S.lastVoteAt){ ctx.fillText(L.lastVote.replace('{age}',age(now-S.lastVoteAt)),x+19*U+wd,y+0.5); } }
function draw(){ if(W<2) return; var now=S.tl?S.tl.vt:nowS(), i, a; ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,W,H); if(S.bg) ctx.drawImage(S.bg,0,0,W,H);
  for(i=0;i<9;i++){ var sx=(Math.sin(i*37.1)*0.5+0.5)*W, sy=(Math.sin(i*71.3+2)*0.5+0.5)*S.yRail*0.9, tw=0.5+0.5*Math.sin(S.t*(0.6+i*0.13)+i*1.7); ctx.fillStyle='rgba(216,244,255,'+(0.08+0.38*tw)+')'; ctx.beginPath(); ctx.arc(sx,sy,(0.7+0.5*tw)*U,0,TAU); ctx.fill(); }
  store(now); shelf(); belt();
  for(i=0;i<S.actors.length;i++){ a=S.actors[i]; if(a.st!=='drop') actorTile(a,now); }
  beams();
  for(i=0;i<S.G.length;i++) medallion(S.G[i],i);
  for(i=0;i<S.actors.length;i++){ a=S.actors[i]; if(a.st==='drop') actorTile(a,now); }
  pings(); hud(now);
  if(!S.has||(!S.order.length&&!S.tl)){ ctx.fillStyle=FAINT; ctx.font='600 '+Math.round(10.5*U)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(CFG.labels.waiting,S.cx,S.yRail+22*U); }
  if(S.sel&&S.t-S.selT>5) S.sel=null; }

// ---------- in and out ----------
window.__push=function(m){ try{ if(!m) return; var t=m.type;
  if(!t||t==='state'){ var st=m.state||m; if(st.guardians||st.releases) ingest(st); }
  else if(t==='motion'){ S.motion=m.mode==='calm'||m.mode==='off'?m.mode:'live'; S.idle=0; }
  else if(t==='pause'){ S.paused=!!m.on; }
  else if(t==='inset'){ S.insTop=+m.top||0; S.insBot=+m.bottom||0; layout(); }
  else if(t==='timelapse'){ if(m.on===false){ if(S.tl) lapseEnd(); } else if(S.has&&!S.tl) lapse(m.seconds); }
  else if(t==='config'){ ['logos','hud','ambient','iconBase'].forEach(function(k){ if(m[k]!==undefined&&m[k]!==null) CFG[k]=m[k]; }); if(m.labels) for(var k in m.labels) if(typeof m.labels[k]==='string') CFG.labels[k]=m.labels[k]; layout(); }
  draw(); }catch(e){ post({type:'error',message:String(e&&e.stack||e).slice(0,400)}); } };
function hit(x,y){ var i, a, d;
  for(i=0;i<S.G.length;i++){ var g=S.G[i]; if(Math.hypot(x-g.x,y-g.y)<S.Rm+9*U) return {g:g}; }
  for(i=S.actors.length-1;i>=0;i--){ a=S.actors[i]; if(a.st==='drop'||a.al<0.3) continue; var sz=S.St*a.s; if(Math.abs(x-a.x)<sz/2+8*U&&y>yFor(a.s)-sz/2-8*U&&y<S.yRail+30*U) return {r:a.r}; }
  var out=trayRel(), tp=trayPos(); if(out&&Math.hypot(x-tp[0],y-tp[1])<S.mini*0.5+9*U) return {r:out};
  var best=null, bd=S.mini*0.5+9*U, L=shelfList(); for(i=0;i<L.length;i++){ if(!L[i].landed) continue; d=Math.hypot(x-L[i].sx,y-L[i].sy); if(d<bd){ bd=d; best={r:L[i]}; } }
  if(best) return best; if(Math.hypot(x-S.cx,y-S.cys)<S.Rs) return {store:true}; return null; }
cv.addEventListener('click',function(e){ S.idle=0; var h=hit(e.clientX,e.clientY); if(!h){ S.sel=null; post({type:'tap',kind:'none'}); return; }
  if(h.store){ S.sel=null; post({type:'tap',kind:'store'}); return; }
  if(h.g){ h.g.spinT=0; h.g.spinD=0.8; post({type:'tap',kind:'guardian',key:h.g.key,id:h.g.id,name:h.g.name}); return; }
  var r=h.r; S.sel=r; S.selT=S.t; post({type:'tap',kind:'release',key:r.key,app:r.app,pkg:r.pkg,versionCode:r.vc,name:r.name,sig:r.sig,verdict:r.verdict}); });
document.addEventListener('touchstart',function(){ S.idle=0; },{passive:true});
// In a browser the preview page stands where React Native would.
if(!window.ReactNativeWebView){ window.__S=S; window.addEventListener('message',function(e){ if(e.data&&e.data.__push) window.__push(e.data.__push); }); }
Object.keys(MARK_SRC).forEach(function(id){ if(MARK_SRC[id].indexOf('data:')===0){ var im=new Image(); im.onload=function(){ S.G.forEach(function(g){ if(g.id===id) g.tex=null; }); }; im.src=MARK_SRC[id]; MARK[id]=im; } });

// For a test and for the preview page: run the scene forward by hand.
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
