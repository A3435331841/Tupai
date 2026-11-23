/**
 * 图派画册 · 多模板渲染（docs/20）
 *
 * 设计边界：
 * - 概念参考 HaichaoLihc/create-photo-flipbook-ui (MIT) 的 ui-collections，
 *   但这里是零依赖的纯 HTML/CSS/JS 自实现，不搬运其运行时、模板代码或媒体。
 * - 图片一律用相对路径 `img/{id}?watermark=1`（分享页挂在深层路径，写死 /api/v1 会被平台拦截）。
 * - 下载在画布上合成「AI 生成 · 图派」角标，保证本地文件也带标识。
 * - 四套模板：3D 精装书 / 杂志跨页 / 卡片画廊 / 胶片档案，可通过 ?style= 或页面切换器选择。
 */

export const ALBUM_STYLES = [
  { id: 'hardcover', label: '3D 精装', hint: '暗场曲页 · 沉浸翻书' },
  { id: 'editorial', label: '杂志跨页', hint: '暖米双页 · 安静阅读' },
  { id: 'cards', label: '卡片画廊', hint: '环形编号 · 轻快浏览' },
  { id: 'film', label: '胶片档案', hint: '底片齿孔 · 逐帧检视' },
  { id: 'atlas', label: '影像图谱', hint: '同心圆 · 主题检索聚焦' },
  { id: 'stream', label: '光影瀑布', hint: '错落列 · 视差流动' },
  { id: 'webgl', label: '真曲页', hint: 'WebGL · 真实曲面翻页' },
];

