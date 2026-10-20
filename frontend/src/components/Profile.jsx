import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [videos, setVideos] = useState([]);
  const [form, setForm] = useState({ displayName: '', bio: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      displayName: user.profile?.displayName || '',
      bio: user.profile?.bio || '',
    });

    api
      .get(`/users/${user.username}`)
      .then(({ data }) => setVideos(Array.isArray(data?.videos) ? data.videos : []))
      .catch((err) => setError(err.message));
  }, [user]);

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { data } = await api.patch('/users/me', form);
      setUser(data.user);
      setNotice('Perfil actualizado');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportVideo(video) {
    setError('');
    setNotice('');
    try {
      const { data } = await api.get(`/videos/${video._id}/export`);
      // Straight to the original file: no watermark, no re-encode.
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice(`Exportando "${data.filename}" sin marca de agua`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  return (
    <div className="profile">
      <h2>@{user.username}</h2>

      <div className="wallet-stats">
        <div className="stat-card">
          <h3>Seguidores</h3>
          <span className="amount">{user.profile?.followers?.length ?? 0}</span>
        </div>
        <div className="stat-card">
          <h3>Siguiendo</h3>
          <span className="amount">{user.profile?.following?.length ?? 0}</span>
        </div>
        <div className="stat-card">
          <h3>Likes totales</h3>
          <span className="amount">{user.stats?.totalLikes ?? 0}</span>
        </div>
      </div>

      <form className="profile-form" onSubmit={save}>
        <h3>Editar perfil</h3>
        <input
          type="text"
          placeholder="Nombre visible"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          maxLength={50}
        />
        <textarea
          placeholder="Biografía"
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          maxLength={300}
          rows={3}
        />
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>

      <div className="profile-videos">
        <h3>Mis videos ({videos.length})</h3>
        {videos.length === 0 ? (
          <p>Todavía no has subido videos.</p>
        ) : (
          <ul>
            {videos.map((v) => (
              <li key={v._id}>
                <span>{v.title}</span>
                <small>👁 {v.views} · ❤️ {v.likes}</small>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => exportVideo(v)}
                >
                  ⬇️ Exportar limpio
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
