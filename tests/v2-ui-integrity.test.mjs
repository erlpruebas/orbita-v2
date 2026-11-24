import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HELP_CONTENT } from '../js/help-content.js';
import { t } from '../js/i18n.js';
import { TUTORIAL_STEPS } from '../js/tutorial.js';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const idList = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
const ids = new Set(idList);
const tabs = ['sounds', 'accomp', 'drums', 'settings'];
const languages = ['es', 'en'];

test('los IDs usados por la interfaz y las referencias SVG existen y son únicos', async () => {
  assert.equal(idList.length, ids.size, 'IDs duplicados en index.html');
  const families = {
    'tab-btn-': tabs,
    'beat-led-': [0, 1, 2, 3],
    'hum-led-': [1, 2, 3],
    'rev-led-': [1, 2, 3],
    'echo-led-': [1, 2, 3],
    'chorus-led-': [1, 2, 3],
    'mic-filter-led-': [1, 2, 3]
  };
  const sources = (await readdir(new URL('js/', root)))
    .filter(name => name.endsWith('.js'))
    .map(name => `js/${name}`);

  for (const file of [...sources, 'sw.js']) {
    const js = await readFile(new URL(file, root), 'utf8');
    for (const [, , id] of js.matchAll(/\bgetElementById\(\s*(['"`])([^'"`]+)\1/g)) {
      const template = id.match(/^(.+)\$\{\w+}$/);
      if (template) {
        const [, prefix] = template;
        assert.ok(families[prefix], `${file} no tiene valores de prueba para ${id}`);
        for (const suffix of families[prefix]) assert.ok(ids.has(prefix + suffix), `${file} usa ${prefix}${suffix}`);
      } else {
        assert.ok(ids.has(id), `${file} usa ${id}`);
      }
    }
    for (const [, , selector] of js.matchAll(/\bquerySelector(?:All)?\(\s*(['"`])([^'"`]+)\1/g)) {
      for (const [, id] of selector.matchAll(/#([\w-]+)/g)) assert.ok(ids.has(id), `${file} usa #${id}`);
    }
    for (const [, id] of js.matchAll(/#(icon-[\w-]+)/g)) assert.ok(ids.has(id), `${file} usa #${id}`);
  }
  for (const [, id] of html.matchAll(/<use\s+href="#([\w-]+)"/g)) assert.ok(ids.has(id), `Falta el símbolo ${id}`);
});

test('el banco ofrece las cuatro pestañas y las etiquetas estáticas están traducidas', () => {
  assert.deepEqual(idList.filter(id => id.startsWith('tab-btn-')), tabs.map(tab => `tab-btn-${tab}`));
  const keys = [...html.matchAll(/\bdata-i18n(?:-aria|-title|-placeholder)?="([^"]+)"/g)].map(([, key]) => key);
  for (const lang of languages) {
    for (const key of keys) assert.notEqual(t(key, lang), key, `${lang}: falta ${key}`);
  }
});

test('el OLED tiene cuatro casillas y el estudio expone cámara, título y acciones de vídeo', async () => {
  const strip = html.match(/<div class="hw-status-strip"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...strip.matchAll(/id="(status-pill-\w+)"/g)].map(([, id]) => id), [
    'status-pill-sound', 'status-pill-accomp', 'status-pill-drum', 'status-pill-prog'
  ]);
  assert.match(strip, /href="#icon-prog"/);
  assert.match(strip, /id="status-prog-name">—<\/span>/);
  assert.match(html, /id="prog-num"[^>]*>0<\/output>/);
  assert.match(html, /id="prog-info-badge"[^>]*\bhidden\b/);
  assert.match(html, /<aside id="camera-live-pip"[^>]*\bhidden\b/);
  assert.match(html, /<video id="camera-live-video" autoplay muted playsinline>/);
  assert.match(html, /<input[^>]*id="demo-video-title-input" maxlength="40"/);
  for (const id of ['demo-video-progress', 'demo-video-preview', 'demo-video-download', 'btn-share-demo-video']) {
    assert.ok(ids.has(id), `Falta #${id}`);
  }
  const css = await readFile(new URL('css/layout.css', root), 'utf8');
  const stripStyles = css.match(/\.hw-status-strip\s*\{([^}]+)\}/)[1];
  assert.match(stripStyles, /height:\s*24px/);
  assert.match(stripStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('el tutorial tiene seis objetivos reales y texto completo en ambos idiomas', () => {
  assert.equal(TUTORIAL_STEPS.length, 6);
  for (const { target, title, body } of TUTORIAL_STEPS) {
    for (const selector of target.split(', ')) {
      if (selector.startsWith('#')) assert.ok(ids.has(selector.slice(1)), `Falta ${selector}`);
      else assert.match(html, new RegExp(`class="[^"]*\\b${selector.slice(1)}\\b`));
    }
    for (const key of [title, body]) {
      for (const lang of languages) assert.notEqual(t(key, lang), key);
      assert.notEqual(t(key, 'es'), t(key, 'en'));
    }
  }
});

test('la ayuda tiene seis secciones equivalentes en español e inglés', () => {
  for (const lang of languages) {
    assert.equal(HELP_CONTENT[lang].length, 6);
    for (const { title, topics } of HELP_CONTENT[lang]) {
      assert.ok(title.length > 0 && topics.length >= 2);
      for (const [heading, body] of topics) assert.ok(heading.length > 0 && body.length > 0);
    }
  }
  assert.deepEqual(HELP_CONTENT.es.map(section => section.topics.length), HELP_CONTENT.en.map(section => section.topics.length));
  assert.notDeepEqual(HELP_CONTENT.es, HELP_CONTENT.en);
});
