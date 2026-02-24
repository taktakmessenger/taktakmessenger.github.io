export default {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: '7d'
  },
  
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },
  
  mongodb: {
    uri: process.env.MONGODB_URI
  },
  
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 32
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 1000
  }
};
