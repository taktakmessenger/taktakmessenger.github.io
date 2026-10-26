// Botón de traducir de una burbuja del chat.
//
// El icono de dos rostros va pegado a la burbuja, no escondido en un menú: es la
// función que hace posible hablar con alguien que no comparte tu idioma, y
// esconderla tras un "mantener pulsado" haría que nadie la encontrara.
//
// Al pulsarlo, la traducción aparece DEBAJO del texto original, no lo sustituye.
// Eso es deliberado: quien recibe un mensaje traducido necesita poder ver lo que
// decía de verdad, sobre todo cuando la traducción de una frase hecha suena rara.
// Sustituir el original es lo que hace que la gente desconfíe de la traducción.

import { useEffect, useState } from 'react';
import TranslateIcon from './TranslateIcon';
import { translateText, cachedTranslation } from '../lib/translateClient';
import { languageName, shouldTranslate } from '../lib/translate';

export default function TranslateButton({ text, target, hint = null, compact = false, auto = false, ready = true }) {
  const [result, setResult] = useState(() => cachedTranslation({ text, target }));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const hasText = Boolean(text && String(text).trim());

  // Traducción automática del hilo: si está encendida, cada mensaje del otro se
  // traduce solo. Se respeta el atajo de `shouldTranslate` para no gastar una
  // llamada al proveedor en frases que ya están en mi idioma ("ok", "jaja"), que
  // en un chat son muchas.
  //
  // `ready` es la señal de que el lote del hilo ya terminó y dejó las
  // traducciones en la caché. Mientras esté en falso, la burbuja espera en vez
  // de lanzar su propia petición: si no, veinte burbujas ya montadas pedirían
  // veinte traducciones justo cuando se enciende el interruptor.
  useEffect(() => {
    if (!auto || !hasText) return undefined;
    if (!ready) return undefined;

    // La caché se mira aquí, no solo al montar: el lote llega después de que las
    // burbujas ya existan, y tienen que recoger su traducción cuando avise.
    const cached = result || cachedTranslation({ text, target });
    if (cached) {
      if (!result) setResult(cached);
      setOpen(true);
      return undefined;
    }
    if (!shouldTranslate({ text, target, hint })) return undefined;

    let active = true;
    setBusy(true);
    translateText({ text, to: target, hint })
      .then((translated) => {
        if (!active) return;
        if (translated.error) {
          setError(translated.error);
          return;
        }
        setResult(translated);
        setOpen(true);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // `result` no va en las dependencias a propósito: este efecto solo debe
    // dispararse al montar la burbuja, al encender la traducción o cuando el
    // lote avisa, no cada vez que llega una traducción (que volvería a pedirla).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, hasText, text, target, hint]);

  // Sin texto que traducir (un adjunto sin pie, por ejemplo) no hay botón.
  if (!hasText) return null;

  async function toggle() {
    // Si ya está traducido, el botón pliega y despliega en vez de volver a pedir.
    if (result) {
      setOpen((prev) => !prev);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const translated = await translateText({ text, to: target, hint });
      if (translated.error) {
        setError(translated.error);
        return;
      }
      setResult(translated);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const shown = result && result.translated;

  return (
    <span className={`translate-wrap ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className={`translate-btn ${open && shown ? 'active' : ''}`}
        onClick={toggle}
        disabled={busy}
        aria-expanded={open && Boolean(shown)}
        aria-label={shown ? 'Ocultar traducción' : 'Traducir mensaje'}
        title={shown ? 'Ocultar traducción' : 'Traducir'}
      >
        <TranslateIcon size={compact ? 15 : 17} active={open && Boolean(shown)} />
      </button>

      {open && shown && (
        <span className="translate-result">
          <span className="translate-text">{result.text}</span>
          {result.source && (
            <small className="translate-from">
              Traducido de {languageName(result.source) || result.source}
            </small>
          )}
        </span>
      )}

      {/* Cuando no se pudo traducir se dice, en vez de no hacer nada: un botón
          que no responde se lee como que la app está rota. */}
      {open && error && (
        <span className="translate-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
