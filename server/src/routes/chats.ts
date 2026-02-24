import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.json({ message: 'Chats API' }));
export default router;
