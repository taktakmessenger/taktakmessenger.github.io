import { useCallback, useEffect, useRef, useState } from 'react';
import { useCall } from '../contexts/CallContext';
import TranslateIcon from './TranslateIcon';
import { listAudioOutputs, applySink, applyVolume } from '../lib/sound';
import { dragTo, cornerOf, cornerPosition } from '../lib/pipPosition';

// Texto del estado actual, en lenguaje llano.
const LABELS = {
  preparing: 'Preparando…',
  ringing: 'Llamando…',
  incoming: 'Llamada entrante',
  connecting: 'Conectando…',
  active: 'En llamada',
};

// Pantalla de llamada. Se pinta encima de todo lo demás porque una llamada es
// lo más urgente que puede pasar en la app: si suena, tiene que verse.
export default function CallOverlay() {
  const {
    status,
    kind,
    peer,
    error,
    notice,
    muted,
    camOff,
    minimized,
    remoteTick,
    volume,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleMinimize,
    changeVolume,
    translateLive,
    translateStatus,
    translateSpeaking,
    captions,
    toggleLiveTranslation,
    canTranslateCalls,
    // La traducción en vivo solo se ofrece en las llamadas que salen de WhaTaka.
    isWhatakaCall,
    // Si los dos hablan idiomas distintos, se ofrece la traducción de un toque.
    needsTranslation,
    peerLanguage,
    showCallCaptions,
    remoteStreamRef,
    localStreamRef,
  } = useCall();

  const remoteVideoRef = useRef(null);
  // En una llamada de voz no hay `<video>` remoto, así que el audio necesita su
  // propio elemento o la llamada conectaría en silencio: se oiría nada.
  const remoteAudioRef = useRef(null);
  const localVideoRef = useRef(null);

  // --- Cuadro propio arrastrable -------------------------------------------
  // Como en WhatsApp: el recuadro donde te ves se puede mover por la pantalla y
  // al soltarlo se pega a la esquina más cercana.
  //
  // La fuente de verdad es la ESQUINA, no los píxeles. Guardar píxeles obliga a
  // medir el área en el momento justo, y en un móvil que aún está colocando el
  // diseño esa medida todavía es provisional: el cuadro acababa anclado al
  // borde equivocado. Guardando la esquina, la posición se recalcula cuando las
  // medidas son de fiar y sigue siendo correcta al girar el móvil.
  const stageRef = useRef(null);
  const [corner, setCorner] = useState('bottom-right');
  // Posición en píxeles que se pinta. Se deriva de la esquina y de las medidas
  // reales; se guarda en estado para no medir en cada render.
  const [localPos, setLocalPos] = useState(null);
  // Datos del arrastre en curso. Van en un ref y no en estado porque cambian en
  // cada movimiento del puntero y no deben provocar un render por sí solos.
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Medidas del área y del cuadro, o `null` si aún no son fiables (elemento
  // todavía sin altura). Se exige un mínimo para no colocar el cuadro con una
  // medida a medio calcular.
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const box = localVideoRef.current;
    if (!stage || !box) return null;

    const area = { width: stage.clientWidth, height: stage.clientHeight };
    const size = { width: box.offsetWidth, height: box.offsetHeight };
    if (area.width < 40 || area.height < 40 || size.width < 10 || size.height < 10) {
      return null;
    }
    return { area, size };
  }, []);

  // Recalcula los píxeles a partir de la esquina vigente.
  const placeLocal = useCallback(
    (which = corner) => {
      const m = measure();
      if (!m) return;
      setLocalPos(cornerPosition(which, m.area, m.size));
    },
    [corner, measure]
  );

  // Al aparecer el cuadro se le da su posición. Se reintenta unos frames porque
  // el vídeo puede tardar en tener tamaño, y con una medida provisional el
  // cuadro quedaría mal anclado.
  useEffect(() => {
    if (status === 'idle' || kind !== 'video' || camOff) return undefined;

    let raf;
    let tries = 0;
    const tick = () => {
      const m = measure();
      if (m) {
        setLocalPos(cornerPosition(corner, m.area, m.size));
        return;
      }
      tries += 1;
      if (tries < 30) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `corner` no entra: se lee la esquina vigente al colocar, pero un cambio de
    // esquina no debe reiniciar este bucle. Lo recoloca el efecto siguiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind, camOff, minimized, measure]);

  // Al cambiar de esquina (al soltar un arrastre) se recalcula la posición.
  useEffect(() => {
    if (status === 'idle' || kind !== 'video' || camOff) return;
    placeLocal(corner);
  }, [corner, status, kind, camOff, placeLocal]);

  // Mantiene el cuadro en su esquina al cambiar el tamaño del área: girar el
  // móvil o redimensionar la ventana.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => placeLocal());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [placeLocal, status]);

  const startDrag = useCallback(
    (event) => {
      const m = measure();
      if (!m || !localPos) return;

      // Se captura el puntero para seguir recibiendo movimientos aunque el dedo
      // salga del recuadro. Va en `try` a propósito: si el puntero ya no existe,
      // esto lanza y abortaría el arrastre entero. Capturar es una mejora, no un
      // requisito.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Sin captura el arrastre sigue funcionando dentro del recuadro.
      }
      dragRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: localPos,
        area: m.area,
        size: m.size,
        last: localPos,
      };
      setDragging(true);
    },
    [localPos, measure]
  );

  const moveDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const pointer = { x: event.clientX, y: event.clientY };
    const next = dragTo(drag.origin, drag.start, pointer, drag.area, drag.size);
    // Se guarda también en el ref: al soltar hay que pegar a la esquina desde la
    // última posición real, y leerla del estado podría dar el valor del render
    // anterior, que va un movimiento por detrás del dedo.
    drag.last = next;
    setLocalPos(next);
  }, []);

  const endDrag = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const last = drag.last || drag.origin;
      dragRef.current = null;
      setDragging(false);
      // Al soltar se pega a la esquina más cercana, como WhatsApp. Se guarda la
      // esquina, y el efecto correspondiente recalcula los píxeles con la medida
      // real del área en ese momento.
      const which = cornerOf(last, drag.area, drag.size);
      setCorner(which);
      setLocalPos(cornerPosition(which, drag.area, drag.size));
    },
    []
  );

  // Salidas de audio del dispositivo (altavoz, auricular, Bluetooth). `setSinkId`
  // no existe en todos los navegadores; si no está, la lista queda vacía y el
  // selector no se muestra en vez de ofrecer algo que no funciona.
  const [outputs, setOutputs] = useState([]);
  const [speakerOn, setSpeakerOn] = useState(true);

  useEffect(() => {
    listAudioOutputs().then(setOutputs);
  }, []);

  // Manda el audio remoto a la salida elegida. Con el altavoz activado se usa la
  // salida por defecto del sistema; al desactivarlo se intenta el auricular.
  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;

    if (speakerOn) {
      applySink(audio, '');
      return;
    }

    // El dispositivo etiquetado como altavoz/manos libres es el que queremos
    // evitar; cualquier otra salida (auricular, altavoz del teléfono) sirve.
    const earpiece = outputs.find((o) => !/speaker|altavoz|manos libres/i.test(o.label));
    if (earpiece) applySink(audio, earpiece.id);
  }, [speakerOn, outputs, remoteTick, minimized]);

  // El volumen elegido se aplica a la voz que llega. Se hace en un efecto sobre
  // los dos elementos (el `<audio>` de voz y el `<video>` remoto) porque el
  // control debe responder en pantalla completa y en la burbuja, y el elemento
  // de vídeo se vuelve a montar al cambiar entre las dos.
  //
  // Mientras el altavoz dice la traducción, la voz del otro baja a un susurro en
  // vez de callarse del todo: si se cortara, se perdería el principio de la frase
  // que el otro empieza mientras termina la traducción. La traducción suena
  // limpia por encima y la voz original queda de fondo, que es lo que hace que se
  // entienda de quién es cada cosa.
  useEffect(() => {
    const level = translateSpeaking ? volume * 0.15 : volume;
    applyVolume(remoteAudioRef.current, level);
    applyVolume(remoteVideoRef.current, level);
  }, [volume, remoteTick, status, minimized, translateSpeaking]);

  // Engancha el stream remoto cuando llega. `remoteTick` cambia con cada stream
  // nuevo, así que el efecto se vuelve a ejecutar en la reconexión. `minimized`
  // entra en las dependencias porque al cambiar entre la pantalla completa y la
  // burbuja el elemento `<video>` es otro: sin esto, la burbuja quedaría negra.
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video && remoteStreamRef.current) {
      video.srcObject = remoteStreamRef.current;
      // El vídeo remoto va SIEMPRE en silencio. La voz se reproduce en el
      // `<audio>`, que es el que lleva el control de volumen; si el `<video>`
      // también sonara, se oiría por duplicado y el control de volumen solo
      // afectaría a una de las dos copias.
      video.muted = true;
      video.play().catch(() => {});
    }

    // El audio remoto se reproduce siempre, también en videollamada: el
    // elemento de vídeo lleva el stream completo, pero separarlo permite que la
    // voz siga oyéndose aunque el vídeo esté minimizado o la cámara apagada.
    const audio = remoteAudioRef.current;
    if (audio && remoteStreamRef.current) {
      audio.srcObject = remoteStreamRef.current;
      audio.play().catch(() => {});
    }
  }, [remoteTick, status, minimized, remoteStreamRef]);

  // La vista propia se muestra en pequeño, como en cualquier app de llamadas.
  useEffect(() => {
    const video = localVideoRef.current;
    if (video && localStreamRef.current) {
      video.srcObject = localStreamRef.current;
      video.play().catch(() => {});
    }
  }, [status, kind, minimized, localStreamRef]);

  if (status === 'idle') {
    // El error de una llamada ya terminada sigue siendo útil unos segundos,
    // pero sin una llamada en curso no hay nada que superponer.
    return error ? (
      <div className="call-toast" role="status">
        {error}
      </div>
    ) : null;
  }

  const isIncoming = status === 'incoming';
  const isActive = status === 'active';

  // Burbuja flotante: la llamada sigue viva y con audio, pero se aparta a una
  // esquina para poder seguir viendo el feed. Se toca para volver a la pantalla
  // completa. Solo se ofrece con la llamada en curso: una entrante debe verse
  // entera para poder aceptarla.
  if (minimized && isActive) {
    return (
      <>
        {/* El audio remoto tiene que seguir existiendo en la burbuja. Sin él,
            una llamada de voz minimizada se quedaría muda: el elemento se
            desmontaría y con él la reproducción del stream. */}
        <audio ref={remoteAudioRef} autoPlay playsInline />
        <button
          type="button"
          className="call-bubble-pip"
          onClick={toggleMinimize}
          aria-label="Volver a la llamada"
        >
          {kind === 'video' ? (
            <video ref={remoteVideoRef} className="call-bubble-video" autoPlay playsInline muted />
          ) : (
            <span className="call-bubble-avatar">
              {peer?.username?.slice(0, 2).toUpperCase() || '??'}
            </span>
          )}
          <span className="call-bubble-meta">
            <strong>@{peer?.username || '…'}</strong>
            <small>{LABELS[status] || status}</small>
          </span>
        </button>
      </>
    );
  }

  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-stage" ref={stageRef}>
        {/* El audio remoto oyente siempre, en voz y en vídeo. Va fuera del
            bloque condicional para que exista desde el primer render de la
            llamada; si se montara y desmontara, el enganche del stream se
            perdería. */}
        <audio ref={remoteAudioRef} autoPlay playsInline />

        {kind === 'video' && isActive ? (
          <video ref={remoteVideoRef} className="call-remote" autoPlay playsInline muted />
        ) : (
          <div className="call-avatar">
            <span>{peer?.username?.slice(0, 2).toUpperCase() || '??'}</span>
          </div>
        )}

        {kind === 'video' && !camOff && (
          <video
            ref={localVideoRef}
            className={`call-local${dragging ? ' dragging' : ''}`}
            autoPlay
            playsInline
            muted
            // Arrastrable, como en WhatsApp: se mueve por la pantalla y al
            // soltarlo se pega a la esquina más cercana. El toque no se anula
            // para que el botón siga siendo alcanzable por teclado.
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={
              localPos
                ? { left: `${localPos.x}px`, top: `${localPos.y}px`, right: 'auto', bottom: 'auto' }
                : undefined
            }
          />
        )}

        <div className="call-info">
          <strong>@{peer?.username || '…'}</strong>
          <span>{LABELS[status] || status}</span>
          {error && <small className="error">{error}</small>}
          {!error && notice && <small className="notice">{notice}</small>}
        </div>

        {/* Aviso de traducción. Cuando los dos hablan idiomas distintos, se
            ofrece traducir la llamada con un toque en vez de esperar a que cada
            uno encuentre el botón. Es lo que hace usable la función: quien
            recibe una llamada en un idioma que no habla necesita saber que puede
            entenderla, y saberlo en ese momento, no después. */}
        {isWhatakaCall && needsTranslation && !translateLive && status !== 'incoming' && (
          <div className="call-translate-prompt">
            <span>
              Habla otro idioma. ¿Traducir la llamada?
            </span>
            <button
              type="button"
              className="call-translate-accept"
              onClick={toggleLiveTranslation}
              disabled={!canTranslateCalls}
              title={
                canTranslateCalls
                  ? 'Traducir la llamada en vivo'
                  : 'Tu navegador no permite traducir llamadas'
              }
            >
              <TranslateIcon size={16} active />
              Traducir
            </button>
          </div>
        )}

        {/* Subtítulos de la traducción en vivo. Se enseñan las dos versiones:
            el original, para poder comprobar qué se dijo de verdad, y la
            traducción, que es lo que se está oyendo por el altavoz. Solo la
            traducción sería una versión de lo dicho sin forma de verificarla. */}
        {translateLive && showCallCaptions && captions && (
          <div className="call-captions" role="status" aria-live="polite">
            <span className="call-caption-original">{captions.original}</span>
            {captions.translated && (
              <span className="call-caption-translated">{captions.translated}</span>
            )}
          </div>
        )}

        {/* Control de volumen de la voz que se oye. Existe porque en una llamada
            por navegador el sonido remoto es un MediaStream y en varios móviles
            los botones del teléfono no lo alcanzan: sin este control, la única
            forma de bajar el volumen sería colgar. Solo con la llamada en curso;
            durante el timbrado no hay voz que regular. */}
        {isActive && (
          <div className="call-volume">
            <span aria-hidden="true">{volume === 0 ? '🔇' : '🔊'}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => changeVolume(e.target.value)}
              aria-label="Volumen de la llamada"
            />
          </div>
        )}
      </div>

      <div className="call-actions">
        {isIncoming ? (
          <>
            <button type="button" className="call-btn accept" onClick={acceptCall}>
              ✅ Aceptar
            </button>
            <button type="button" className="call-btn end" onClick={rejectCall}>
              ❌ Rechazar
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`call-btn ${muted ? 'off' : ''}`}
              onClick={toggleMute}
              aria-pressed={muted}
            >
              {muted ? '🔇' : '🎤'}
            </button>

            {kind === 'video' && (
              <button
                type="button"
                className={`call-btn ${camOff ? 'off' : ''}`}
                onClick={toggleCamera}
                aria-pressed={camOff}
              >
                {camOff ? '📷' : '🎥'}
              </button>
            )}

            {/* Altavoz del teléfono. Solo aparece si el navegador soporta elegir
                la salida (setSinkId); si no, no hay nada que ofrecer. */}
            {outputs.length > 0 && (
              <button
                type="button"
                className={`call-btn ${speakerOn ? '' : 'off'}`}
                onClick={() => setSpeakerOn((on) => !on)}
                aria-pressed={speakerOn}
                aria-label={speakerOn ? 'Desactivar altavoz' : 'Activar altavoz'}
              >
                {speakerOn ? '🔊' : '📞'}
              </button>
            )}

            {/* Traducir la llamada en vivo. Solo en las llamadas que nacieron en
                WhaTaka: la función es del chat, y ofrecerla en una llamada que
                salió del feed prometería algo que nadie pidió. Además, solo con
                la llamada en curso (no durante el timbrado, no hay voz que
                traducir) y solo si el navegador puede oír y hablar; si no, se
                desactiva con su motivo en el `title` en vez de ofrecer un botón
                que no hace nada. */}
            {isActive && isWhatakaCall && (
              <button
                type="button"
                className={`call-btn ${translateLive ? 'on' : ''}`}
                onClick={toggleLiveTranslation}
                disabled={!canTranslateCalls}
                aria-pressed={translateLive}
                title={
                  canTranslateCalls
                    ? 'Traducir la llamada en vivo'
                    : 'Tu navegador no permite traducir llamadas'
                }
                aria-label="Traducir la llamada en vivo"
              >
                <TranslateIcon size={20} active={translateLive} />
                {translateStatus === 'listening' && <span className="call-btn-dot" />}
              </button>
            )}

            {/* Minimizar solo con la llamada en curso: durante el timbrado el
                usuario necesita ver a quién llama y poder colgar. */}
            {isActive && (
              <button
                type="button"
                className="call-btn"
                onClick={toggleMinimize}
                aria-label="Minimizar llamada"
              >
                🔽
              </button>
            )}

            <button type="button" className="call-btn end" onClick={hangUp}>
              📵 Colgar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
