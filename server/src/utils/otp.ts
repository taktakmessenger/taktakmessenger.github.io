import CryptoJS from 'crypto-js';

const OTP_SECRET = process.env.OTP_SECRET || 'taktak-otp-secret-key';

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const hashOTP = (otp: string): string => {
  return CryptoJS.HmacSHA256(otp, OTP_SECRET).toString();
};

export const verifyOTP = (otp: string, hash: string): boolean => {
  const newHash = CryptoJS.HmacSHA256(otp, OTP_SECRET);
  return newHash.toString() === hash;
};

export const generateEncryptionKey = (): string => {
  return CryptoJS.lib.WordArray.random(32).toString();
};

export const encryptMessage = (message: string, key: string): string => {
  return CryptoJS.AES.encrypt(message, key).toString();
};

export const decryptMessage = (encrypted: string, key: string): string => {
  const bytes = CryptoJS.AES.decrypt(encrypted, key);
  return bytes.toString(CryptoJS.enc.Utf8);
};

export default {
  generateOTP,
  hashOTP,
  verifyOTP,
  generateEncryptionKey,
  encryptMessage,
  decryptMessage
};
