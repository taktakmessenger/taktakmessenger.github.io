/**
 * Sistema de Seguridad TakTak
 * Protección Anti-Hack y Anti-Rastreo
 */

// ============================================
// ENCRIPTACIÓN DE DATOS
// ============================================

const ENCRYPTION_KEY = 'taktak-secure-key-' + Date.now();

/**
 * Encripta datos sensibles usando XOR encryption
 */
export const encryptData = (data: string): string => {
  try {
    const keyChars = ENCRYPTION_KEY.split('').map(c => c.charCodeAt(0));
    let result = '';
    
    for (let i = 0; i < data.length; i++) {
      const charCode = data.charCodeAt(i);
      const keyChar = keyChars[i % keyChars.length];
      const encrypted = charCode ^ keyChar;
      result += encrypted.toString(16).padStart(2, '0');
    }
    
    return result;
  } catch {
    return '';
  }
};

/**
 * Desencripta datos
 */
export const decryptData = (encrypted: string): string => {
  try {
    const keyChars = ENCRYPTION_KEY.split('').map(c => c.charCodeAt(0));
    let result = '';
    
    for (let i = 0; i < encrypted.length; i += 2) {
      const hex = encrypted.substr(i, 2);
      const charCode = parseInt(hex, 16);
      const keyChar = keyChars[(i / 2) % keyChars.length];
      const decrypted = charCode ^ keyChar;
      result += String.fromCharCode(decrypted);
    }
    
    return result;
  } catch {
    return '';
  }
};

// ============================================
// OFUSCACIÓN DE DATOS
// ============================================

/**
 * Ofusca IDs de usuario para evitar tracking
 */
export const obfuscateId = (id: string): string => {
  const salt = Math.random().toString(36).substring(7);
  const combined = `${salt}:${id}:${Date.now()}`;
  return btoa(combined).replace(/=/g, '');
};

/**
 * Genera ID anónimo temporal
 */
export const generateAnonymousId = (): string => {
  return 'anon_' + Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

// ============================================
// PROTECCIÓN CONTRA XSS
// ============================================

/**
 * Sanitiza input de usuario para prevenir XSS
 */
export const sanitizeInput = (input: string): string => {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Valida URLs para prevenir open redirects
 */
export const validateUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const allowedProtocols = ['http:', 'https:'];
    const allowedDomains = ['localhost', 'taktak.app'];
    
    return allowedProtocols.includes(parsed.protocol) && 
           (allowedDomains.some(d => parsed.hostname.includes(d)) || 
            parsed.hostname === window.location.hostname);
  } catch {
    return false;
  }
};

// ============================================
// PROTECCIÓN CONTRA CSRF
// ============================================

/**
 * Genera token CSRF
 */
export const generateCSRFToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Valida token CSRF
 */
export const validateCSRFToken = (token: string, storedToken: string): boolean => {
  if (!token || !storedToken) return false;
  // Timing-safe comparison
  let result = 0;
  for (let i = 0; i < Math.max(token.length, storedToken.length); i++) {
    result |= (token.charCodeAt(i) || 0) ^ (storedToken.charCodeAt(i) || 0);
  }
  return result === 0;
};

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitEntry {
  count: number;
  timestamp: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Verifica si una acción está dentro del rate limit
 */
export const checkRateLimit = (
  identifier: string, 
  maxRequests: number = 10, 
  windowMs: number = 60000
): boolean => {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  
  if (!entry) {
    rateLimitMap.set(identifier, { count: 1, timestamp: now });
    return true;
  }
  
  if (now - entry.timestamp > windowMs) {
    rateLimitMap.set(identifier, { count: 1, timestamp: now });
    return true;
  }
  
  if (entry.count >= maxRequests) {
    return false;
  }
  
  entry.count++;
  return true;
};

// ============================================
// DETECCIÓN DE VPN/PROXY
// ============================================

/**
 * Detecta si el usuario está usando VPN/Proxy
 */
export const detectVPN = async (): Promise<boolean> => {
  try {
    // Check for WebRTC leaks
    const rtc = (window as any).RTCPeerConnection || 
                (window as any).mozRTCPeerConnection || 
                (window as any).webkitRTCPeerConnection;
    
    if (!rtc) return false;
    
    const pc = new rtc({ iceServers: [] });
    const ips = new Set<string>();
    
    pc.createDataChannel('');
    pc.createOffer().then((offer: any) => pc.setLocalDescription(offer));
    
    return new Promise((resolve) => {
      setTimeout(() => {
        pc.close();
        resolve(ips.size > 1);
      }, 1000);
    });
  } catch {
    return false;
  }
};

/**
 * Verifica timezone vs IP location (básico)
 */
export const checkTimezoneMismatch = (): boolean => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Date().getTimezoneOffset();
  
  // Store for comparison
  sessionStorage.setItem('taktak_tz', timezone);
  sessionStorage.setItem('taktak_offset', offset.toString());
  
  return false; // Would need server-side check for real detection
};

