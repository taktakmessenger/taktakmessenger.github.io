import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { formatCoins } from '../lib/pokerUi';

// Torneos programados de POKERTAK, para quien llega a la mesa sin asiento.
//
// Solo se enseñan los que están abiertos a inscripción y son de esta sala. Al
// tocar "Inscribirme" el servidor cobra la entrada del monedero: aquí no se
// calcula ningún importe, solo se muestra lo que el servidor ya decidió.
//
// El reparto (40/30/20 y la tarifa de la casa) lo fija el administrador al crear
// el torneo; el jugador lo ve antes de pagar, que es lo justo.

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function TournamentPanel({ slug }) {
  const [events, setEvents] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // Solo los de esta sala: la mesa no debe ofrecer torneos de otro directo.
      const { data } = await api.get('/poker/events', { params: slug ? { squad: slug } : {} });
      setEvents(data.events || []);
    } catch {
      // Sin torneos o sin red no se rompe la mesa: simplemente no se enseña nada.
      setEvents([]);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const join = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/poker/events/${id}/join`);
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo inscribir');
    } finally {
      setBusyId(null);
    }
  };

  const open = events.filter((e) => e.status === 'scheduled');
  if (open.length === 0) return null;

  return (
    <section className="ptak-tourneys" aria-label="Torneos programados">
      {error && <p className="ptak-tourneys-error" role="alert">{error}</p>}
      {open.map((e) => (
        <article key={e.id} className="ptak-tourney">
          <header className="ptak-tourney-head">
            <strong>{e.title}</strong>
            <span className="ptak-tourney-when">{formatWhen(e.scheduledAt)}</span>
          </header>
          <p className="ptak-tourney-meta">
            Entrada 🪙 {formatCoins(e.entryCost)} · {e.seatsTaken}/{e.maxPlayers} inscritos
          </p>
          <p className="ptak-tourney-prizes">
            Premios: {(e.projectedPlaces || []).map((p) => `${p.place}º 🪙 ${formatCoins(p.amount)}`).join(' · ')}
          </p>
          <button
            type="button"
            className="ptak-btn primary"
            disabled={busyId === e.id || e.seatsFree <= 0}
            onClick={() => join(e.id)}
          >
            {e.seatsFree <= 0 ? 'Torneo lleno' : `Inscribirme por 🪙 ${formatCoins(e.entryCost)}`}
          </button>
        </article>
      ))}
    </section>
  );
}
