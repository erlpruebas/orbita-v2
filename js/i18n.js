/**
 * i18n.js — Textos de interfaz en español e inglés.
 */

import { POPULAR_PROGRESSIONS } from './progressions.js';
import { CUSTOM_SCALE_PRESETS } from './theory.js';

export const INTERVAL_LABELS = Object.freeze({
  es: Object.freeze([
    'Unísono (1ª)', '2ª menor', '2ª mayor', '3ª menor', '3ª mayor', '4ª justa',
    'Tritono', '5ª justa', '6ª menor', '6ª mayor', '7ª menor', '7ª mayor'
  ]),
  en: Object.freeze([
    'Unison (1st)', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th',
    'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th'
  ])
});

export const SHORT_INTERVAL_LABELS = Object.freeze({
  es: Object.freeze(['1ª', '2ªm', '2ªM', '3ªm', '3ªM', '4ªJ', 'TT', '5ªJ', '6ªm', '6ªM', '7ªm', '7ªM']),
  en: Object.freeze(['1st', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'])
});

const messages = {
  'common.close': ['Cerrar', 'Close'],
  'common.cancel': ['Cancelar', 'Cancel'],
  'common.save': ['Guardar', 'Save'],
  'common.play': ['Reproducir', 'Play'],
  'common.stop': ['Parar', 'Stop'],
  'common.previous': ['Anterior', 'Previous'],
  'common.next': ['Siguiente', 'Next'],
  'common.on': ['Activada', 'On'],
  'common.off': ['Desactivada', 'Off'],

  'header.app': ['ÓRBITA v2 — Sintetizador Táctil', 'ÓRBITA v2 — Touch Synthesizer'],
  'header.record': ['Grabar maqueta', 'Record demo'],
  'header.recordTitle': ['Grabar maqueta (música y voz)', 'Record demo (music and vocals)'],
  'header.recordCancel': ['Cancelar la precuenta de la maqueta', 'Cancel the demo count-in'],
  'header.recordStop': ['Parar la grabación de la maqueta', 'Stop recording the demo'],
  'header.config': ['Configuración', 'Settings'],
  'header.bank': ['Configuración del banco 50 → 9', '50 → 9 bank settings'],
  'header.tonality': ['Clave de Sol · Detector de tonalidad', 'Treble Clef · Key Detector'],
  'header.sessions': ['Canciones', 'Songs'],
  'header.progressions': ['Progresiones', 'Progressions'],
  'header.help': ['Ayuda', 'Help'],
  'header.yAxis': ['Modo de expresión del eje Y', 'Y-axis expression mode'],
  'header.yAxis.filter': ['Filtro', 'Filter'],
  'header.yAxis.volume': ['Volumen', 'Volume'],
  'header.yAxis.drive': ['Distorsión', 'Drive'],
  'header.keyStrike': ['Golpe de tecla', 'Key strike'],
  'header.pureGate': ['Compuerta pura', 'Pure gate'],

  'deck.manual': ['Manual', 'Manual'],
  'deck.pattern': ['Patrón {number}', 'Pattern {number}'],
  'deck.panel': ['Panel de control', 'Control deck'],
  'deck.keyboard': ['Teclado diatónico de 7 teclas', '7-key diatonic keyboard'],
  'deck.scaleMode': ['Cambiar modo de escala · {mode}', 'Change scale mode · {mode}'],
  'deck.playMode': ['Modo Melodía o Acordes', 'Melody or chord mode'],
  'deck.humanize': ['Humanizador 0 a 3', 'Humanizer, levels 0 to 3'],
  'deck.reverb': ['Reverb 0 a 3', 'Reverb, levels 0 to 3'],
  'deck.accompPrevious': ['Acompañamiento anterior', 'Previous accompaniment'],
  'deck.accompNext': ['Acompañamiento siguiente', 'Next accompaniment'],
  'deck.accompPattern': ['Patrón de acompañamiento', 'Accompaniment pattern'],
  'deck.tonicUp': ['Subir semitono', 'Raise tonic by a semitone'],
  'deck.tonicDown': ['Bajar semitono', 'Lower tonic by a semitone'],
  'deck.octaveUp': ['Subir octava', 'Octave up'],
  'deck.octaveDown': ['Bajar octava', 'Octave down'],
  'deck.soundNext': ['Siguiente sonido', 'Next sound'],
  'deck.soundPrevious': ['Anterior sonido', 'Previous sound'],
  'deck.tapTempo': ['Toques seguidos para marcar el tempo', 'Tap repeatedly to set tempo'],
  'deck.metronome': ['Metrónomo y Tap Tempo', 'Metronome and tap tempo'],
  'deck.bpmUp': ['Subir BPM', 'Increase BPM'],
  'deck.bpmDown': ['Bajar BPM', 'Decrease BPM'],
  'deck.drumToggle': ['Reproducir o parar batería', 'Play or stop drums'],
  'deck.drumNext': ['Siguiente batería', 'Next drum pattern'],
  'deck.drumPrevious': ['Anterior batería', 'Previous drum pattern'],
  'deck.soundStatus': ['Sonido activo (pulsa para configurar)', 'Active sound (press to configure)'],
  'deck.accompStatus': ['Acompañamiento activo (pulsa para configurar)', 'Active accompaniment (press to configure)'],
  'deck.drumStatus': ['Batería activa (pulsa para configurar)', 'Active drums (press to configure)'],
  'deck.loopRecord': ['Grabar bucle', 'Record loop'],
  'deck.loopPlay': ['Reproducir o parar looper', 'Play or stop looper'],
  'deck.loopLoad': ['Cargar pista de audio', 'Load audio track'],
  'deck.loopClear': ['Borrar bucle y pista', 'Clear loop and track'],
  'deck.trackLoaded': ['Pista cargada', 'Track loaded'],
  'deck.trackLoadedTempo': ['Pista cargada · BPM {bpm}', 'Track loaded · {bpm} BPM'],
  'deck.trackLoadError': ['No se pudo decodificar la pista de audio', 'Could not decode the audio track'],

  'bank.title': ['BANCO 50 → 9', 'BANK 50 → 9'],
  'bank.sounds': ['SONIDOS', 'SOUNDS'],
  'bank.accompaniments': ['ACOMP.', 'ACCOMP.'],
  'bank.drums': ['BATERÍAS', 'DRUMS'],
  'bank.config': ['CONFIG', 'SETTINGS'],
  'bank.slots': ['Huecos activos', 'Active slots'],
  'bank.slotsHint': ['Elige hasta 9 favoritos (numerados 1–9 por orden)', 'Choose up to 9 favorites (numbered 1–9 in order)'],
  'bank.tabCount': ['{label} ({count})', '{label} ({count})'],
  'bank.slotCount': ['{count} / {max}', '{count} / {max}'],
  'bank.assignSlot': ['Asignar hueco (máx. 9)', 'Assign slot (up to 9)'],
  'bank.releaseSlot': ['Hueco n.º {number} (pulsa para liberar)', 'Slot #{number} (press to remove)'],
  'bank.preview': ['Escuchar muestra (una vez)', 'Play preview once'],

  'custom.title': ['Teclado Custom', 'Custom Keyboard'],
  'custom.edit': ['Editar escala Custom', 'Edit custom scale'],
  'custom.instructions': [
    'Ajusta el intervalo con ▲ y ▼, alterna entre Mayor (M) y menor (m) y escucha el acorde con ▶.',
    'Adjust the interval with ▲ and ▼, toggle Major (M) or minor (m), and preview the chord with ▶.'
  ],
  'custom.degree': ['Grado {roman}', 'Degree {roman}'],
  'custom.interval': ['Intervalo', 'Interval'],
  'custom.quality.M': ['Mayor', 'Major'],
  'custom.quality.m': ['Menor', 'Minor'],
  'custom.toggleQuality': ['Cambiar cualidad del acorde ({quality})', 'Toggle chord quality ({quality})'],
  'custom.presets': ['Preajustes de escala', 'Scale presets'],
  'custom.applyPreset': ['Aplicar {preset}', 'Apply {preset}'],
  'custom.useScale': ['Usar escala Custom', 'Use custom scale'],
  'custom.active': ['ACTIVO', 'ACTIVE'],
  'custom.inactive': ['INACTIVO', 'INACTIVE'],
  'custom.intervalUp': ['Subir intervalo', 'Raise interval'],
  'custom.intervalDown': ['Bajar intervalo', 'Lower interval'],
  'custom.previewDegree': ['Escuchar grado {roman}', 'Preview degree {roman}'],

  'config.languageNotation': ['Idioma y notación musical', 'Language and notation'],
  'config.language': ['Idioma', 'Language'],
  'config.language.auto': ['Auto', 'Auto'],
  'config.language.es': ['Español', 'Español'],
  'config.language.en': ['English', 'English'],
  'config.notation': ['Notación musical', 'Note notation'],
  'config.notation.solfege': ['DO RE MI', 'DO RE MI'],
  'config.notation.letter': ['C D E', 'C D E'],
  'config.studio': ['Estudio de Maqueta', 'Demo Studio'],
  'config.camera': ['Cámara frontal', 'Front camera'],
  'config.camera.on': ['Cámara frontal activada', 'Front camera on'],
  'config.camera.off': ['Cámara frontal desactivada', 'Front camera off'],
  'config.cameraDescription': ['Graba con la cámara frontal al capturar una maqueta para incluirte en el vídeo corto 9:16.', 'Record with the front camera during a demo to appear in the 9:16 short video.'],
  'config.backingVolume': ['Volumen de pista cargada', 'Loaded track volume'],

  'progressions.title': ['Progresiones populares', 'Popular Progressions'],
  'progressions.select': ['Elegir progresión', 'Choose progression'],
  'progressions.none': ['Sin progresión', 'No progression'],
  'progressions.play': ['Reproducir progresión', 'Play progression'],
  'progressions.stop': ['Parar progresión', 'Stop progression'],
  'progressions.next': ['Progresión siguiente', 'Next progression'],
  'progressions.previous': ['Progresión anterior', 'Previous progression'],
  'progressions.genre': ['Género', 'Genre'],
  'progressions.instructions': ['Cada acorde dura un compás.', 'Each chord lasts one bar.'],

  'sessions.title': ['Sesiones y canciones', 'Sessions and Songs'],
  'sessions.name': ['Nombre de la canción', 'Song name'],
  'sessions.untitled': ['Sin título', 'Untitled'],
  'sessions.empty': ['Aún no has guardado ninguna canción.', 'You have no saved songs yet.'],
  'sessions.save': ['Guardar canción', 'Save song'],
  'sessions.load': ['Cargar canción', 'Load song'],
  'sessions.rename': ['Renombrar canción', 'Rename song'],
  'sessions.delete': ['Borrar canción', 'Delete song'],
  'sessions.confirmDelete': ['¿Borrar «{name}»?', 'Delete “{name}”?'],
  'sessions.updatedAt': ['Actualizada el {date}', 'Updated {date}'],
  'sessions.saved': ['Se guardó «{name}».', '“{name}” was saved.'],
  'sessions.loaded': ['Se cargó «{name}».', '“{name}” was loaded.'],
  'sessions.storageError': ['No se pudo acceder a las canciones guardadas.', 'Could not access saved songs.'],
  'sessions.openAction': ['Abrir', 'Open'],
  'sessions.renameAction': ['Renombrar', 'Rename'],
  'sessions.deleteAction': ['Borrar', 'Delete'],
  'sessions.loop': ['Bucle {bars}B', '{bars}B loop'],
  'sessions.noLoop': ['Sin bucle', 'No loop'],
  'sessions.loopBadge': ['{bars}B LOOP', '{bars}B LOOP'],

  'tonality.title': ['DETECTOR DE TONALIDAD (20s)', 'KEY DETECTOR (20s)'],
  'tonality.micOpen': ['ABRIR MICRÓFONO', 'TURN ON MICROPHONE'],
  'tonality.micStop': ['ESCUCHANDO (PARAR)', 'LISTENING (STOP)'],
  'tonality.micPaused': ['Micrófono en pausa', 'Microphone paused'],
  'tonality.micError': ['No se pudo acceder al micrófono.', 'Could not access the microphone.'],
  'tonality.micSecure': ['El micrófono requiere HTTPS o localhost.', 'Microphone access requires HTTPS or localhost.'],
  'tonality.listeningHint': ['Canta o toca una melodía…', 'Sing or play a melody…'],
  'tonality.voiceDemo': ['DEMO VOZ', 'VOCAL DEMO'],
  'tonality.voiceDemoTitle': ['Probar con una melodía simulada', 'Try with a simulated melody'],
  'tonality.reset': ['REINICIAR 20s', 'RESET 20s'],
  'tonality.estimatedKey': ['Tonalidad estimada (notas en amarillo y verde)', 'Estimated key (yellow and green notes)'],
  'tonality.applyMajor': ['APLICAR MAYOR', 'APPLY MAJOR'],
  'tonality.applyMinor': ['APLICAR MENOR', 'APPLY MINOR'],
  'tonality.applyKey': ['APLICAR {key}', 'APPLY {key}'],
  'tonality.heatRed': ['Rojo: mínima', 'Red: minimal'],
  'tonality.heatOrange': ['Naranja: baja', 'Orange: low'],
  'tonality.heatYellow': ['Amarillo: frecuente', 'Yellow: frequent'],
  'tonality.heatGreen': ['Verde: dominante', 'Green: dominant'],
  'tonality.reference': ['Toca una tecla para escuchar la nota de referencia.', 'Tap a key to hear its reference note.'],

  'studio.title': ['ESTUDIO DE MAQUETA', 'DEMO STUDIO'],
  'studio.music': ['Música', 'Music'],
  'studio.voice': ['Voz', 'Vocals'],
  'studio.backing': ['BASE', 'TRACK'],
  'studio.masterCompLevel': ['COMP, nivel {level} de 3', 'COMP, level {level} of 3'],
  'studio.masterOutput': ['SALIDA', 'OUTPUT'],
  'studio.masterResetClip': ['Reiniciar testigo CLIP y pico sostenido', 'Reset CLIP indicator and peak hold'],
  'studio.trimStart': ['Inicio', 'Start'],
  'studio.trimEnd': ['Final', 'End'],
  'studio.seek': ['Posición en la mezcla', 'Mix position'],
  'studio.seekHint': ['Toca la onda para saltar a cualquier punto.', 'Tap the waveform to jump to any point.'],
  'studio.syncFine': ['Ajuste fino SINCRO', 'Fine SYNC'],
  'studio.syncTitle': ['Compensación de latencia entre voz y música', 'Latency compensation between vocals and music'],
  'studio.syncEarlier': ['Adelantar voz {ms} ms', 'Move vocals {ms} ms earlier'],
  'studio.syncLater': ['Retrasar voz {ms} ms', 'Move vocals {ms} ms later'],
  'studio.syncAuto': ['Alinear voz y música automáticamente', 'Auto-align vocals and music'],
  'studio.syncMinus': ['Adelantar voz 10 ms', 'Move vocals 10 ms earlier'],
  'studio.syncPlus': ['Retrasar voz 10 ms', 'Move vocals 10 ms later'],
  'studio.auto': ['AUTO', 'AUTO'],
  'studio.echo': ['Eco voz', 'Vocal echo'],
  'studio.chorus': ['Chorus voz', 'Vocal chorus'],
  'studio.filter': ['Filtro voz', 'Voice filter'],
  'studio.filterLevel': ['Filtro voz, nivel {level} de 3', 'Voice filter, level {level} of 3'],
  'studio.preview': ['ESCUCHAR MEZCLA', 'PREVIEW MIX'],
  'studio.stopPreview': ['PARAR ESCUCHA', 'STOP PREVIEW'],
  'studio.export': ['EXPORTAR (.MP3)', 'EXPORT (.MP3)'],
  'studio.exporting': ['Exportando mezcla…', 'Exporting mix…'],
  'studio.share': ['COMPARTIR MAQUETA (.MP3)', 'SHARE DEMO (.MP3)'],
  'studio.sharing': ['Preparando MP3…', 'Preparing MP3…'],
  'studio.shareTitle': ['Maqueta ÓRBITA', 'ÓRBITA demo'],
  'studio.shareText': ['Maqueta grabada y mezclada en ÓRBITA', 'Demo recorded and mixed in ÓRBITA'],
  'studio.noVoice': ['La maqueta solo contiene la pista de música.', 'The demo contains only the music track.'],
  'studio.noVoiceDenied': ['Permiso de micrófono denegado. La maqueta solo contiene música.', 'Microphone permission was denied. The demo contains music only.'],
  'studio.noVoiceSecure': ['El micrófono requiere HTTPS o localhost. La maqueta solo contiene música.', 'The microphone requires HTTPS or localhost. The demo contains music only.'],
  'studio.video.title': ['Generador de vídeo corto', 'Short Video Maker'],
  'studio.video.titleInput': ['Título del vídeo (opcional)', 'Video title (optional)'],
  'studio.video.create': ['Generar vídeo corto', 'Make short video'],
  'studio.video.instructions': ['Usa la mezcla recortada como audio del vídeo.', 'Use the trimmed mix as the video soundtrack.'],
  'studio.video.style': ['Estilo de vídeo', 'Video style'],
  'studio.video.pure': ['1 · Puro', '1 · Pure'],
  'studio.video.pureDesc': ['Cine limpio y minimalista', 'Clean, minimalist cinema'],
  'studio.video.keys': ['2 · Escenario', '2 · Stage'],
  'studio.video.keysDesc': ['Teclado neón y haces de luz', 'Neon keys and spotlights'],
  'studio.video.orbit': ['3 · Club', '3 · Club'],
  'studio.video.orbitDesc': ['Luces de concierto y efecto RGB', 'Concert lights and RGB split'],
  'studio.video.cosmos': ['4 · Videoclip', '4 · Music Video'],
  'studio.video.cosmosDesc': ['Prisma, duotono y túnel estelar', 'Prism, duotone and star tunnel'],
  'studio.video.creating': ['Generando vídeo… {percent}%', 'Making video… {percent}%'],
  'studio.video.preview': ['Vista previa del vídeo', 'Preview video'],
  'studio.video.download': ['Descargar vídeo', 'Download video'],
  'studio.video.share': ['Compartir vídeo', 'Share video'],
  'studio.video.shareTitle': ['Vídeo de ÓRBITA', 'ÓRBITA video'],
  'studio.video.shareText': ['Grabado y mezclado en ÓRBITA', 'Recorded and mixed in ÓRBITA'],
  'studio.video.shareDownload': ['La opción de compartir archivos no está disponible. Se inició la descarga.', 'File sharing is unavailable. The download has started.'],
  'studio.video.error': ['No se pudo generar el vídeo.', 'Could not make the video.'],
  'studio.video.shareError': ['No se pudo compartir el vídeo.', 'Could not share the video.'],
  'studio.video.cameraError': ['No se pudo acceder a la cámara frontal.', 'Could not access the front camera.'],
  'studio.video.cameraLive': ['Vista en directo de la cámara', 'Live camera preview'],
  'studio.video.cameraMinimize': ['Minimizar cámara', 'Minimize camera'],

  'tutorial.title': ['Conoce ÓRBITA v2', 'Get to know ÓRBITA v2'],
  'tutorial.progress': ['Paso {step} de {total}', 'Step {step} of {total}'],
  'tutorial.back': ['Atrás', 'Back'],
  'tutorial.next': ['Siguiente', 'Next'],
  'tutorial.skip': ['Saltar', 'Skip'],
  'tutorial.finish': ['¡Listo!', 'Done!'],
  'tutorial.launch': ['Iniciar tutorial guiado', 'Start guided tutorial'],
  'tutorial.restart': ['Repetir tutorial', 'Restart tutorial'],
  'tutorial.1.title': ['Toca el teclado', 'Play the keyboard'],
  'tutorial.1.body': ['Toca las siete teclas para disparar acordes o notas. Mientras mantienes una tecla, desliza el dedo en vertical para controlar el filtro, el volumen o la distorsión con el eje Y.', 'Play chords or notes on the seven keys. Hold a key and slide vertically to control the filter, volume or drive with the Y axis.'],
  'tutorial.2.title': ['Elige la tonalidad', 'Choose a key'],
  'tutorial.2.body': ['Usa las flechas para cambiar la tónica. El botón alterna entre M (mayor), m (menor) y la llave de Custom para tus propios siete grados.', 'Use the arrows to change the tonic. The mode button cycles through M (major), m (minor) and the Custom wrench for your own seven degrees.'],
  'tutorial.3.title': ['𝄞 Detecta la tonalidad', '𝄞 Detect the key'],
  'tutorial.3.body': [
    'Pulsa la Clave de Sol 𝄞, abre el micrófono y concede el permiso. Canta o toca hasta 20 segundos. El mapa de calor muestra cuánto usas cada nota, desde rojo (presencia mínima) hasta verde (dominante). Aplica la tonalidad mayor o menor estimada con un toque.',
    'Tap the treble clef 𝄞, turn on the microphone and allow access. Sing or play for up to 20 seconds. The heat map shows how often each note occurs, from red (minimal presence) to green (dominant). Apply the estimated major or minor key with one tap.'
  ],
  'tutorial.4.title': ['Progresiones populares', 'Popular progressions'],
  'tutorial.4.body': ['Elige una de las 16 progresiones con ▲ y ▼ y pulsa ▶. Los acordes suenan en octava 0. Cambia a Melodía y toca encima en la octava que elijas.', 'Choose one of 16 progressions with ▲ and ▼, then press ▶. The chords play at octave 0. Switch to Melody and play over them in any octave.'],
  'tutorial.5.title': ['Panel de control', 'Control deck'],
  'tutorial.5.body': ['Elige el sonido, un acompañamiento y la batería. Pulsa REC en el looper para grabar tras la precuenta 1-2-3-4 que marcan los cuatro LED.', 'Choose a sound, accompaniment and drum pattern. Press REC on the looper to record after the 1-2-3-4 count-in shown by the four LEDs.'],
  'tutorial.6.title': ['Banco, configuración y canciones', 'Bank, settings and songs'],
  'tutorial.6.body': ['En el engranaje eliges tus 9 favoritos entre 50 y abres CONFIG para editar Custom, cambiar el idioma o consultar la ayuda. En la carpeta guardas canciones con su bucle.', 'Use the gear to choose 9 favorites from 50 and open SETTINGS to edit Custom, change language or read the help. Save songs and their loops in the folder.'],
  'tutorial.7.title': ['Graba una maqueta', 'Record a demo'],
  'tutorial.7.body': ['Graba música y voz con el botón del micrófono. Si has cargado una pista, también podrás mezclarla como BASE. Activa la cámara frontal desde CONFIG. Al parar puedes filtrar la voz, recortar la mezcla y crear un vídeo corto 9:16.', 'Record music and vocals with the microphone button. If you loaded a track, you can also mix it with the TRACK fader. Enable the front camera in SETTINGS. Stop to filter vocals, trim the mix and create a 9:16 short video.'],

  'help.title': ['Ayuda de ÓRBITA v2', 'ÓRBITA v2 Help'],
  'help.complete': ['Tutorial y ayuda completa', 'Tutorial and full help'],
  'help.keyboard': ['Teclado y atajos', 'Keyboard and Shortcuts'],
  'help.scales': ['Tonalidad, escalas y notación', 'Keys, Scales and Notation'],
  'help.custom': ['Editar el teclado Custom', 'Editing the Custom Keyboard'],
  'help.sounds': ['Sonidos, expresión y efectos', 'Sounds, Expression and Effects'],
  'help.bank': ['Banco 50 → 9 y configuración', '50 → 9 Bank and Settings'],
  'help.accompaniment': ['Acompañamiento automático', 'Automatic Accompaniment'],
  'help.transport': ['Batería, tempo y metrónomo', 'Drums, Tempo and Metronome'],
  'help.looper': ['Bucles y pistas de audio', 'Loops and Audio Tracks'],
  'help.progressions': ['Progresiones populares', 'Popular Progressions'],
  'help.sessions': ['Sesiones y canciones', 'Sessions and Songs'],
  'help.tonality': ['Clave de Sol', 'Treble Clef Key Detector'],
  'help.studio': ['Estudio de Maqueta', 'Demo Studio'],
  'help.video': ['Crear y compartir vídeos cortos', 'Making and Sharing Short Videos'],
  'help.tutorial': ['Tutorial interactivo', 'Interactive Tutorial']
};

for (const { id, nameEs, nameEn, descEs, descEn } of CUSTOM_SCALE_PRESETS) {
  messages[`custom.presets.${id}.name`] = [nameEs, nameEn];
  messages[`custom.presets.${id}.description`] = [descEs, descEn];
}
for (const { id, nameEs, nameEn, genreEs, genreEn } of POPULAR_PROGRESSIONS) {
  messages[`progressions.${id}.name`] = [nameEs, nameEn];
  messages[`progressions.${id}.genre`] = [genreEs, genreEn];
}

export function detectSystemLang() {
  if (typeof navigator === 'undefined') return 'es';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function resolveLang(langSetting = 'auto') {
  if (langSetting === 'es' || langSetting === 'en') return langSetting;
  return detectSystemLang();
}

export function t(key, langSetting = 'auto', vars = {}) {
  if (!Object.hasOwn(messages, key)) return key;
  const translation = messages[key][resolveLang(langSetting) === 'es' ? 0 : 1];
  return translation.replace(/\{(\w+)\}/g, (placeholder, name) =>
    vars != null && Object.hasOwn(vars, name) ? String(vars[name]) : placeholder
  );
}
