import { useRef, useState } from 'react';
import axios from 'axios';
import { useStore } from '../store/useStore';

export default function Upload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { currentUser, isAuthenticated } = useStore();

  const token = typeof window !== 'undefined' ? window.localStorage.getItem('taktak_token') : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAuthenticated || !currentUser || !token) {
      window.alert('Debes iniciar sesión para subir vídeos.');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', file.name);

      const response = await axios.post('/api/upload', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          console.log(`📊 Progreso: ${percentCompleted}%`);
        },
      });

      if (response.data.ok) {
        window.alert('¡Vídeo subido con éxito!');
      } else {
        throw new Error('Respuesta del servidor no válida');
      }
    } catch (err: any) {
      console.error('❌ Error en el proceso de subida:', err);
      window.alert(err?.message || 'Fallo desconocido');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="upload-container">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={onFile}
        disabled={uploading}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="px-4 py-2 bg-[#FE2C55] text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
      >
        {uploading ? 'Subiendo...' : 'Subir vídeo'}
      </button>
    </div>
  );
}
