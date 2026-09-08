import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runFrame, startCollage} from '../writing/on/collage.mjs';

const root = fileURLToPath(new URL('../writing/on/', import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
test('all five source sections and the original six-position refrain sequence survive', () => {
  for (const id of ['print','place','reading','ending','flow']) assert.match(html, new RegExp(`id="${id}"`));
  assert.deepEqual([...html.matchAll(/data-position="(.*?)"/g)].map(m => m[1]), ['left','center','right','left','center','right']);
  assert.equal([...html.matchAll(/A hanging pot swayed from a hook I placed outside my bathroom window\./g)].length, 6);
  assert.ok(html.indexOf('The prow spirit') < html.indexOf('She knew the feel'));
});
test('local asset and fragment references resolve', () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const ids = new Set(allIds);
  assert.equal(ids.size, allIds.length, 'IDs are unique');
  for (const [,ref] of html.matchAll(/(?:src|href|data-sprite)="([^"]+)"/g)) {
    if (ref.startsWith('#')) assert.ok(ids.has(ref.slice(1)), ref);
    else if (ref.startsWith('/')) assert.ok(fs.existsSync(path.resolve(root, '../..', '.' + ref)), ref);
    else if (!/^(?:https?:|\/)/.test(ref)) assert.ok(fs.existsSync(path.join(root,ref.split('?')[0])), ref);
  }
});
test('rabbit runs through distinct leg frames and remains within the margin', () => {
  for (const width of [100,220,300,550]) for (const time of [-1,0,80,320,640,1400,5000]) {
    const p = runFrame(time,width,155);
    assert.ok(p.x >= 0 && p.x <= Math.max(0,width-155));
    assert.ok(p.frame >= 0 && p.frame <= 7);
    assert.ok(p.column >= 0 && p.column <= 3);
    assert.ok(p.row === 0 || p.row === 1);
  }
  assert.deepEqual(Array.from({length:8}, (_,n) => runFrame(n*80,550,155).frame),[0,1,2,3,4,5,6,7]);
  assert.equal(runFrame('bad',550,155).x,0);
  assert.deepEqual(runFrame(5000,400,150),{frame:7,x:250,column:3,row:1,done:true});
  assert.equal(runFrame(Infinity,900,150).x,750);
});
test('reduced motion, readable fallback, and motion without data collection', () => {
  const css = fs.readFileSync(path.join(root,'collage.css'),'utf8');
  const js = fs.readFileSync(path.join(root,'collage.mjs'),'utf8');
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/html\.motion-paused\{scroll-behavior:auto\}/);
  assert.match(js,/doc\.documentElement\.classList\.toggle\('motion-paused', paused\)/);
  assert.match(css,/@media print/);
  assert.doesNotMatch(html,/gtag\(/);
  assert.doesNotMatch(js,/fetch\(|localStorage|sessionStorage/);
  assert.match(html,/The words so old/);
  assert.doesNotMatch(html, /flip-page|Turn the pages|flip-controls|type="range"/);
  assert.match(html,/rabbit-still/);
  assert.match(html,/rabbit-ink/);
});

test('publication metadata, share card, canonical source and discovery entries agree', () => {
  const url = 'https://fieldlight.com/writing/on/';
  const share = url + 'assets/on-share-2026-09-07.png';
  const site = path.resolve(root, '../..');
  assert.match(html, /rel="canonical" href="https:\/\/fieldlight\.com\/writing\/on\/"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const property of ['og:image', 'twitter:image']) {
    assert.ok(html.includes(`${property}" content="${share}"`));
  }
  const card = fs.readFileSync(path.join(root, 'assets/on-share-2026-09-07.png'));
  assert.equal(card.readUInt32BE(16), 1730);
  assert.equal(card.readUInt32BE(20), 909);
  assert.ok(card.length < 5 * 1024 * 1024, 'share image fits platform size limit');
  assert.match(html, /article:published_time/);
  assert.doesNotMatch(html, /noindex|nofollow|in progress|\/Users\/|127\.0\.0\.1|localhost/);
  assert.match(html, /public-writing\/blob\/main\/fiction-myth-and-story-worlds\/on-collage\/on\.md/);
  assert.match(html, /a8ece4976a604339bac4dbb72a6c5856/);
  const item = JSON.parse(fs.readFileSync(path.join(site, 'feed.json'), 'utf8')).items.find(item => item.url === url);
  assert.equal(item.title, 'On…');
  assert.equal(item.image, share);
  for (const file of ['feed.xml', 'sitemap.xml', 'llms.txt']) {
    assert.ok(fs.readFileSync(path.join(site, file), 'utf8').includes(url), file);
  }
  assert.ok(fs.readFileSync(path.join(site, 'writing/index.html'), 'utf8').includes('href="on/"'));
});

test('reading text has em dashes or commas, not hyphen or en-dash punctuation', () => {
  const text = html.replace(/<[^>]*>/g,'');
  assert.doesNotMatch(text,/[\u2013-]/);
  assert.match(text,/In every outdoor pot I so carefully tend, he’s been hiding nuts/);
  assert.match(text,/I bring the pots inside for winter/);
  assert.match(text,/Come spring, oak trees are growing all over my house/);
  assert.match(text,/oak trees are growing all over my house/);
  assert.doesNotMatch(text,/Chad’s forest|Flaming Katy had found her own patch of ground/);
});

function motionHarness(reduced = false) {
  const listeners = new Map();
  function element(name) {
    const classes = new Set();
    return {
      name, style:{setProperty(){}}, dataset:{}, clientWidth:450, offsetWidth:175,
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},
      setAttribute(){}, addEventListener(event,handler){listeners.set(name+':'+event,handler);},
    };
  }
  const elements = Object.fromEntries(['.motion-toggle','.rabbit-passage','.rabbit-runner','.paper-fragment'].map(name=>[name,element(name)]));
  elements['.rabbit-runner'].dataset.sprite = 'assets/rabbit-run-cycle.png';
  const doc = Object.assign(element('doc'),{body:element('body'),documentElement:element('html'),hidden:false,querySelector:s=>elements[s],querySelectorAll:()=>[]});
  let sprite;
  const observers = [], pending = new Map();
  let id = 0;
  const win = Object.assign(element('window'),{
    matchMedia:()=>({matches:reduced,addEventListener(){}}),
    requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:key=>pending.delete(key),
    Image:class {constructor(){sprite=this;this.naturalWidth=1774;this.naturalHeight=887;}},
    IntersectionObserver:class {constructor(callback){observers.push(callback);}observe(){}unobserve(){}},
  });
  startCollage(doc,win);
  return {
    doc,elements,pending,
    load:()=>sprite.onload(),
    view:(visible, ratio = 1)=>observers[0]([{isIntersecting:visible, intersectionRatio:visible ? ratio : 0}]),
    tick:time=>{const tasks=[...pending.values()];pending.clear();tasks.forEach(fn=>fn(time));},
    pause:()=>listeners.get('.motion-toggle:click')(),
    visibility:()=>listeners.get('doc:visibilitychange')(),
  };
}

