import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.json({ message: 'Calls API' }));
export default router;
