import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  MAX_PHOTOS,
  categoryLabel,
  conditionLabel,
  formatPrice,
  relativeTime,
  canManageListing,
} from '../lib/market';

function initials(person) {
  const name = person?.displayName || person?.username || '?';
  return name.slice(0, 2).toUpperCase();
}

function Avatar({ user, size = 36 }) {
  const src = user?.avatar;
  return (
    <span className="wall-avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : initials(user)}
    </span>
  );
}

// Tarjeta de la cuadrícula. Muestra la primera foto como portada.
function ListingCard({ listing, onOpen }) {
  const cover = listing.photos?.[0];
  return (
    <button type="button" className="market-card" onClick={() => onOpen(listing)}>
      <div className="market-card-media">
        {cover ? (
          <img src={cover.url} alt={listing.title} loading="lazy" />
        ) : (
          <span className="market-card-placeholder" aria-hidden="true">🛍️</span>
        )}
        {listing.status === 'sold' && <span className="market-card-sold">Vendido</span>}
      </div>
      <div className="market-card-body">
        <span className="market-card-price">{formatPrice(listing.price)}</span>
        <span className="market-card-title">{listing.title}</span>
        <span className="market-card-meta">
          {categoryLabel(listing.category)}
          {listing.location ? ` · ${listing.location}` : ''}
        </span>
      </div>
    </button>
  );
}

