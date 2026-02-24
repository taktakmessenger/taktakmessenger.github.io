import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.json({ message: 'Admin API' }));
export default router;
