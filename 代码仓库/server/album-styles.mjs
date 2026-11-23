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
