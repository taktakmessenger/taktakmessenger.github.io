import { useEffect } from 'react';

// Pantalla de bienvenida de TAK TAK. Es lo primero que se ve al abrir la app:
// presenta la marca (el queso con la semilla de mango dorada) y tapa el hueco
// mientras AuthContext comprueba si la sesión guardada sigue siendo válida.
//
// Quien manda en el tiempo es App: aquí solo se pinta y se aplica el fundido
// cuando `fading` llega en true, para que no se vaya antes de que la sesión
// esté lista. El mismo dibujo existe también en el HTML (ver index.html), que
// se ve al instante y evita el destello blanco del primer pintado; aquí se
// retira ese duplicado en cuanto React monta.
export default function Splash({ fading = false }) {
  useEffect(() => {
    document.getElementById('boot-splash')?.remove();
  }, []);

  return (
    <div className={`splash ${fading ? 'splash--hidden' : ''}`} aria-hidden={fading}>
      <div className="splash-top">
        <div className="splash-logo">
          <img
            src="./taktak-app-icon.png"
            alt="TakTak"
            width="96"
            height="96"
            decoding="async"
          />
        </div>

        <h1 className="splash-word">TakTak</h1>
        <p className="splash-subtitle">Vídeos cortos en vertical, minijuegos y creación con IA.</p>
      </div>

      <div className="splash-photo">
        <img
          src="./pepa-inicio.png"
          alt="Un trozo de queso con la pepa dorada"
          width="260"
          height="260"
          decoding="async"
        />
      </div>

      <p className="splash-tagline">Somos la pepa del queso</p>
    </div>
  );
}
