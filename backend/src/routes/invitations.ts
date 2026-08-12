import { Router } from 'express';

import { getInvitationDetails, getInvitationSebConfig } from '../controllers/invitation.js';

const router = Router();

router.get('/:token', getInvitationDetails);
router.get('/:token/seb-config', getInvitationSebConfig);

export default router;
