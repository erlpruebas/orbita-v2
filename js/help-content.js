/** Secciones de ayuda con la misma estructura en ambos idiomas. */
export const HELP_CONTENT = {
  es: [
    {
      title: 'Teclado, expresión y sonido',
      topics: [
        ['Siete teclas', 'Cada tecla corresponde a un grado I–VII. En PC usa Z S X D C F V en ese orden. El LED ámbar indica Acordes y el esmeralda, Melodía.'],
        ['Eje Y y golpe de tecla', 'Mantén la tecla y desliza en vertical. El botón de eje Y cambia entre filtro (cian), volumen (esmeralda) y distorsión (ámbar). El rayo ámbar añade el golpe inicial al patrón de acompañamiento. Apágalo para usar solo el patrón.'],
        ['Sonido, octava y efectos', 'Cambia el sonido y la octava con sus flechas. Los tres LED cian del humanizador añaden variaciones de tiempo e intensidad. Los tres violetas de reverb indican la cantidad de ambiente.']
      ]
    },
    {
      title: 'Tonalidad y teclado Custom visual',
      topics: [
        ['Tónica y modo', 'Las flechas mueven la tónica por semitonos. M verde es mayor, m cian es menor y la llave ámbar activa Custom. En CONFIG puedes elegir DO RE MI o C D E.'],
        ['Siete teclas editables', 'En CONFIG, elige uno de los ocho presets para configurar todo el teclado en zigzag. En cada tecla, ▲ y ▼ suben o bajan el intervalo desde la tónica entre 0 y 11 semitonos. Alterna entre Mayor (M, esmeralda) y menor (m, cian) y usa ▶ para oír el acorde que ves en pantalla. Cada ajuste se aplica de inmediato al teclado principal. Al cambiar la tónica se transportan los siete grados.']
      ]
    },
    {
      title: '𝄞 Clave de Sol · Detector de tonalidad por estadística de notas',
      topics: [
        ['Abre el micrófono', 'Pulsa 𝄞 en la barra superior, toca Abrir micrófono y concede el permiso. Canta o toca una melodía durante unos 20 segundos. El detector mide la frecuencia de las notas y acumula su presencia por cada una de las 12 notas cromáticas a lo largo de una ventana deslizante de 20 segundos. Las muestras más antiguas salen de la ventana a medida que sigues tocando.'],
        ['Lee el mapa de calor', 'Los colores del teclado cromático muestran la presencia relativa de cada nota. Rojo indica presencia mínima, naranja presencia baja, amarillo una nota frecuente y verde una nota dominante.'],
        ['Aplica la tonalidad y escucha referencias', 'El detector da más peso a las notas frecuentes y dominantes para estimar la tonalidad mayor o menor más probable. Pulsa Aplicar para llevar la propuesta al teclado principal. Toca cualquiera de las doce teclas cromáticas para oír una nota de referencia y afinar la voz.']
      ]
    },
    {
      title: 'Banco 50 → 9, ritmo y progresiones',
      topics: [
        ['Banco y pantalla OLED', 'Guarda hasta nueve favoritos de cada banco de 50 sonidos, acompañamientos y baterías. Pulsa una de sus tres casillas OLED para abrir el banco correspondiente.'],
        ['Ritmo y tempo', 'El acompañamiento 0 es Manual. Los patrones 1–9 siguen el grado que tocas. Activa la batería con ▶ y marca el tempo con toques seguidos sobre BPM. El LED cian indica que el metrónomo está habilitado para el transporte o la precuenta.'],
        ['Progresiones en voz independiente', 'Junto a II, ▲ y ▼ recorren 16 secuencias. ▶ arranca la elegida o la primera desde 0. La cuarta casilla OLED muestra su nombre y el teclado ilumina el grado activo. Los acordes de la progresión suenan en octava 0 con o sin patrón de acompañamiento y batería. Cambia a Melodía y elige una octava de −2 a +2 para tocar notas encima.']
      ]
    },
    {
      title: 'Looper y canciones guardadas',
      topics: [
        ['Precuenta 1-2-3-4', 'Pulsa REC y espera los cuatro pulsos rojos. Durante la marcha, el primer pulso es ámbar y los tres siguientes esmeralda. El contador B indica los compases y la barra OLED muestra la posición dentro del bucle.'],
        ['Reproducir y borrar', 'El botón ▶/■ reproduce o para el bucle. El LED esmeralda indica reproducción. La papelera borra el bucle.'],
        ['Sesiones con bucle', 'Abre la carpeta, escribe un nombre y guarda. La indicación «Bucle 4B», por ejemplo, confirma que se incluirá un bucle de cuatro compases. Las canciones quedan en este navegador y se pueden abrir, renombrar o borrar.']
      ]
    },
    {
      title: 'Estudio de Maqueta y filtro de micro',
      topics: [
        ['Grabar y mezclar', 'Pulsa el micrófono de la barra superior para grabar. El LED rojo y el contador indican que la captura está en marcha. Pulsa otra vez para abrir el estudio con pistas de música y voz.'],
        ['Cuatro niveles de filtro', 'En CONFIG, los LED cian indican 0 (sin filtro), 1 (poco filtro), 2 (mucho filtro) o 3 (filtro máximo). El ajuste se aplica al iniciar la siguiente maqueta.'],
        ['Editar y exportar', 'Recorta inicio y final, ajusta los dos volúmenes y compensa el desfase de la voz con SINCRO. El eco usa LED cian y el chorus, violetas. Escucha la mezcla y expórtala o compártela como MP3.']
      ]
    },
    {
      title: 'Cámara frontal y vídeo corto',
      topics: [
        ['Captura frontal', 'Activa Cámara frontal en CONFIG antes de grabar y concede el permiso al iniciar la maqueta. El botón ✕ minimiza la vista en espejo y la grabación continúa.'],
        ['Vídeo vertical 9:16', 'Ajusta el recorte y la mezcla, añade un título si quieres y pulsa Generar vídeo corto. El vídeo HD combina la mezcla con la cámara en espejo o con el visualizador OLED. Al terminar puedes previsualizarlo, descargarlo o compartirlo.']
      ]
    }
  ],
  en: [
    {
      title: 'Keyboard, expression and sound',
      topics: [
        ['Seven keys', 'Each key plays a degree from I to VII. On a computer, use Z S X D C F V in that order. Amber means Chord mode and emerald means Melody mode.'],
        ['Y axis and key strike', 'Hold a key and drag vertically. The Y-axis button cycles through filter (cyan), volume (emerald) and drive (amber). The amber lightning bolt adds an initial strike to the accompaniment pattern. Turn it off to hear the pattern alone.'],
        ['Sound, octave and effects', 'Use the arrows to change sound or octave. Three cyan humanizer LEDs show the amount of timing and velocity variation. The three violet reverb LEDs show the amount of ambience.']
      ]
    },
    {
      title: 'Key and visual Custom Keyboard',
      topics: [
        ['Tonic and mode', 'The arrows move the tonic by semitones. Green M is major, cyan m is minor and the amber wrench activates Custom. Choose DO RE MI or C D E in SETTINGS.'],
        ['Seven editable keys', 'In SETTINGS, choose one of eight presets to set up the whole zigzag keyboard. On each key, ▲ and ▼ raise or lower the interval from the tonic between 0 and 11 semitones. Toggle Major (M, emerald) or minor (m, cyan) and press ▶ to hear the displayed chord. Each edit takes effect immediately on the main keyboard. Changing the tonic transposes all seven degrees.']
      ]
    },
    {
      title: '𝄞 Treble Clef · Key detection from note statistics',
      topics: [
        ['Turn on the microphone', 'Tap 𝄞 in the top bar, turn on the microphone and allow access. Sing or play a melody for about 20 seconds. The detector measures pitch frequencies and accumulates the presence of each of the 12 chromatic notes over a rolling 20-second window. Older samples drop out of the window as you continue playing.'],
        ['Read the heat map', 'The colors on the chromatic keyboard show the relative presence of each note. Red means minimal presence, orange means low presence, yellow means frequent and green means dominant.'],
        ['Apply the key and hear reference pitches', 'The detector gives more weight to frequent and dominant notes to estimate the most likely major or minor key. Tap Apply to use the suggested key on the main keyboard. Press any of the twelve chromatic keys for a reference pitch to match with your voice.']
      ]
    },
    {
      title: '50 → 9 bank, rhythm and progressions',
      topics: [
        ['Bank and OLED display', 'Save up to nine favorites each from the 50 sounds, accompaniments and drum patterns. Press one of their three OLED labels to open its bank.'],
        ['Rhythm and tempo', 'Accompaniment 0 is Manual. Patterns 1–9 follow the degree you play. Start the drums with ▶ and tap BPM repeatedly to set the tempo. The cyan LED indicates that the metronome is enabled for transport or count-in.'],
        ['Independent progression voice', 'Beside II, ▲ and ▼ cycle through 16 sequences. ▶ plays the selected progression or starts the first one from 0. The fourth OLED cell shows its name and the keyboard lights up the current degree. The progression chords play at octave 0 with or without an accompaniment pattern and drums. Switch to Melody and choose any octave from −2 to +2 to play notes over it.']
      ]
    },
    {
      title: 'Looper and saved songs',
      topics: [
        ['1-2-3-4 count-in', 'Press REC and wait for four red beats. During playback, beat one is amber and the next three are emerald. The B counter shows the number of bars and the OLED bar shows the current loop position.'],
        ['Playback and clearing', 'The ▶/■ button plays or stops the loop. The emerald LED indicates playback. Use the trash button to clear the loop.'],
        ['Sessions with loops', 'Open the folder, enter a name and save. A label such as “4B loop” confirms that a four-bar loop will be included. Songs stay in this browser and can be opened, renamed or deleted.']
      ]
    },
    {
      title: 'Demo Studio and microphone filter',
      topics: [
        ['Record and mix', 'Press the microphone button in the top bar to record. The red LED and counter show that recording is in progress. Press it again to open the studio with music and vocal tracks.'],
        ['Four filter levels', 'In SETTINGS, cyan LEDs show the mic filter level from 0 (no filter) through 1 (light), 2 (strong) and 3 (max). The setting applies to the next demo you record.'],
        ['Edit and export', 'Trim the start and end, set both volumes and use SYNC to align the vocals. Echo uses cyan LEDs and chorus uses violet. Preview the mix and export or share it as an MP3.']
      ]
    },
    {
      title: 'Front camera and short video',
      topics: [
        ['Front camera capture', 'Enable Front Camera in SETTINGS and grant camera access when you start recording. Press ✕ to minimize the mirrored preview while recording continues.'],
        ['Vertical 9:16 video', 'Adjust the trim and mix, add a title if you like, and press Make short video. The HD video pairs the mix with mirrored camera footage or the OLED visualizer. You can preview, download or share it when it is ready.']
      ]
    }
  ]
};

export function renderHelpAccordion(container, lang) {
  const previous = Array.from(container.children, section => section.open);
  container.replaceChildren(...HELP_CONTENT[lang].map(({ title, topics }, index) => {
    const section = document.createElement('details');
    section.open = Boolean(previous[index]);
    const summary = document.createElement('summary');
    summary.textContent = title;
    const list = document.createElement('dl');
    for (const [heading, body] of topics) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = heading;
      description.textContent = body;
      list.append(term, description);
    }
    section.append(summary, list);
    return section;
  }));
}