// ============================================
// ANONIMIZACIÓN
// ============================================

/**
 * Limpia metadatos de imágenes antes de subir
 */
export const stripMetadata = async (file: File): Promise<Blob> => {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        resolve(blob || file);
      }, file.type);
    };
    
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Genera fingerprint anónimo del dispositivo
 */
export const generateDeviceFingerprint = (): string => {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    !!window.sessionStorage,
    !!window.localStorage,
    navigator.hardwareConcurrency || 'unknown'
  ];
  
  return encryptData(components.join('|||')).substring(0, 32);
};

// ============================================
// SEGURIDAD DE SESIÓN
// ============================================

/**
 * Cierra sesión de forma segura
 */
export const secureLogout = (): void => {
  // Clear all storage
  localStorage.clear();
  sessionStorage.clear();
  
  // Clear cookies
  document.cookie.split(';').forEach(cookie => {
    const [name] = cookie.split('=');
    document.cookie = `${name.trim()}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  });
  
  // Reload to clear memory
  window.location.href = '/';
};

/**
 * Verifica integridad de la sesión
 */
export const verifySessionIntegrity = (): boolean => {
  const sessionStart = sessionStorage.getItem('taktak_session_start');
  if (!sessionStart) {
    sessionStorage.setItem('taktak_session_start', Date.now().toString());
    return true;
  }
  
  const sessionDuration = Date.now() - parseInt(sessionStart);
  const MAX_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  
  return sessionDuration < MAX_SESSION_DURATION;
};

// ============================================
// PROTECCIÓN CONTRA INSPECCIÓN
// ============================================

/**
 * Detecta si DevTools está abierto
 */
export const detectDevTools = (): boolean => {
  const threshold = 160;
  const widthThreshold = window.outerWidth - window.innerWidth > threshold;
  const heightThreshold = window.outerHeight - window.innerHeight > threshold;
  
  return widthThreshold || heightThreshold;
};

/**
 * Ofusca código en runtime (básico)
 */
export const runtimeObfuscation = (): void => {
  // Prevenir acceso a variables globales sensibles
  Object.defineProperty(window, '_taktak_secure', {
    value: {},
    writable: false,
    configurable: false
  });
  
  // Ofuscar console methods en producción
  if (import.meta.env.PROD) {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
    console.info = noop;
  }
};

// ============================================
// INICIALIZACIÓN DE SEGURIDAD
// ============================================

export const initializeSecurity = (): void => {
  // Generar CSRF token
  const csrfToken = generateCSRFToken();
  sessionStorage.setItem('taktak_csrf', csrfToken);
  
  // Set session start
  sessionStorage.setItem('taktak_session_start', Date.now().toString());
  
  // Generate anonymous ID
  const anonId = generateAnonymousId();
  sessionStorage.setItem('taktak_anon_id', anonId);
  
  // Apply runtime obfuscation
  runtimeObfuscation();
  
  // Check for devtools
  setInterval(() => {
    if (detectDevTools()) {
      console.clear();
      // Optional: redirect or show warning
    }
  }, 1000);
  
  console.log('🔒 TakTak Security System Initialized');
};
