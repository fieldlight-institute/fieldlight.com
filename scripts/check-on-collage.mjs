import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {frameFor, rabbitPosition} from '../writing/on/collage.mjs';

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
  for (const [,ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (ref.startsWith('#')) assert.ok(ids.has(ref.slice(1)), ref);
    else if (ref.startsWith('/')) assert.ok(fs.existsSync(path.resolve(root, '../..', '.' + ref)), ref);
    else if (!/^(?:https?:|\/)/.test(ref)) assert.ok(fs.existsSync(path.join(root,ref.split('?')[0])), ref);
  }
});
test('rabbit stays inside the available track, including narrow and enlarged-text layouts', () => {
  for (const width of [100,220,300,550]) for (const frame of [0,1,2,4,7,8,9]) {
    const p = rabbitPosition(frame,width,155);
    assert.ok(p.x >= 0 && p.x <= Math.max(0,width-155));
    assert.ok(p.y >= -17 && p.y <= 0);
    assert.ok(p.frame >= 1 && p.frame <= 8);
  }
  assert.equal(frameFor('bad'),1);
  assert.deepEqual(rabbitPosition(8,400,150,false),{frame:8,x:250,y:0,angle:0});
});
test('reduced motion, readable fallback, and no automatic publication or analytics', () => {
  const css = fs.readFileSync(path.join(root,'collage.css'),'utf8');
  const js = fs.readFileSync(path.join(root,'collage.mjs'),'utf8');
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/html\.motion-paused\{scroll-behavior:auto\}/);
  assert.match(js,/doc\.documentElement\.classList\.toggle\('motion-paused', paused\)/);
  assert.match(css,/@media print/);
  assert.match(html,/noindex, nofollow/);
  assert.doesNotMatch(html,/article:published_time|cloudflareinsights|gtag\(/);
  assert.doesNotMatch(js,/fetch\(|localStorage|sessionStorage/);
  assert.match(html,/The words so old/);
  assert.doesNotMatch(html, /id="flip-page"[^>]*aria-label=/, 'The visible slider label remains its accessible name');
});
