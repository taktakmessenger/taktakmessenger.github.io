import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { sendSMS } from '../services/twilio.js';
import { sendEmail } from '../services/email.js';
import { generateOTP, hashOTP, verifyOTP } from '../utils/otp.js';
import config from '../config/index.js';

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Multer config for avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `avatar-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Register with phone number
router.post('/register', [
  body('phone').isMobilePhone('any'),
  body('username').isLength({ min: 3, max: 30 }).trim()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Age verification (min 13 years)
    const { phone, username, email, dob, legalAccepted, privacyAccepted, referredByCode } = req.body;
    
    if (!dob || !legalAccepted || !privacyAccepted) {
      return res.status(400).json({ error: 'Fecha de nacimiento y aceptación legal son obligatorias' });
    }

    const birthDate = new Date(dob);
    const age = new Date().getFullYear() - birthDate.getFullYear();
    if (age < 18) {
      return res.status(400).json({ error: 'Debes tener al menos 18 años para registrarte' });
    }

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ phone }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El usuario o teléfono ya existe' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);

    // Check if admin
    const adminEmails = ['eliecerdepablos@gmail.com', 'elmalayaso7@gmail.com', 'taktak.massenger@gmail.com'];
    const isOwner = email && adminEmails.includes(email.toLowerCase());

    // Check if referrer exists
    let referredBy = undefined;
    if (referredByCode) {
      const referrer = await User.findOne({ referralCode: referredByCode });
      if (referrer) referredBy = referrer._id;
    }

    // Generate my own referralCode
    const uid = Math.random().toString(36).substring(2, 8).toUpperCase() + Math.floor(Math.random() * 1000).toString();
    const myReferralCode = `${username.substring(0, 3).toUpperCase()}-${uid}`;

    // Create user
    const user = new User({
      phone,
      username,
      email,
      password: otp, // Temporary password
      isOwner,
      isAdmin: isOwner,
      dateOfBirth: birthDate,
      legalAgreementAccepted: legalAccepted,
      privacyPolicyAccepted: privacyAccepted,
      referralCode: myReferralCode,
      referredBy,
      verificationCode: otpHash,
      verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      // Asignar automáticamente la frase de seguridad de 12 palabras a los administradores
      recoveryPhraseHash: isOwner ? '$2a$10$667cHWtTWIHIyl5r5Tg18.MVRA7ww5yKRMNHSLx2vkUQeKEj8W4d6' : undefined
    });

    await user.save();

    // Send OTP via Twilio or Email
    try {
      if (email) {
        await sendEmail(email, 'Tu código de verificación TakTak', `Tu código de verificación TakTak es: ${otp}`);
      }
      await sendSMS(phone, `Tu código de verificación TakTak es: ${otp}`);
    } catch (smsError) {
      console.log('Notification failed, using demo mode:', smsError);
    }

    res.status(201).json({
      success: true,
      message: 'Código de verificación enviado',
      debugOtp: (process.env.NODE_ENV === 'development' || isOwner) ? otp : undefined
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Verify OTP
router.post('/verify', [
  body('identifier').optional(),
  body('phone').optional(),
  body('otp').isLength({ min: 6, max: 6 })
], async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.phone;
    const { otp } = req.body;

    const lowerId = identifier ? identifier.toString().toLowerCase().trim() : '';

    const user = await User.findOne({ 
      $or: [
        { phone: identifier },
        { email: lowerId }
      ]
    });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verify OTP
    const isValid = verifyOTP(otp, user.verificationCode!);
    if (!isValid || !user.verificationCodeExpires || user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    // Reward referrer if this is first verification
    if (!user.isVerified && user.referredBy) {
      const referrer = await User.findById(user.referredBy);
      if (referrer) {
        referrer.minedCoins += 100; // Reward: 100 TTC-R = $1.00 USD
        await referrer.save();
      }
    }

    // Update user
    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    // Generate tokens
    const token = jwt.sign(
      { userId: user._id },
      config.jwt.secret as string,
      { expiresIn: config.jwt.expiresIn as any }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        avatar: user.avatar,
        isVerified: user.isVerified,
        isOwner: user.isOwner,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Error al verificar' });
  }
});

// Login with password
router.post('/login-password', [
  body('identifier').notEmpty(),
  body('password').notEmpty()
], async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;
    const lowerId = identifier ? identifier.toString().toLowerCase().trim() : '';

    const user = await User.findOne({ 
      $or: [
        { phone: identifier },
        { email: lowerId }
      ]
    }).select('+password');
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    console.log(`[Login-Password] Intentando login para: ${identifier}`);
    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    if (!user.isVerified) {
      return res.status(400).json({ error: 'Usuario no verificado' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      config.jwt.secret as string,
      { expiresIn: config.jwt.expiresIn as any }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        avatar: user.avatar,
        isVerified: user.isVerified,
        isOwner: user.isOwner,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Login-password error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Login
router.post('/login', [
  body('identifier').optional(),
  body('phone').optional()
], async (req: Request, res: Response) => {
  try {
    const identifier = req.body.identifier || req.body.phone;
    
    if (!identifier) {
      return res.status(400).json({ error: 'Identificador (teléfono o correo) requerido' });
    }

    const lowerId = identifier.toString().toLowerCase().trim();

    const user = await User.findOne({ 
      $or: [
        { phone: identifier },
        { email: lowerId }
      ]
    }).select('+password');
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!user.isVerified) {
      return res.status(400).json({ error: 'Usuario no verificado' });
    }

    // Generate new OTP for login
    const otp = generateOTP();
    user.verificationCode = hashOTP(otp);
    user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    // Send OTP
    try {
      const contact = user.phone || user.email;
      if (user.phone) {
        await sendSMS(user.phone, `Tu código de acceso TakTak es: ${otp}`);
      }
      if (user.email) {
        await sendEmail(user.email, 'Tu código de acceso TakTak', `Tu código de acceso TakTak es: ${otp}`);
      }
    } catch (smsError) {
      console.log('SMS failed:', smsError);
    }

    res.json({
      success: true,
      message: 'Código enviado',
      debugOtp: (process.env.NODE_ENV === 'development' || user.isOwner) ? otp : undefined
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// Update profile
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.username = req.body.username || user.username;
    if (req.body.dob) user.dateOfBirth = new Date(req.body.dob);
    if (req.body.legalAccepted !== undefined) user.legalAgreementAccepted = req.body.legalAccepted;
    if (req.body.privacyAccepted !== undefined) user.privacyPolicyAccepted = req.body.privacyAccepted;

    await user.save();
    res.json({ success: true, user });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// Setup security
router.post('/security-setup', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { recoveryPhrase, securityQuestion, securityAnswer } = req.body;

    if (!recoveryPhrase || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ error: 'Faltan datos de seguridad requeridos' });
    }

    const bcrypt = await import('bcryptjs');
    const salt = await bcrypt.default.genSalt(10);
    user.recoveryPhraseHash = await bcrypt.default.hash(recoveryPhrase, salt);
    user.securityQuestion = securityQuestion;
    user.securityAnswer = await bcrypt.default.hash(securityAnswer.toLowerCase().trim(), salt);

    await user.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Security setup error:', error);
    res.status(500).json({ error: 'Error al configurar seguridad' });
  }
});

// Update profile photo
router.post('/avatar', authMiddleware, uploadAvatar.single('avatar'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    
    const userId = req.user?.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Update user avatar with relative URL
    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await user.save();

    res.json({ success: true, avatar: user.avatar });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Error al subir avatar' });
  }
});

// Recover account
router.post('/recover', async (req: Request, res: Response) => {
  try {
    const { identifier, recoveryPhrase, securityAnswer } = req.body;
    
    if (!identifier) {
      return res.status(400).json({ error: 'Identificador requerido' });
    }
    
    if (!recoveryPhrase && !securityAnswer) {
      return res.status(400).json({ error: 'Se requiere la frase de recuperación o la respuesta secreta' });
    }

    const lowerId = identifier.toString().toLowerCase().trim();
    
    const user = await User.findOne({ 
      $or: [
        { phone: identifier },
        { email: lowerId }
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const bcrypt = await import('bcryptjs');
    let isValid = false;

    if (recoveryPhrase) {
      if (!user.recoveryPhraseHash) {
        return res.status(400).json({ error: 'Este usuario no tiene configurada frase de recuperación' });
      }
      isValid = await bcrypt.default.compare(recoveryPhrase, user.recoveryPhraseHash);
      if (!isValid && !securityAnswer) {
        return res.status(400).json({ error: 'Frase de recuperación incorrecta' });
      }
    }

    if (securityAnswer) {
      if (!user.securityAnswer) {
        return res.status(400).json({ error: 'Este usuario no tiene configurada pregunta de seguridad' });
      }
      const isAnswerValid = await bcrypt.default.compare(securityAnswer.toLowerCase().trim(), user.securityAnswer);
      if (!isAnswerValid) {
        return res.status(400).json({ error: 'Respuesta de seguridad incorrecta' });
      }
      isValid = true; // If answer is valid, allow recovery
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Credenciales de recuperación incorrectas' });
    }

    // Generate token and login safely
    const token = jwt.sign({ userId: user._id }, config.jwt.secret, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        isAdmin: user.isAdmin,
        isOwner: user.isOwner,
        ttcC: (user as any).ttcC || 0,
        ttcR: (user as any).ttcR || 0,
        bmPrincipal: (user as any).bmPrincipal || 0,
        bmIncentivo: (user as any).bmIncentivo || 0,
        miningPoints: (user as any).miningPoints || 0,
        referralCode: user.referralCode,
        incentiveLevel: (user as any).incentiveLevel
      }
    });

  } catch (error) {
    console.error('Recover error:', error);
    res.status(500).json({ error: 'Error al recuperar cuenta' });
  }
});

export default router;
