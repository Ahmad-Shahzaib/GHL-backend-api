import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';
import { ProviderTreatmentOverride } from '../models/ProviderTreatmentOverride';

const router = Router();

// GET all overrides for this location
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string || (req as any).user?.locationId || '';
  const overrides  = await ProviderTreatmentOverride.find({ locationId }).lean();
  res.json({ success: true, data: overrides });
}));

// POST create override
router.post('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string || (req as any).user?.locationId || '';
  const { provider_name, treatment_name, override_procedure_min, override_buffer_min } = req.body;

  if (!provider_name)  throw Errors.BadRequest('provider_name is required');
  if (!treatment_name) throw Errors.BadRequest('treatment_name is required');

  const override = await ProviderTreatmentOverride.findOneAndUpdate(
    { locationId, provider_name, treatment_name },
    {
      locationId,
      provider_name,
      treatment_name,
      override_procedure_min: override_procedure_min ?? null,
      override_buffer_min:    override_buffer_min    ?? null,
    },
    { upsert: true, new: true }
  ).lean();

  logger.info(`ProviderTreatmentOverride upserted: ${provider_name} / ${treatment_name}`);
  res.status(201).json({ success: true, data: override });
}));

// PUT update override
router.put('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const override = await ProviderTreatmentOverride.findByIdAndUpdate(
    req.params.id,
    { ...req.body },
    { new: true }
  ).lean();
  if (!override) throw Errors.NotFound('Override not found');
  res.json({ success: true, data: override });
}));

// DELETE override
router.delete('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  await ProviderTreatmentOverride.findByIdAndDelete(req.params.id);
  res.json({ success: true, data: null });
}));

export default router;