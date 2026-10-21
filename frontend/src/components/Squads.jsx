import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

// TAK Creators: la comunidad privada de un creador. Los creators públicos están
// abiertos; los privados piden el código de invitación que comparte el dueño.
export default function Squads() {
  const [squads, setSquads] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' });
  const [joinCode, setJoinCode] = useState({});
  const [active, setActive] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/squads');
      setSquads(data.squads);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/squads', form);
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private' });
      setNotice(`Creator "${data.squad.name}" creado. Tu sala de voz: ${data.squad.voiceRoom}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function join(slug) {
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/squads/${slug}/join`, {
        joinCode: joinCode[slug] || undefined,
      });
      setNotice(
        data.alreadyMember
          ? 'Ya eras miembro de este creator'
          : `Te uniste al creator. Sala de voz: ${data.voiceRoom}`
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function leave(slug) {
    setError('');
    setNotice('');
    try {
      await api.delete(`/squads/${slug}/leave`);
      setNotice('Saliste del creator');
      if (active?.slug === slug) setActive(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openFeed(slug) {
    setError('');
    try {
      const { data } = await api.get(`/squads/${slug}/feed`);
      setActive(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="squads">
      <h2>👥 TAK Creators</h2>
      <p className="muted">
        Tu comunidad privada: contenido exclusivo y sala de voz, sin depender de los
        comentarios públicos.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="wallet-actions">
        <button type="button" className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          ➕ Crear creator
        </button>
      </div>

      {showCreate && (
        <form className="squad-form" onSubmit={create}>
          <input
            type="text"
            placeholder="Nombre del creator"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            minLength={3}
            maxLength={50}
            required
          />
          <textarea
            placeholder="Descripción"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={300}
            rows={2}
          />
          <select
            value={form.visibility}
            onChange={(e) => setForm({ ...form, visibility: e.target.value })}
          >
            <option value="private">Privado (con código)</option>
            <option value="public">Público</option>
          </select>
          <button type="submit" className="btn-primary">Crear</button>
        </form>
      )}

      {squads.length === 0 ? (
        <p>Todavía no hay creators. Crea el primero.</p>
      ) : (
        <ul className="squad-list">
          {squads.map((squad) => (
            <li key={squad._id} className="squad-card">
              <div className="squad-head">
                <strong>{squad.name}</strong>
                <span className="badge">{squad.visibility === 'private' ? '🔒 Privado' : '🌐 Público'}</span>
              </div>
              {squad.description && <p>{squad.description}</p>}
              <small>por @{squad.owner?.username} · sala {squad.voiceRoom}</small>

              <div className="squad-actions">
                {squad.visibility === 'private' && (
                  <input
                    type="text"
                    placeholder="Código de invitación"
                    value={joinCode[squad.slug] || ''}
                    onChange={(e) =>
                      setJoinCode({ ...joinCode, [squad.slug]: e.target.value })
                    }
                  />
                )}
                <button type="button" className="btn-secondary" onClick={() => join(squad.slug)}>
                  Unirse
                </button>
                <button type="button" className="btn-ghost" onClick={() => openFeed(squad.slug)}>
                  Ver contenido
                </button>
                <button type="button" className="btn-ghost" onClick={() => leave(squad.slug)}>
                  Salir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <div className="squad-feed">
          <h3>Contenido de {active.squad.name}</h3>
          <p className="muted">🎙 Sala de voz activa para miembros</p>
          <ul>
            {active.members.map((member) => (
              <li key={member._id}>
                @{member.username}
                {member.profile?.displayName ? ` · ${member.profile.displayName}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
