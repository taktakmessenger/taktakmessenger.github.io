import React, { useRef, useState, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';

export default function Upload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { token } = useContext(AuthContext);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!token) return alert('Debes iniciar sesión para subir vídeos.');

    setUploading(true);
    try {
      console.log('🎞️ Iniciando subida local de:', f.name);
      
      const formData = new FormData();
      formData.append('video', f);
      formData.append('title', f.name);

      console.log('📤 Subiendo archivo al servidor VPS...');
      const response = await axios.post('/api/upload', formData, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          console.log(`📊 Progreso: ${percentCompleted}%`);
        }
      });

      if (response.data.ok) {
        console.log('✅ Archivo subido con éxito al VPS');
        alert('¡Vídeo subido con éxito!');
      } else {
        throw new Error('Respuesta del servidor no válida');
      }
    } catch (err: any) {
      console.error('❌ Error en el proceso de subida:', err);
      alert(`Error: ${err.message || 'Fallo desconocido'}`);
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
