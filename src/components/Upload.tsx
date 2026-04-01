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
      // Step 1: Get presigned URL
      const response = await axios.post('/api/presign', 
        { filename: f.name, contentType: f.type },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { url, key } = response.data;

      // Step 2: PUT file to S3
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': f.type },
        body: f,
      });

      // Step 3: Notify backend
      await axios.post('/api/upload-complete', 
        { key, title: f.name },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Upload completo!');
    } catch (err) {
      console.error(err);
      alert('Error al subir el video.');
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
