import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta } from '../types';
import { logger } from '../utils/logger';
import { Treatment } from '../models/Treatment';

const router = Router();

// GET all treatments
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string || (req as any).user?.locationId || '';
  const category   = req.query.category as string | undefined;
  const page       = parseInt(req.query.page  as string) || 1;
  const limit      = Math.min(parseInt(req.query.limit as string) || 100, 500);

  const filter: any = { locationId };
  if (category) filter.category = category;

  const [treatments, total] = await Promise.all([
    Treatment.find(filter).skip((page - 1) * limit).limit(limit).lean(),
    Treatment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: treatments,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1, hasNextPage: page * limit < total, hasPrevPage: page > 1 } as PaginationMeta,
  });
}));

// GET single treatment
router.get('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const treatment = await Treatment.findById(req.params.id).lean();
  if (!treatment) throw Errors.NotFound('Treatment not found');
  res.json({ success: true, data: treatment });
}));

// POST create treatment
router.post('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const locationId = req.query.locationId as string || (req as any).user?.locationId || '';
  const { name, category, price, duration_minutes, required_equipment, prime_hour_eligible, room_type, provider_qualification } = req.body;

  if (!name)              throw Errors.BadRequest('Treatment name is required');
  if (!category)          throw Errors.BadRequest('Category is required');
  if (price === undefined) throw Errors.BadRequest('Price is required');
  if (!duration_minutes)  throw Errors.BadRequest('Duration is required');

  const revenue_per_hour = duration_minutes > 0 ? Math.round(price / (duration_minutes / 60)) : 0;

  const treatment = await Treatment.create({
    locationId,
    name,
    category,
    price,
    duration_minutes,
    required_equipment: required_equipment || [],
    prime_hour_eligible: prime_hour_eligible !== false,
    revenue_per_hour,
    room_type:              room_type              || '',
    provider_qualification: provider_qualification || '',
    isActive: true,
  });

  logger.info(`Treatment created: ${name} for location ${locationId}`);
  res.status(201).json({ success: true, data: treatment });
}));

// PUT update treatment
router.put('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const update = { ...req.body };
  if (update.price !== undefined && update.duration_minutes) {
    update.revenue_per_hour = Math.round(update.price / (update.duration_minutes / 60));
  }
  const treatment = await Treatment.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!treatment) throw Errors.NotFound('Treatment not found');
  res.json({ success: true, data: treatment });
}));

// DELETE treatment
router.delete('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  await Treatment.findByIdAndDelete(req.params.id);
  res.json({ success: true, data: null });
}));

export default router;