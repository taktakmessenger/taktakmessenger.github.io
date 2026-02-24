import { Request, Response, NextFunction } from 'express';

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new Error(`🔍 Ruta no encontrada: ${req.originalUrl}`);
  res.status(404);
  next(error);
};