// Detalle de un anuncio, en una capa superpuesta. No hay pantalla propia: el
// anuncio se ve encima de la cuadrícula y se cierra sin perder el scroll.
function ListingDetail({ listingId, currentUser, onClose, onMessage, onChanged }) {
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/listings/${listingId}`)
      .then(({ data }) => active && setListing(data))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [listingId]);

  const isSeller = currentUser && listing?.seller?._id === (currentUser.id || currentUser._id);
  const canManage = canManageListing(currentUser, listing);

  async function toggleSold() {
    if (!listing) return;
    setBusy(true);
    setError('');
    try {
      const next = listing.status === 'sold' ? 'active' : 'sold';
      const { data } = await api.patch(`/listings/${listing._id}/status`, { status: next });
      setListing((prev) => ({ ...prev, status: data.status }));
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!listing) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/listings/${listing._id}`);
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="market-overlay" role="dialog" aria-label="Detalle del anuncio">
      <div className="market-sheet">
        <button type="button" className="market-sheet-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>

        {loading ? (
          <p className="muted">Cargando anuncio…</p>
        ) : !listing ? (
          <p className="wall-error">{error || 'Anuncio no encontrado'}</p>
        ) : (
          <>
            {listing.photos?.length > 0 && (
              <div className="market-gallery">
                {listing.photos.map((photo) => (
                  <img key={photo.url} src={photo.url} alt={photo.name} loading="lazy" />
                ))}
              </div>
            )}

            <h2 className="market-detail-title">{listing.title}</h2>
            <p className="market-detail-price">{formatPrice(listing.price)}</p>

            <div className="market-detail-tags">
              <span>{categoryLabel(listing.category)}</span>
              <span>{conditionLabel(listing.condition)}</span>
              {listing.location && <span>📍 {listing.location}</span>}
              {listing.status === 'sold' && <span className="market-sold-tag">Vendido</span>}
            </div>

            {listing.description && <p className="market-detail-desc">{listing.description}</p>}

            <div className="market-seller">
              <Avatar user={listing.seller} />
              <span>
                <strong>@{listing.seller?.username}</strong>
                <small>Publicado {relativeTime(listing.createdAt)} · {listing.views} visitas</small>
              </span>
            </div>

            {error && <p className="wall-error">{error}</p>}

            <div className="market-detail-actions">
              {currentUser && !isSeller && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onMessage?.(listing.seller)}
                >
                  💬 Escribir al vendedor
                </button>
              )}
              {!currentUser && (
                <p className="muted">Entra en tu cuenta para escribir al vendedor.</p>
              )}
              {canManage && (
                <>
                  <button type="button" className="btn-secondary" onClick={toggleSold} disabled={busy}>
                    {listing.status === 'sold' ? 'Volver a poner a la venta' : 'Marcar como vendido'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={remove} disabled={busy}>
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Formulario de publicación. Sube las fotos al elegirlas (igual que en Facetak)
// para ver la vista previa y para que publicar no dependa de una subida lenta.
function ListingComposer({ onClose, onCreated }) {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    category: 'otros',
    condition: 'usado',
    location: '',
  });
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function pickFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length === 0) return;

    setError('');
    setUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        const { data } = await api.post('/listings/photos', body);
        setPhotos((prev) => (prev.length >= 8 ? prev : [...prev, data.photo]));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setError('');
    setSending(true);
    try {
      const { data } = await api.post('/listings', {
        title: form.title.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        category: form.category,
        condition: form.condition,
        location: form.location.trim(),
        photos,
      });
      onCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="market-overlay" role="dialog" aria-label="Publicar anuncio">
      <div className="market-sheet">
        <button type="button" className="market-sheet-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <h2 className="market-detail-title">Publicar en Marketak</h2>

        <form className="market-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Título del anuncio"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            maxLength={100}
            required
            aria-label="Título"
          />
          <textarea
            placeholder="Describe el artículo: estado, detalles, qué incluye…"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            maxLength={2000}
            rows={3}
            aria-label="Descripción"
          />

          <div className="market-form-row">
            <label className="market-field">
              <span>Precio (TTC)</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={form.price}
                onChange={(e) => update('price', e.target.value)}
                required
              />
            </label>
            <label className="market-field">
              <span>Categoría</span>
              <select value={form.category} onChange={(e) => update('category', e.target.value)}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="market-field">
              <span>Estado</span>
              <select value={form.condition} onChange={(e) => update('condition', e.target.value)}>
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <input
            type="text"
            placeholder="Zona (opcional, por ejemplo «Centro»)"
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
            maxLength={80}
            aria-label="Zona"
          />

          {photos.length > 0 && (
            <div className="market-photo-strip">
              {photos.map((photo) => (
                <div key={photo.url} className="market-photo">
                  <img src={photo.url} alt={photo.name} />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => prev.filter((p) => p.url !== photo.url))}
                    aria-label="Quitar foto"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="wall-error">{error}</p>}

          <div className="market-form-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={pickFiles}
              hidden
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || photos.length >= MAX_PHOTOS}
            >
              {uploading ? 'Subiendo…' : `📷 Fotos (${photos.length}/8)`}
            </button>
            <button type="submit" className="btn-primary" disabled={sending || uploading || !form.title.trim()}>
              {sending ? 'Publicando…' : 'Publicar anuncio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Marketak: el mercado de segunda mano dentro de Facetak. Precios en TTC y el
// trato se cierra por WhaTaka, que es donde la app ya habla en privado.
export default function Marketak({ onMessage }) {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (category) params.category = category;
      if (query.trim()) params.q = query.trim();
      const { data } = await api.get('/listings', { params });
      setListings(data.listings);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const params = { cursor };
      if (category) params.category = category;
      if (query.trim()) params.q = query.trim();
      const { data } = await api.get('/listings', { params });
      setListings((prev) => [...prev, ...data.listings]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="market">
      <div className="market-toolbar">
        <input
          type="search"
          className="market-search"
          placeholder="Buscar en Marketak…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={60}
          aria-label="Buscar en Marketak"
        />
        {user && (
          <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
            ＋ Vender
          </button>
        )}
      </div>

      <div className="market-categories" role="tablist" aria-label="Categorías">
        <button
          type="button"
          role="tab"
          aria-selected={category === ''}
          className={`market-chip ${category === '' ? 'active' : ''}`}
          onClick={() => setCategory('')}
        >
          Todo
        </button>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={category === value}
            className={`market-chip ${category === value ? 'active' : ''}`}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="wall-error">{error}</p>}

      {loading ? (
        <p className="muted">Cargando Marketak…</p>
      ) : listings.length === 0 ? (
        <p className="muted">No hay anuncios todavía. Sé el primero en vender algo.</p>
      ) : (
        <div className="market-grid">
          {listings.map((listing) => (
            <ListingCard key={listing._id} listing={listing} onOpen={(l) => setOpenId(l._id)} />
          ))}
        </div>
      )}

      {cursor && (
        <button type="button" className="btn-secondary market-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Cargando…' : 'Ver más'}
        </button>
      )}

      {openId && (
        <ListingDetail
          listingId={openId}
          currentUser={user}
          onClose={() => setOpenId(null)}
          onMessage={onMessage}
          onChanged={load}
        />
      )}

      {composing && (
        <ListingComposer
          onClose={() => setComposing(false)}
          onCreated={(listing) => {
            setComposing(false);
            setListings((prev) => [listing, ...prev]);
          }}
        />
      )}
    </div>
  );
}