export function albumStyleIds() {
  return ALBUM_STYLES.map((s) => s.id);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 统一的样式骨架 + 各模板专属 CSS */
function cssFor(style) {
  const base = `
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#2a2622;min-height:100vh;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
header{padding:16px 20px 10px;text-align:center;position:relative;z-index:5}
h1{font-family:"Songti SC","STSong",serif;font-size:clamp(1.1rem,3vw,1.5rem);margin:0;letter-spacing:.02em}
header small{color:#8a8178;font-size:.75rem}
.stage{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;min-height:0}
.item{position:relative;overflow:hidden;background:#fff}
.item img{width:100%;height:100%;object-fit:cover;display:block}
.ai-badge{position:absolute;left:8px;top:8px;z-index:3;border-radius:999px;background:rgba(0,0,0,.5);color:#fff;font-size:10px;line-height:1;padding:5px 8px;letter-spacing:.02em}
.dl{position:absolute;right:8px;bottom:8px;z-index:3;border:0;cursor:pointer;border-radius:999px;background:rgba(255,255,255,.92);color:#2a2622;font-size:10px;padding:6px 9px}
.caption{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:18px 10px 7px;text-align:center;font-size:.72rem;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.5))}
nav{display:flex;gap:10px;align-items:center;justify-content:center;padding:12px 16px 6px;flex-wrap:wrap}
nav button{font:inherit;font-size:.85rem;padding:8px 18px;border-radius:999px;border:1px solid #d8d0c4;background:#fff;color:#2a2622;cursor:pointer;transition:.2s}
nav button:hover:not(:disabled){border-color:#c0562f;color:#c0562f}
nav button:disabled{opacity:.35;cursor:default}
.counter{font-size:.8rem;color:#8a8178;min-width:64px;text-align:center}
.switcher{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:2px 16px 10px}
.switcher button{font:inherit;font-size:.72rem;padding:5px 11px;border-radius:999px;border:1px solid #e4d9ca;background:transparent;color:#8a8178;cursor:pointer;transition:.2s}
.switcher button.on{border-color:#c0562f;background:#c0562f;color:#fff}
footer{text-align:center;padding:10px 14px 16px;font-size:.7rem;color:#a89f93}
.empty{color:#8a8178;text-align:center;padding:40px}
@media(max-width:640px){header{padding-top:12px}.switcher button{padding:4px 9px}}
`;
  const per = {
    hardcover: `
body{background:radial-gradient(ellipse at 50% 40%,#2d2a27 0%,#171514 70%);color:#f4efe8}
header h1,header small{color:#f4efe8}header small{opacity:.7}
nav button{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25);color:#f4efe8}
.stage{perspective:1800px}
.book{position:relative;width:min(78vw,440px);aspect-ratio:3/4;transform-style:preserve-3d}
.book .item{position:absolute;inset:0;border-radius:4px 10px 10px 4px;box-shadow:-2px 8px 26px rgba(0,0,0,.5);transform-origin:left center;transition:transform .7s cubic-bezier(.4,.05,.2,1);backface-visibility:hidden}
.book .item::after{content:"";position:absolute;inset:0 auto 0 0;width:14px;background:linear-gradient(90deg,rgba(0,0,0,.28),transparent);pointer-events:none}
.book .item.turned{transform:rotateY(-165deg)}
.switcher button{border-color:rgba(255,255,255,.25);color:#cfc7bd}
.switcher button.on{background:#c0562f;border-color:#c0562f;color:#fff}
footer{color:#9d948a}
`,
    editorial: `
body{background:#efe9df}
.stage{padding:20px}
.spread{display:flex;gap:0;width:min(92vw,900px);aspect-ratio:3/2;background:#fbf7f0;padding:12px;box-shadow:0 16px 44px -22px rgba(60,42,26,.5);border-radius:3px}
.spread .leaf{flex:1;position:relative;overflow:hidden;background:#fff}
.spread .leaf.left{border-right:1px solid #e6ddd0}
.spread .leaf img{width:100%;height:100%;object-fit:cover}
.spread .folio{position:absolute;bottom:8px;font-family:"Songti SC",serif;font-size:.72rem;color:#8a8178}
.spread .leaf.left .folio{left:10px}.spread .leaf.right .folio{right:10px}
.spread-title{position:absolute;top:14px;left:12px;font-family:"Songti SC",serif;font-size:.9rem;color:#4a4036;z-index:2}
`,
    cards: `
body{background:#e9e4dc}
header h1{color:#3a332b}
.stage{perspective:1200px;overflow-x:hidden;overflow-y:visible;min-height:420px}
.ring{position:relative;width:min(94vw,680px);height:min(58vh,420px);transform-style:preserve-3d}
.ring .item{position:absolute;width:120px;height:160px;left:50%;top:50%;margin:-80px 0 0 -60px;border-radius:12px;border:4px solid #fffdf8;box-shadow:0 14px 30px -12px rgba(50,32,18,.55);transition:transform .55s cubic-bezier(.3,.7,.3,1),opacity .4s,filter .4s;cursor:pointer;backface-visibility:hidden}
.ring .item img{border-radius:8px}
.ring .item .num{position:absolute;top:8px;left:10px;z-index:3;font-family:"Songti SC",serif;font-size:.85rem;color:#fff;text-shadow:0 1px 4px #000}
.ring .item.active{box-shadow:0 20px 44px -14px rgba(192,86,47,.75);filter:none}
.ring .item.far{opacity:.6;filter:saturate(.7) brightness(.92)}
@media(max-width:640px){.ring .item{width:96px;height:128px;margin:-64px 0 0 -48px}}
`,
    atlas: `
body{background:radial-gradient(circle at 50% 50%,#1a2430 0%,#0d1219 72%);color:#e8eef4}
header h1{color:#e8eef4}header small{color:#8fa3b5}
.stage{position:relative;overflow:hidden;padding:0;min-height:calc(100vh - 220px);flex-direction:column;display:flex}
.atlas-tools{display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;padding:10px 14px;position:relative;z-index:6;flex:0 0 auto}
.atlas-tools input{font:inherit;font-size:.8rem;padding:7px 12px;border-radius:999px;border:1px solid rgba(232,238,244,.25);background:rgba(255,255,255,.07);color:#e8eef4;outline:none;width:min(60vw,260px)}
.atlas-tools input::placeholder{color:#8fa3b5}
.atlas-tools .chip{font-size:.72rem;padding:5px 10px;border-radius:999px;border:1px solid rgba(232,238,244,.2);background:transparent;color:#aebdca;cursor:pointer}
.atlas-tools .chip.on{border-color:#d3a15a;background:rgba(211,161,90,.18);color:#f3dcb4}
.atlas-canvas{position:relative;flex:1 1 auto;width:100%;align-self:stretch;min-height:320px;overflow:hidden}
.atlas-canvas .orb{position:absolute;width:74px;height:92px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid rgba(255,255,255,.16);box-shadow:0 8px 22px -10px rgba(0,0,0,.7);transition:opacity .35s,filter .35s,box-shadow .3s}
.atlas-canvas .orb img{width:100%;height:100%;object-fit:cover}
.atlas-canvas .orb .num{position:absolute;left:5px;top:4px;font-size:.6rem;color:#fff;text-shadow:0 1px 3px #000;z-index:2}
.atlas-canvas .orb.dim{opacity:.18;filter:grayscale(1)}
.atlas-canvas .orb.hit{box-shadow:0 0 0 3px #d3a15a,0 12px 28px -8px rgba(211,161,90,.6);opacity:1;filter:none;z-index:5}
.focus{position:fixed;inset:0;z-index:20;background:rgba(8,12,17,.94);display:none;align-items:center;justify-content:center;flex-direction:column;padding:20px;gap:14px}
.focus.on{display:flex}
.focus img{max-width:min(90vw,720px);max-height:72vh;object-fit:contain;border-radius:8px;box-shadow:0 20px 70px rgba(0,0,0,.7)}
.focus .meta{color:#c8d4de;font-size:.85rem;text-align:center}
.focus .bar{display:flex;gap:10px}
.focus .bar button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25)}
.switcher button{border-color:rgba(232,238,244,.25);color:#aebdca}
.switcher button.on{background:#d3a15a;border-color:#d3a15a;color:#1a2430}
footer{color:#7f92a3}
@media(max-width:640px){.atlas-canvas .orb{width:56px;height:72px}}
`,
    webgl: `
body{background:radial-gradient(ellipse at 50% 45%,#38312b 0%,#1a1613 72%);color:#f4efe8}
header h1,header small{color:#f4efe8}header small{opacity:.7}
.stage{padding:8px}
.glwrap{position:relative;width:min(80vw,460px);aspect-ratio:3/4;max-height:70vh}
.glwrap canvas{width:100%;height:100%;display:block;border-radius:3px;box-shadow:0 24px 60px -30px rgba(0,0,0,.85)}
.glwrap .fallback{position:absolute;inset:0;display:none;align-items:center;justify-content:center;border-radius:8px;background:#2a2622;color:#c9bfb3;font-size:.85rem;text-align:center;padding:20px}
.glwrap .ai-badge{position:absolute;left:10px;top:10px;z-index:4;pointer-events:none}
.glwrap.no-gl canvas{display:none}.glwrap.no-gl .fallback{display:flex}
nav button{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25);color:#f4efe8}
.switcher button{border-color:rgba(255,255,255,.25);color:#cfc7bd}
.switcher button.on{background:#c0562f;border-color:#c0562f;color:#fff}
footer{color:#9d948a}
`,
    stream: `
body{background:#0e1116;color:#eef2f6}
header h1{color:#eef2f6}header small{color:#8b98a6}
.stage{display:block;overflow-y:auto;padding:10px 12px 24px;flex:1;min-height:0;scroll-behavior:smooth}
.waterfall{column-count:3;column-gap:12px;max-width:1100px;margin:0 auto}
@media(max-width:900px){.waterfall{column-count:2}}
@media(max-width:560px){.waterfall{column-count:1}}
.waterfall .item{break-inside:avoid;margin:0 0 12px;border-radius:10px;overflow:hidden;position:relative;
  opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.3,1);box-shadow:0 10px 30px -16px rgba(0,0,0,.8)}
.waterfall .item.in{opacity:1;transform:none}
.waterfall .item:hover{box-shadow:0 16px 40px -12px rgba(211,161,90,.5)}
.waterfall .item img{width:100%;height:auto;display:block}
.waterfall .item .num{position:absolute;left:8px;bottom:8px;z-index:3;font-family:"Songti SC",serif;font-size:.75rem;color:#fff;text-shadow:0 1px 4px #000}
.switcher button{border-color:#3a4550;color:#aeb9c4}
.switcher button.on{background:#d3a15a;border-color:#d3a15a;color:#0e1116}
footer{color:#798694}
nav button{background:#1a2028;border-color:#34404c;color:#eef2f6}
`,
    film: `
body{background:#1d1b19;color:#f2ede6}
header h1{color:#f2ede6}header small{color:#a89f93}
.stage{display:flex;align-items:center;padding:10px 0}
.strip{display:flex;gap:8px;overflow-x:auto;padding:18px 16px 26px;scroll-snap-type:x mandatory;scrollbar-width:thin}
.strip::-webkit-scrollbar{height:6px}.strip::-webkit-scrollbar-thumb{background:#5a534c;border-radius:9px}
.strip .item{flex:0 0 auto;width:min(70vw,300px);aspect-ratio:4/3;scroll-snap-align:center;border-radius:3px;position:relative;
  background-image:repeating-linear-gradient(90deg,transparent 0 9px,rgba(255,255,255,.05) 9px 12px)}
.strip .item::before,.strip .item::after{content:"";position:absolute;left:0;right:0;height:11px;z-index:2;
  background:repeating-linear-gradient(90deg,#cfc7bb 0 7px,transparent 7px 13px);opacity:.85}
.strip .item::before{top:0}.strip .item::after{bottom:0}
.strip .item img{height:calc(100% - 22px);margin:11px 0}
nav button{background:#2a2724;border-color:#4a443e;color:#f2ede6}
.switcher button{border-color:#4a443e;color:#a89f93}
.switcher button.on{background:#c0562f;border-color:#c0562f;color:#fff}
footer{color:#8f877e}
`,
  }[style] || '';
  return base + per;
}

/** 生成某套模板的舞台 HTML 与翻页脚本；ids 为资产 id 数组 */
function stageFor(style, ids, title) {
  const src = (id) => `img/${encodeURIComponent(id)}?watermark=1`;
  const empty = '<div class="empty">画册暂无作品</div>';
  if (!ids.length) return { book: empty, script: '' };

  if (style === 'editorial') {
    let i = 0;
    const leaves = [];
    while (i < ids.length) {
      const pair = ids.slice(i, i + 2);
      const left = `<div class="leaf left"><span class="spread-title">${esc(title)}</span><img src="${src(pair[0])}" alt="作品 ${i + 1}"><span class="ai-badge">AI 生成</span><span class="folio">${i + 1}</span></div>`;
      const right = pair[1]
        ? `<div class="leaf right"><img src="${src(pair[1])}" alt="作品 ${i + 2}"><span class="ai-badge">AI 生成</span><span class="folio">${i + 2}</span></div>`
        : '<div class="leaf right" style="display:grid;place-items:center;color:#c9bfb3;font-family:serif">— 留白 —</div>';
      leaves.push(`<div class="spread" data-i="${i / 2}">${left}${right}</div>`);
      i += 2;
    }
    return {
      book: `<div id="viewport">${leaves.join('')}</div>`,
      script: `
const spreads=[...document.querySelectorAll('.spread')];let cur=0;
function render(){spreads.forEach((s,i)=>s.style.display=i===cur?'flex':'none');prev.disabled=cur<=0;next.disabled=cur>=spreads.length-1;counter.textContent=(cur+1)+' / '+spreads.length;}
prev.onclick=()=>{if(cur>0){cur--;render();}};next.onclick=()=>{if(cur<spreads.length-1){cur++;render();}};
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});render();`,
    };
  }

  if (style === 'cards') {
    const cards = ids.map((id, idx) => `<div class="item" data-i="${idx}" onclick="go(${idx})"><img src="${src(id)}" alt="作品 ${idx + 1}" loading="lazy"><span class="num">${String(idx + 1).padStart(2, '0')}</span><span class="ai-badge">AI</span></div>`).join('');
    return {
      book: `<div class="ring" id="ring">${cards}</div>`,
      script: `
const cards=[...document.querySelectorAll('.ring .item')];const n=cards.length;let cur=0;
function render(){cards.forEach((c,i)=>{let d=(i-cur+n)%n;if(d>n/2)d-=n;const a=d*2*Math.PI/n;
 const x=Math.sin(a)*Math.min(300,innerWidth*0.42),z=Math.cos(a)*180,y=Math.sin(a)*16;
 c.style.transform='translate3d('+x+'px,'+y+'px,'+z+'px)';
 c.style.zIndex=String(100-Math.round(Math.abs(d)*10));c.classList.toggle('active',d===0);c.classList.toggle('far',Math.abs(d)>6);});
 counter.textContent=(cur+1)+' / '+n;}
prev.onclick=()=>{cur=(cur-1+n)%n;render();};next.onclick=()=>{cur=(cur+1)%n;render();};
function go(i){cur=i;render();}
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});render();`,
    };
  }

  if (style === 'webgl') {
    // 把图片地址序列化给脚本（相对路径，保持合规）
    const urls = ids.map((id) => src(id));
    return {
      book: `<div class="glwrap" id="glwrap"><canvas id="glc"></canvas><span class="ai-badge">AI 生成 · 图派</span><div class="fallback">当前环境不支持 WebGL，已切回 CSS 3D 翻页。<br>请用「3D 精装」模板获得类似效果。</div></div>`,
      script: `
const URLS=${JSON.stringify(urls)};const N=URLS.length;let cur=0,anim=null,t0=0,from=0,to=0;
const wrap=document.getElementById('glwrap'),canvas=document.getElementById('glc');
const gl=canvas.getContext('webgl',{alpha:true,antialias:true});
if(!gl){wrap.classList.add('no-gl');prev.onclick=()=>{if(cur>0){cur--;counter.textContent=(cur+1)+' / '+N;}};next.onclick=()=>{if(cur<N-1){cur++;counter.textContent=(cur+1)+' / '+N;}};counter.textContent='1 / '+N;}
else{
const VS=\`attribute vec2 aPos;attribute vec2 aUV;uniform float uT;varying vec2 vUV;varying float vShade;
void main(){vec3 p=vec3(aPos,0.0);
 if(uT>0.001){float ang=aPos.x*3.14159*uT;p.x=cos(ang)*aPos.x;p.z=sin(ang)*0.9*(1.0-abs(aPos.x));}
 gl_Position=vec4(p,1.0);vUV=aUV;
 vShade=1.0-0.3*uT*smoothstep(0.0,1.0,aUV.x);}\`;
const FS=\`precision mediump float;uniform sampler2D uTex;uniform float uAlpha;varying vec2 vUV;varying float vShade;
void main(){vec4 c=texture2D(uTex,vUV);gl_FragColor=vec4(c.rgb*vShade,c.a*uAlpha);}\`;
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(prog);gl.useProgram(prog);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
const X=28,Y=28,verts=[],uvs=[],idx=[];
for(let j=0;j<=Y;j++)for(let i=0;i<=X;i++){verts.push(i/X*2-1,1-j/Y*2);uvs.push(i/X,1-j/Y);}
for(let j=0;j<Y;j++)for(let i=0;i<X;i++){const a=j*(X+1)+i,b=a+1,c=a+X+1,d=c+1;idx.push(a,b,c,b,d,c);}
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
const aPos=gl.getAttribLocation(prog,'aPos');gl.enableVertexAttribArray(aPos);gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
const uvBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,uvBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uvs),gl.STATIC_DRAW);
const aUV=gl.getAttribLocation(prog,'aUV');gl.enableVertexAttribArray(aUV);gl.vertexAttribPointer(aUV,2,gl.FLOAT,false,0,0);
const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);
const uT=gl.getUniformLocation(prog,'uT'),uAlpha=gl.getUniformLocation(prog,'uAlpha'),uTex=gl.getUniformLocation(prog,'uTex');
const texCache=new Map();
function tex(url){if(texCache.has(url))return texCache.get(url);const t=gl.createTexture();texCache.set(url,t);
 const im=new Image();im.crossOrigin='anonymous';im.onload=()=>{gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);draw(anim?ease((performance.now()-t0)/650):0);};
 im.onerror=()=>{const c=document.createElement('canvas');c.width=8;c.height=8;gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);};
 im.src=url;return t;}
function ease(x){x=Math.max(0,Math.min(1,x));return x<0.5?2*x*x:1-Math.pow(-2*x+2,2)/2;}
function resize(){const r=wrap.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);canvas.width=r.width*dpr;canvas.height=r.height*dpr;gl.viewport(0,0,canvas.width,canvas.height);draw(anim?ease((performance.now()-t0)/650):0);}
addEventListener('resize',resize);
function draw(t){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
 const ratio=canvas.width/canvas.height;
 // 当前页：翻出时向左卷曲
 gl.uniform1f(uT,anim&&to>from?t:0);gl.uniform1f(uAlpha,1);gl.bindTexture(gl.TEXTURE_2D,tex(URLS[from]));gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_SHORT,0);
 if(anim&&to>from){gl.uniform1f(uT,1-t);gl.uniform1f(uAlpha,t);gl.bindTexture(gl.TEXTURE_2D,tex(URLS[to]));gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_SHORT,0);}}
function flip(dir){if(anim)return;const nf=cur+dir;if(nf<0||nf>=N)return;
 if(dir>0){from=cur;to=nf;}else{from=nf;to=cur;cur=nf;}
 anim=true;t0=performance.now();counter.textContent=(to+1)+' / '+N;
 const tick=()=>{const p=(performance.now()-t0)/650;if(p>=1){anim=false;cur=to;from=cur;draw(0);return;}draw(ease(p));requestAnimationFrame(tick);};requestAnimationFrame(tick);}
prev.onclick=()=>flip(-1);next.onclick=()=>flip(1);
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});
tex(URLS[0]);resize();counter.textContent='1 / '+N;
}
`,
      hasDownload: false,
    };
  }

  if (style === 'stream') {
    const drops = ids.map((id, idx) => `<div class="item" data-i="${idx}"><img src="${src(id)}" alt="作品 ${idx + 1}" loading="lazy"><span class="ai-badge">AI</span><span class="num">${String(idx + 1).padStart(2, '0')}</span></div>`).join('');
    return {
      book: `<div class="waterfall" id="waterfall">${drops}</div>`,
      script: `
const stageEl=document.querySelector('.stage'),drops=[...document.querySelectorAll('.waterfall .item')];
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{root:stageEl,rootMargin:'0px 0px 60px 0px',threshold:.08});
drops.forEach(d=>io.observe(d));
let cur=0;
function render(){drops.forEach((d,i)=>d.classList.toggle('in',i<=cur+3));prev.disabled=cur<=0;next.disabled=cur>=drops.length-1;counter.textContent=(cur+1)+' / '+drops.length;
 const d=drops[cur];if(d)d.scrollIntoView({behavior:'smooth',block:'center'});}
prev.onclick=()=>{if(cur>0){cur--;render();}};next.onclick=()=>{if(cur<drops.length-1){cur++;render();}};
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});
stageEl.addEventListener('scroll',()=>{let best=0,dist=1e9;drops.forEach((d,i)=>{const dlt=Math.abs(d.offsetTop-stageEl.scrollTop-stageEl.clientHeight/2);if(dlt<dist){dist=dlt;best=i;}});if(best!==cur){cur=best;counter.textContent=(cur+1)+' / '+drops.length;}});
render();`,
    };
  }

  if (style === 'atlas') {
    // 按序号分组：每 4 张一圈（一组），离中心越远圈越大；主题检索用 data-tags。
    const orbs = ids.map((id, idx) => {
      const group = Math.floor(idx / 4);
      const tags = `作品 ${String(idx + 1).padStart(2, '0')} 组${group + 1} ${esc(title)}`;
      return `<div class="orb" data-i="${idx}" data-tags="${tags}" onclick="focusImg(${idx})"><img src="${src(id)}" alt="作品 ${idx + 1}" loading="lazy"><span class="num">${idx + 1}</span><span class="ai-badge">AI</span></div>`;
    }).join('');
    const groups = [...new Set(ids.map((_, i) => Math.floor(i / 4) + 1))];
    const chips = groups.map((g) => `<button class="chip" type="button" onclick="pickGroup('组${g}')">组 ${g}</button>`).join('');
    return {
      book: `<div class="atlas-tools"><input id="atlas-q" type="search" placeholder="搜作品号 / 组 / 主题" oninput="filterAtlas(this.value)">${chips}</div>
<div class="atlas-canvas" id="atlas">${orbs}</div>
<div class="focus" id="focus"><img id="focus-img" alt="聚焦作品"><div class="meta" id="focus-meta"></div><div class="bar"><button type="button" onclick="stepFocus(-1)">上一张</button><button type="button" onclick="closeFocus()">关闭 (Esc)</button><button type="button" onclick="stepFocus(1)">下一张</button></div></div>`,
      script: `
const orbs=[...document.querySelectorAll('#atlas .orb')];const N=orbs.length;
function layout(){const w=innerWidth,h=innerHeight-140,R=Math.min(w,h)*0.42;
 orbs.forEach((o,i)=>{const g=Math.floor(i/4),inG=i%4,cnt=Math.min(4,N-g*4),r=R*(0.32+g*0.23);
  const a=(inG/cnt)*2*Math.PI+g*0.5+(g%2?0.3:0);
  o.style.left='calc(50% + '+(Math.cos(a)*r)+'px)';o.style.top='calc(50% + '+(Math.sin(a)*r*0.72)+'px)';
  o.style.transform='translate(-50%,-50%) rotate('+(a*180/Math.PI*0.08)+'deg)';});}
addEventListener('resize',layout);layout();
function filterAtlas(v){const q=v.trim().toLowerCase();orbs.forEach(o=>{const hit=!q||o.dataset.tags.toLowerCase().includes(q);o.classList.toggle('dim',!hit);o.classList.toggle('hit',Boolean(q)&&hit);});}
function pickGroup(g){const q=document.getElementById('atlas-q');q.value=g;filterAtlas(g);}
let focusIdx=0;
function focusImg(i){focusIdx=i;renderFocus();document.getElementById('focus').classList.add('on');}
function renderFocus(){const o=orbs[focusIdx];if(!o)return;const im=o.querySelector('img');
 document.getElementById('focus-img').src=im.src.replace('?watermark=1','?watermark=1');
 document.getElementById('focus-meta').textContent='作品 '+(focusIdx+1)+' / '+N+' · 示例分组 · AI 生成 · 原图不公开';
 orbs.forEach((x,i)=>x.classList.toggle('hit',i===focusIdx));}
function closeFocus(){document.getElementById('focus').classList.remove('on');orbs.forEach(x=>x.classList.remove('hit'));}
function stepFocus(d){focusIdx=(focusIdx+d+N)%N;renderFocus();}
addEventListener('keydown',e=>{if(!document.getElementById('focus').classList.contains('on'))return;
 if(e.key==='Escape')closeFocus();if(e.key==='ArrowRight')stepFocus(1);if(e.key==='ArrowLeft')stepFocus(-1);});
document.getElementById('focus').addEventListener('click',e=>{if(e.target.id==='focus')closeFocus();});
prev.onclick=()=>stepFocus(-1);next.onclick=()=>stepFocus(1);counter.textContent='1 / '+N;`,
    };
  }

  if (style === 'film') {
    const frames = ids.map((id, idx) => `<div class="item" data-i="${idx}"><img src="${src(id)}" alt="作品 ${idx + 1}" loading="lazy"><span class="ai-badge">AI 生成</span><span class="caption">帧 ${String(idx + 1).padStart(2, '0')} / ${ids.length}</span></div>`).join('');
    return {
      book: `<div class="strip" id="strip">${frames}</div>`,
      script: `
const frames=[...document.querySelectorAll('.strip .item')];let cur=0;
function render(){frames.forEach((f,i)=>f.style.opacity=i===cur?'1':'.78');frames[cur]?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});counter.textContent=(cur+1)+' / '+frames.length;}
prev.onclick=()=>{if(cur>0){cur--;render();}};next.onclick=()=>{if(cur<frames.length-1){cur++;render();}};
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});
document.querySelector('.strip').addEventListener('scroll',()=>{const s=document.querySelector('.strip');let best=0,dist=1e9;frames.forEach((f,i)=>{const d=Math.abs(f.offsetLeft+s.scrollLeft+f.offsetWidth/2-s.clientWidth/2);if(d<dist){dist=d;best=i;}});if(best!==cur){cur=best;counter.textContent=(cur+1)+' / '+frames.length;frames.forEach((f,i)=>f.style.opacity=i===cur?'1':'.78');}});
render();`,
    };
  }

  // hardcover（默认）：暗场精装书，逐页 3D 翻
  const pages = ids.map((id, idx) => `<div class="item" data-i="${idx}"><img src="${src(id)}" alt="作品 ${idx + 1}" loading="lazy"><span class="ai-badge">AI 生成</span><button class="dl" onclick="dl(${idx})">保存这张</button></div>`).join('');
  return {
    book: `<div class="book" id="book">${pages}</div>`,
    script: `
const pages=[...document.querySelectorAll('.book .item')];let cur=0;
function render(){pages.forEach((p,i)=>p.classList.toggle('turned',i<cur));prev.disabled=cur<=0;next.disabled=cur>=pages.length-1;counter.textContent=(cur+1)+' / '+pages.length;}
prev.onclick=()=>{if(cur>0){cur--;render();}};next.onclick=()=>{if(cur<pages.length-1){cur++;render();}};
addEventListener('keydown',e=>{if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();});render();`,
    hasDownload: true,
  };
}

/** 下载时合成 AI 标识（所有模板的保存按钮都走这里） */
const DOWNLOAD_SCRIPT = `
async function dl(i){
  const item=document.querySelectorAll('.item')[i];const im=item?.querySelector('img');if(!im)return;
  const image=new Image();image.crossOrigin='anonymous';image.src=im.src;
  try{await image.decode();}catch{window.open(im.src,'_blank');return;}
  const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
  const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
  const fs=Math.max(14,Math.round(c.width*0.026)),pad=Math.max(12,Math.round(c.width*0.022));
  const label='AI 生成 · 图派';ctx.font='600 '+fs+'px system-ui,sans-serif';
  const tw=ctx.measureText(label).width;ctx.fillStyle='rgba(0,0,0,.55)';
  ctx.fillRect(c.width-pad*2-tw,c.height-pad*2-fs,tw+pad*2,fs+pad);
  ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(label,c.width-pad-tw,c.height-pad-fs/2);
  const a=document.createElement('a');a.download='tupai-'+(i+1)+'.jpg';a.href=c.toDataURL('image/jpeg',0.92);a.click();
}`;

/**
 * 生成完整分享页 HTML。
 * @param {string} title 画册标题
 * @param {string[]} ids 作品资产 id
 * @param {string} style 模板 id（默认 hardcover；非法值回退默认）
 */
export function albumPageHtml(title, ids, style = 'hardcover') {
  const chosen = ALBUM_STYLES.some((s) => s.id === style) ? style : 'hardcover';
  const { book, script, hasDownload } = stageFor(chosen, ids, title);
  const switcher = `<div class="switcher" role="tablist" aria-label="画册模板">${ALBUM_STYLES.map((s) =>
    `<button type="button" role="tab" data-style="${s.id}" class="${s.id === chosen ? 'on' : ''}" aria-selected="${s.id === chosen}" title="${s.hint}" onclick="setStyle('${s.id}')">${s.label}</button>`).join('')}</div>`;
  const fullScript = `
const prev=document.getElementById('prev'),next=document.getElementById('next'),counter=document.getElementById('counter');
const params=new URLSearchParams(location.search);
function setStyle(s){params.set('style',s);location.search=params.toString();}
${script}
${hasDownload ? DOWNLOAD_SCRIPT : ''}
`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · 图派画册</title>
<style>${cssFor(chosen)}</style></head><body>
<header><h1>${esc(title)}</h1><small>图派 TuPai · AI 生成作品集 · 原图不公开</small></header>
<main class="stage">${book}</main>
<nav><button id="prev" type="button">上一页</button><span class="counter" id="counter"></span><button id="next" type="button">下一页</button></nav>
${switcher}
<footer>结果图均为 AI 生成 · 由图派画册分享（只读链接）· 切换模板不改变原图</footer>
<script>${fullScript}</script></body></html>`;
}
