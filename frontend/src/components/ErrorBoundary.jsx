import { Component } from 'react';

// Without a boundary, any error thrown while rendering unmounts the whole tree
// and the user sees an empty page with no hint of what happened. This shows the
// error instead, so a blank screen never happens silently.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('TAK TAK: error de render', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="centered error" role="alert">
        <div>
          <h2>Algo se rompió al cargar TAK TAK</h2>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn-primary" onClick={this.handleReload}>
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