test('automatic run starts in view, pauses cleanly, ends once, and honors reduced motion', () => {
  const h = motionHarness();
  h.load();
  assert.equal(h.pending.size,0,'not run before visible');
  h.view(true,.1); assert.equal(h.pending.size,0,'not run when only a sliver is visible');
  h.view(true); h.tick(0); h.tick(160);
  assert.equal(h.elements['.rabbit-runner'].style.transform,'translateX(31.428571428571427px)');
  const frame = h.elements['.rabbit-runner'].style.backgroundPosition;
  h.pause(); assert.equal(h.pending.size,0);
  h.tick(10000); assert.equal(h.elements['.rabbit-runner'].style.backgroundPosition,frame);
  h.pause(); h.tick(11000); h.tick(11200);
  assert.notEqual(h.elements['.rabbit-runner'].style.backgroundPosition,frame);
  h.doc.hidden = true; h.visibility(); assert.equal(h.pending.size,0);
  h.doc.hidden = false; h.visibility(); h.tick(12000); h.tick(20000);
  assert.equal(h.pending.size,0,'not a looping distraction');
  h.view(false); h.view(true); assert.equal(h.pending.size,0,'completed run does not replay on scroll');
  const r = motionHarness(true); r.load(); r.view(true);
  assert.equal(r.pending.size,0);
  assert.equal(r.elements['.rabbit-passage'].classList.contains('sprite-active'),false,'approved still remains under reduced motion');
});
