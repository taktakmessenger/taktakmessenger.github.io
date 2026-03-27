import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET || 'taktak-secret-key';

    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      username: string;
      email: string;
      role: string;
    };

    req.user = decoded;

    // Check if user is banned
    const user = await User.findById(decoded.id);
    if (user && user.isBanned) {
      if (user.bannedUntil && new Date() < user.bannedUntil) {
        return res.status(403).json({ 
          error: 'Your account is temporarily suspended.',
          reason: 'Child Safety Violation or Policy Breach',
          bannedUntil: user.bannedUntil
        });
      } else {
        // Ban expired, lift it
        user.isBanned = false;
        user.bannedUntil = undefined;
        await user.save();
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const optionalAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const JWT_SECRET = process.env.JWT_SECRET || 'taktak-secret-key';
      
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: string;
        username: string;
        email: string;
        role: string;
      };
      
      req.user = decoded;
    }
  } catch (error) {
    // Token invalid but continue without auth
  }
  next();
};
