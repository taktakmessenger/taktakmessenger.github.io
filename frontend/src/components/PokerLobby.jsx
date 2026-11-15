import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import PokerTakLogo from './PokerTakLogo';
import PokerTable from './PokerTable';
import { formatCoins } from '../lib/pokerUi';

// Vestíbulo de POKERTAK: la pantalla propia del juego, sin tener que entrar por
// un directo.
//
// La mesa vive en la sala de un creator (el anfitrión reparte), así que el
// vestíbulo enseña las salas públicas abiertas y, al elegir una, se entra a su
// mesa. Arriba van los torneos programados que el administrador haya creado: al
// abrir un torneo se entra a la mesa de su sala, que es donde se juega.
export default function PokerLobby({ onBack }) {
  const [tables, setTables] = useState([]);
  const [events, setEvents] = useState([]);
  const [practice, setPractice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSlug, setOpenSlug] = useState(null);
  // Mesa de prácticas: se abre con `practice` en vez de un slug. Es una mesa de
  // la casa contra bots, sin monedero, para aprender sin arriesgar monedas.
  const [practiceOpen, setPracticeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, e] = await Promise.all([
        api.get('/poker/tables'),
        api.get('/poker/events').catch(() => ({ data: { events: [] } })),
      ]);
      setTables(t.data.tables || []);
      setPractice(t.data.practice || null);
      setEvents(e.data.events || []);
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las mesas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Al abrir una mesa se ocupa la pantalla entera: la mesa se juega a pantalla
  // completa, como en el directo.
  if (practiceOpen) {
    return <PokerTable practice onClose={() => setPracticeOpen(false)} />;
  }
  if (openSlug) {
    return <PokerTable slug={openSlug} onClose={() => setOpenSlug(null)} />;
  }

  const openEvents = events.filter((e) => e.status === 'scheduled');

  return (
    <div className="ptak-lobby">
      <header className="ptak-lobby-head">
        {onBack && (
          <button type="button" className="ptak-btn ghost" onClick={onBack} aria-label="Volver">
            ←
          </button>
        )}
        <PokerTakLogo size={44} />
        <div className="ptak-lobby-title">
          <strong className="ptak-name">POKERTAK</strong>
          <span className="ptak-tagline">Somos la PEPA DEL QUIERO</span>
        </div>
      </header>

      {error && <p className="ptak-error" role="alert">{error}</p>}

      {openEvents.length > 0 && (
        <section className="ptak-lobby-section" aria-label="Torneos programados">
          <h3 className="ptak-lobby-h">🏆 Torneos</h3>
          <ul className="ptak-lobby-list">
            {openEvents.map((e) => (
              <li key={e.id} className="ptak-lobby-card">
                <div className="ptak-lobby-card-head">
                  <strong>{e.title}</strong>
                  <span className="ptak-tourney-when">
                    {new Date(e.scheduledAt).toLocaleString('es-ES', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="ptak-tourney-meta">
                  Entrada 🪙 {formatCoins(e.entryCost)} · {e.seatsTaken}/{e.maxPlayers} inscritos
                </p>
                <p className="ptak-tourney-prizes">
                  Premios: {(e.projectedPlaces || [])
                    .map((p) => `${p.place}º 🪙 ${formatCoins(p.amount)}`).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ptak-lobby-section" aria-label="Mesa de prácticas">
        <h3 className="ptak-lobby-h">🎓 Mesa de prácticas</h3>
        <ul className="ptak-lobby-list">
          <li className="ptak-lobby-card ptak-practice-card">
            <div className="ptak-lobby-card-head">
              <strong>Aprende a jugar</strong>
              <span className="ptak-practice-badge">Bots · sin monedas</span>
            </div>
            <p className="ptak-lobby-owner">
              Juega contra {practice?.bots ?? 3} bots con fichas de juguete. No se
              gasta ni se gana nada: es para practicar y aprender las manos.
            </p>
            <button
              type="button"
              className="ptak-btn primary"
              onClick={() => setPracticeOpen(true)}
            >
              Entrar a practicar
            </button>
          </li>
        </ul>
      </section>

      <section className="ptak-lobby-section" aria-label="Mesas abiertas">
        <h3 className="ptak-lobby-h">♠️ Mesas abiertas</h3>
        {loading ? (
          <p className="ptak-lobby-empty">Cargando mesas…</p>
        ) : tables.length === 0 ? (
          <p className="ptak-lobby-empty">
            Todavía no hay mesas abiertas. Crea un creator público y su sala será una mesa de
            POKERTAK.
          </p>
        ) : (
          <ul className="ptak-lobby-list">
            {tables.map((t) => (
              <li key={t.slug} className="ptak-lobby-card">
                <div className="ptak-lobby-card-head">
                  <strong>{t.name}</strong>
                  {t.mine && <span className="ptak-lobby-mine">Tu mesa</span>}
                </div>
                <p className="ptak-lobby-owner">
                  Anfitrión: @{t.owner?.username || '—'} · 👥 {t.members}
                </p>
                <button
                  type="button"
                  className="ptak-btn primary"
                  onClick={() => setOpenSlug(t.slug)}
                >
                  Sentarse en la mesa
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
