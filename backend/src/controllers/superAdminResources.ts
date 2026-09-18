import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { getLiveResourcesSnapshot } from '../services/systemResourcesService.js';

export async function getLiveResources(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    res.json(await getLiveResourcesSnapshot());
  } catch (error) {
    console.error('Get live resources error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
