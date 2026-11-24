import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HELP_CONTENT } from '../js/help-content.js';
import { t } from '../js/i18n.js';
import { VIDEO_STYLES } from '../js/short-video.js';
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
    'filter-led-': [1, 2, 3]
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

test('el teclado Custom reproduce el zigzag del chasis y la PWA usa la caché actual', async () => {
  const editor = html.match(/id="custom-scale-editor"[^>]*>\s*((?:<div class="custom-key-row"[^>]*><\/div>\s*)+)/)[1];
  const rows = [...editor.matchAll(/data-degrees="([\d ]+)"/g)].map(([, degrees]) => degrees.split(' ').map(Number));
  assert.deepEqual(rows, [[1, 3, 5], [0, 2, 4, 6]]);
  const [css, tokens, serviceWorker] = await Promise.all(['css/layout.css', 'css/tokens.css', 'sw.js']
    .map(file => readFile(new URL(file, root), 'utf8')));
  assert.match(css, /html, body\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*clip/);
  assert.match(tokens, /--chassis-bg:\s*#141518;/);
  assert.match(serviceWorker, /const CACHE_NAME = 'orbita-v2-hw-v4';/);
});

test('el looper tiene cuatro botones de 32 px y un selector de audio oculto', async () => {
  const controls = html.match(/<div class="looper-controls">([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...controls.matchAll(/<button[^>]*id="([^"]+)"/g)].map(([, id]) => id), [
    'btn-looper-rec', 'btn-looper-play', 'btn-looper-load', 'btn-looper-clear'
  ]);
  assert.match(controls, /id="btn-looper-load"[^>]*>[\s\S]*?id="looper-load-led"[\s\S]*?href="#icon-folder"/);
  assert.match(html, /<input type="file" id="looper-audio-file-input" accept="audio\/\*,\.mp3,\.wav,\.m4a,\.ogg" hidden\s*\/>/);
  const css = await readFile(new URL('css/layout.css', root), 'utf8');
  assert.match(css, /\.looper-controls\s*\{[^}]*grid-template-columns:\s*repeat\(4, 1fr\);[^}]*height:\s*32px/);
  assert.equal(t('deck.trackLoadedTempo', 'es', { bpm: 120 }), 'Pista cargada · BPM 120');
  assert.equal(t('deck.trackLoadedTempo', 'en', { bpm: 120 }), 'Track loaded · 120 BPM');
});

test('el estudio muestra el filtro, la onda interactiva y los cuatro estilos de vídeo', async () => {
  const studio = html.slice(html.indexOf('id="modal-demo-result"'));
  assert.match(studio, /id="btn-voice-filter"[\s\S]*?id="filter-led-1"[\s\S]*?id="filter-led-2"[\s\S]*?id="filter-led-3"/);
  assert.equal(ids.has('btn-config-mic-filter'), false);
  assert.match(studio, /id="demo-waveform-canvas"[\s\S]*?aria-describedby="studio-wave-hint"/);
  const styles = studio.match(/id="video-style-grid"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...styles.matchAll(/<button[^>]+id="btn-video-style-([\w-]+)"[^>]+data-video-style="\1"/g)]
    .map(([, style]) => style), VIDEO_STYLES);
  const css = await readFile(new URL('css/modals.css', root), 'utf8');
  assert.match(css, /\.studio-fx-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, 1fr\)/);
  assert.match(css, /\.demo-waveform-canvas\s*\{[^}]*cursor:\s*pointer;[^}]*touch-action:\s*none/);
});

