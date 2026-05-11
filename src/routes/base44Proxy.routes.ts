import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import axios from 'axios';

const router = Router();

const BASE44_APP_ID  = process.env.BASE44_APP_ID  || '69a7881ffc513255b74dd969';
const BASE44_API_KEY = process.env.BASE44_API_KEY  || '';
const BASE44_API_URL = 'https://api.base44.com';

/**
 * @route   POST /api/base44/invoke
 * @desc    Proxy Base44 InvokeLLM calls using API key to avoid CORS
 * @access  Public
 */
router.post(
  '/invoke',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const response = await axios.post(
        `${BASE44_API_URL}/api/apps/${BASE44_APP_ID}/integration-endpoints/Core/InvokeLLM`,
        req.body,
        {
          headers: {
            'Content-Type': 'application/json',
            'api_key': BASE44_API_KEY,
          },
          timeout: 30000,
        }
      );
      res.json(response.data);
    } catch (err: any) {
      logger.error('Base44 proxy error:', err?.response?.data || err?.message);
      res.status(err?.response?.status || 500).json(
        err?.response?.data || { error: 'Base44 request failed' }
      );
    }
  })
);

export default router;