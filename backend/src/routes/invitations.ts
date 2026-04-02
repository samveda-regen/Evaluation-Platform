import { Router } from 'express';

import { getInvitationDetails } from '../controllers/invitation.js';

const router = Router();

router.get('/:token', getInvitationDetails);

export default router;
