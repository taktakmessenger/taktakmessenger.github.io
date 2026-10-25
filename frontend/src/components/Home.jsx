import { useState } from 'react';
import Feed from './Feed';
import Wall from './Wall';

// Inicio reúne las dos caras públicas de TAK TAK en un mismo sitio: el feed
// vertical de vídeos (lo primero, como en TikTok) y las publicaciones de Facetak.
//
// El selector flota sobre el vídeo en vez de empujarlo hacia abajo: el reel
// está medido para ocupar la pantalla entera y restarle altura lo descuadraría.
// Es el mismo recurso que usa TikTok con su "Para ti / Siguiendo".
//
// El feed no se desmonta al pasar a Publicaciones: se oculta y se pausa. Así el
// vídeo no se queda sonando por detrás y, al volver, cada uno está donde lo
// dejó en vez de recargarse desde arriba.
export default function Home(props) {
  const [tab, setTab] = useState('videos');
  const showingPosts = tab === 'posts';

  return (
    <div className="home">
      <div className="home-switch" role="tablist" aria-label="Contenido de Inicio">
        <button
          type="button"
          role="tab"
          aria-selected={!showingPosts}
          className={`home-switch-btn ${!showingPosts ? 'active' : ''}`}
          onClick={() => setTab('videos')}
        >
          Vídeos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showingPosts}
          className={`home-switch-btn ${showingPosts ? 'active' : ''}`}
          onClick={() => setTab('posts')}
        >
          Publicaciones
        </button>
      </div>

      <div className="home-pane" hidden={showingPosts}>
        <Feed {...props} paused={showingPosts} />
      </div>

      {showingPosts && (
        <div className="home-pane home-pane-posts">
          <Wall embedded onOpenProfile={props.onOpenProfile} onMessage={props.onMessage} />
        </div>
      )}
    </div>
  );
}