test('la pista cargada tiene faders de 0 a 150% en CONFIG y en el mezclador de maqueta', async () => {
  const config = html.slice(html.indexOf('id="config-settings"'), html.indexOf('id="modal-sessions"'));
  const studio = html.slice(html.indexOf('class="studio-mixer-box"'));
  assert.match(config, /id="config-backing-vol" min="0" max="150" value="90"[^>]*>\s*<span id="config-backing-vol-val"/);
  assert.match(studio, /id="mix-backing-row" hidden>\s*<span[^>]+data-i18n="studio.backing"[^>]*>BASE<\/span>\s*<input[^>]+id="mix-backing-vol" min="0" max="150" value="90"[^>]*>\s*<span id="mix-backing-val"/);
  assert.equal(t('studio.backing', 'es'), 'BASE');
  assert.equal(t('studio.backing', 'en'), 'TRACK');
  const [css, ui] = await Promise.all(['css/modals.css', 'js/ui-modals.js']
    .map(file => readFile(new URL(file, root), 'utf8')));
  assert.match(css, /\.mixer-row\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(ui, /getElementById\('mix-backing-row'\)\.hidden\s*=\s*!session\.hasBackingTrack/);
});

test('la captura de maqueta abre el micro crudo y aplica un pasaaltos fijo de 40 Hz', async () => {
  const source = await readFile(new URL('js/demo-recorder.js', root), 'utf8');
  const start = source.slice(source.indexOf('export async function startDemoRecording'),
    source.indexOf('export async function stopDemoRecording'));
  assert.match(start, /getUserMedia\(\{\s*audio:\s*\{\s*echoCancellation:\s*false,\s*noiseSuppression:\s*false,\s*autoGainControl:\s*false\s*\}\s*\}\)/);
  assert.match(start, /micHighpass\.type\s*=\s*'highpass';\s*micHighpass\.frequency\.setValueAtTime\(40,/);
  assert.doesNotMatch(start, /micFilterLevel|gateThreshold/);
});

test('el tutorial tiene siete objetivos reales y explica el detector en ambos idiomas', () => {
  assert.equal(TUTORIAL_STEPS.length, 7);
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
  const detector = TUTORIAL_STEPS.find(({ target }) => target === '#btn-open-tonality');
  assert.ok(detector);
  for (const lang of languages) assert.match(t(detector.title, lang), /𝄞/u);
  assert.match(t(detector.body, 'es'), /micrófono.*canta o toca.*20 segundos.*mapa de calor.*rojo.*verde.*dominante.*aplica/i);
  assert.match(t(detector.body, 'en'), /microphone.*sing or play.*20 seconds.*heat map.*red.*green.*dominant.*apply/i);
});

test('la ayuda bilingüe incluye una sección dedicada a la estadística de notas y los cuatro colores', () => {
  for (const lang of languages) {
    assert.equal(HELP_CONTENT[lang].length, 7);
    for (const { title, topics } of HELP_CONTENT[lang]) {
      assert.ok(title.length > 0 && topics.length >= 2);
      for (const [heading, body] of topics) assert.ok(heading.length > 0 && body.length > 0);
    }
  }
  assert.deepEqual(HELP_CONTENT.es.map(section => section.topics.length), HELP_CONTENT.en.map(section => section.topics.length));
  assert.notDeepEqual(HELP_CONTENT.es, HELP_CONTENT.en);
  const es = HELP_CONTENT.es.find(({ title }) => /Clave de Sol.*estadística de notas/i.test(title));
  const en = HELP_CONTENT.en.find(({ title }) => /Treble Clef.*note statistics/i.test(title));
  assert.ok(es && en);
  assert.match(es.topics.flat().join(' '), /frecuencia.*presencia.*ventana deslizante de 20 segundos.*rojo.*naranja.*amarillo.*verde.*mayor o menor.*referencia.*afinar la voz/i);
  assert.match(en.topics.flat().join(' '), /frequencies.*presence.*rolling 20-second window.*red.*orange.*yellow.*green.*major or minor.*reference pitch.*voice/i);
  assert.match(HELP_CONTENT.es.flatMap(({ topics }) => topics.flat()).join(' '), /zigzag.*Mayor \(M.*menor \(m.*octava 0.*Melodía/);
  assert.match(HELP_CONTENT.en.flatMap(({ topics }) => topics.flat()).join(' '), /zigzag.*Major \(M.*minor \(m.*octave 0.*Melody/);
  assert.match(HELP_CONTENT.es.flatMap(({ topics }) => topics.flat()).join(' '), /Filtro de voz a posteriori.*0 a 3 LEDs.*Toca o haz clic en la onda.*Puro.*Teclado.*Órbita.*Cosmos/);
  assert.match(HELP_CONTENT.en.flatMap(({ topics }) => topics.flat()).join(' '), /Voice filter after recording.*0 to 3 emerald LEDs.*Tap or click the waveform.*Pure.*Keys.*Orbit.*Cosmos/);
});
