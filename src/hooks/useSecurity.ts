import { useEffect, useCallback, useState } from 'react';
import {
  initializeSecurity,
  encryptData,
  decryptData,
  obfuscateId,
  generateAnonymousId,
  sanitizeInput,
  checkRateLimit,
  detectVPN,
  verifySessionIntegrity,
  secureLogout,
  generateDeviceFingerprint
} from '@/utils/security';

interface SecurityState {
  isSecure: boolean;
  isVPN: boolean;
  anonId: string;
  deviceFingerprint: string;
  csrfToken: string;
}

export const useSecurity = () => {
  const [securityState, setSecurityState] = useState<SecurityState>({
    isSecure: false,
    isVPN: false,
    anonId: '',
    deviceFingerprint: '',
    csrfToken: ''
  });

  // Initialize security on mount
  useEffect(() => {
    const init = async () => {
      initializeSecurity();
      
      const anonId = sessionStorage.getItem('taktak_anon_id') || generateAnonymousId();
      const csrfToken = sessionStorage.getItem('taktak_csrf') || '';
      const fingerprint = generateDeviceFingerprint();
      
      // Check for VPN
      const isVPN = await detectVPN();
      
      setSecurityState({
        isSecure: verifySessionIntegrity(),
        isVPN,
        anonId,
        deviceFingerprint: fingerprint,
        csrfToken
      });
      
      // Store for later use
      sessionStorage.setItem('taktak_anon_id', anonId);
    };
    
    init();
  }, []);

  /**
   * Encrypt sensitive data
   */
  const secureEncrypt = useCallback((data: string): string => {
    return encryptData(data);
  }, []);

  /**
   * Decrypt data
   */
  const secureDecrypt = useCallback((encrypted: string): string => {
    return decryptData(encrypted);
  }, []);

  /**
   * Sanitize user input
   */
  const secureInput = useCallback((input: string): string => {
    return sanitizeInput(input);
  }, []);

  /**
   * Check rate limit for an action
   */
  const checkActionLimit = useCallback((
    action: string,
    maxRequests: number = 10,
    windowMs: number = 60000
  ): boolean => {
    const key = `${securityState.anonId}_${action}`;
    return checkRateLimit(key, maxRequests, windowMs);
  }, [securityState.anonId]);

  /**
   * Get obfuscated user ID
   */
  const getObfuscatedId = useCallback((userId: string): string => {
    return obfuscateId(userId);
  }, []);

  /**
   * Secure logout
   */
  const logout = useCallback(() => {
    secureLogout();
  }, []);

  /**
   * Verify session is still valid
   */
  const verifySession = useCallback((): boolean => {
    return verifySessionIntegrity();
  }, []);

  /**
   * Secure API request wrapper
   */
  const secureRequest = useCallback(async <T,>(
    url: string,
    options: RequestInit = {}
  ): Promise<T | null> => {
    // Check rate limit
    if (!checkActionLimit('api_request', 30, 60000)) {
      throw new Error('Rate limit exceeded');
    }
    
    // Add security headers
    const secureOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        'X-CSRF-Token': securityState.csrfToken,
        'X-Device-Fingerprint': securityState.deviceFingerprint,
        'X-Anonymous-ID': securityState.anonId,
        'X-Request-Time': Date.now().toString()
      },
      credentials: 'same-origin'
    };
    
    try {
      const response = await fetch(url, secureOptions);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json() as T;
    } catch (error) {
      console.error('Secure request failed:', error);
      return null;
    }
  }, [securityState, checkActionLimit]);

  /**
   * Strip metadata from file before upload
   */
  const secureFileUpload = useCallback(async (file: File): Promise<Blob> => {
    // In a real implementation, this would strip EXIF data
    // For now, return the file as-is
    return file;
  }, []);

  return {
    ...securityState,
    encrypt: secureEncrypt,
    decrypt: secureDecrypt,
    sanitize: secureInput,
    checkRateLimit: checkActionLimit,
    obfuscateId: getObfuscatedId,
    logout,
    verifySession,
    secureRequest,
    secureFileUpload
  };
};
