import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { sendSMS } from '../services/twilio';
import { generateOTP, hashOTP, verifyOTP } from '../utils/otp';
import config from '../config';

const router = Router();

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

    const { phone, username, email } = req.body;

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
    const adminEmails = ['eliecerdepablos@gmail.com', 'elmalayaso7@gmail.com'];
    const isOwner = email && adminEmails.includes(email.toLowerCase());

    // Create user
    const user = new User({
      phone,
      username,
      email,
      password: otp, // Temporary password
      isOwner,
      isAdmin: isOwner,
      verificationCode: otpHash,
      verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    await user.save();

    // Send OTP via Twilio (in production)
    try {
      await sendSMS(phone, `Tu código de verificación TakTak es: ${otp}`);
    } catch (smsError) {
      console.log('SMS failed, using demo mode:', smsError);
    }

    res.status(201).json({
      success: true,
      message: 'Código de verificación enviado',
      // Remove in production
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Verify OTP
router.post('/verify', [
  body('phone').isMobilePhone('any'),
  body('otp').isLength({ min: 6, max: 6 })
], async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verify OTP
    const isValid = verifyOTP(otp, user.verificationCode!);
    if (!isValid || !user.verificationCodeExpires || user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
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

// Login
router.post('/login', [
  body('phone').isMobilePhone('any')
], async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    const user = await User.findOne({ phone }).select('+password');
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
      await sendSMS(phone, `Tu código de acceso TakTak es: ${otp}`);
    } catch (smsError) {
      console.log('SMS failed:', smsError);
    }

    res.json({
      success: true,
      message: 'Código enviado',
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined
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

export default router;
