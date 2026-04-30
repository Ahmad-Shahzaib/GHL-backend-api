import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta } from '../types';
import { logger } from '../utils/logger';
import { Treatment } from '../models/Treatment';

const router = Router();

// ── RPH helpers ────────────────────────────────────────────────────────────

function calcRph(price: number, duration: number, buffer: number, setup: number): number {
  const totalMin = duration + buffer + setup;
  return totalMin > 0 ? Math.round((price / totalMin) * 60) : 0;
}

function assignRphTier(rph: number): number {
  if (rph >= 800) return 1;
  if (rph >= 500) return 2;
  if (rph >= 300) return 3;
  return 4;
}

// ── Routes ─────────────────────────────────────────────────────────────────

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
  const {
    name, category, price, duration_minutes,
    buffer_minutes, setup_minutes,
    required_equipment, prime_hour_eligible,
    room_type, provider_qualification,
  } = req.body;

  if (!name)              throw Errors.BadRequest('Treatment name is required');
  if (!category)          throw Errors.BadRequest('Category is required');
  if (price === undefined) throw Errors.BadRequest('Price is required');
  if (!duration_minutes)  throw Errors.BadRequest('Duration is required');

  const buf = parseFloat(buffer_minutes) || 10;
  const stp = parseFloat(setup_minutes)  || 0;
  const rph = calcRph(parseFloat(price), parseFloat(duration_minutes), buf, stp);

  const treatment = await Treatment.create({
    locationId,
    name,
    category,
    price:                  parseFloat(price),
    duration_minutes:       parseFloat(duration_minutes),
    buffer_minutes:         buf,
    setup_minutes:          stp,
    required_equipment:     required_equipment || [],
    prime_hour_eligible:    prime_hour_eligible !== false,
    revenue_per_hour:       rph,
    rph_tier:               assignRphTier(rph),
    room_type:              room_type              || '',
    provider_qualification: provider_qualification || '',
    isActive: true,
  });

  logger.info(`Treatment created: ${name} (RPH $${rph}, Tier ${assignRphTier(rph)}) for location ${locationId}`);
  res.status(201).json({ success: true, data: treatment });
}));

// PUT update treatment
router.put('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const update = { ...req.body };

  // Recompute RPH + tier whenever price or any time field changes
  const price    = parseFloat(update.price)            ?? undefined;
  const duration = parseFloat(update.duration_minutes) ?? undefined;
  const buffer   = parseFloat(update.buffer_minutes)   ?? undefined;
  const setup    = parseFloat(update.setup_minutes)    ?? undefined;

  if (price !== undefined || duration !== undefined || buffer !== undefined || setup !== undefined) {
    // Fetch existing to fill in any missing fields
    const existing = await Treatment.findById(req.params.id).lean();
    if (!existing) throw Errors.NotFound('Treatment not found');

    const finalPrice    = price    ?? existing.price;
    const finalDuration = duration ?? existing.duration_minutes;
    const finalBuffer   = buffer   ?? existing.buffer_minutes ?? 10;
    const finalSetup    = setup    ?? existing.setup_minutes   ?? 0;

    const rph = calcRph(finalPrice, finalDuration, finalBuffer, finalSetup);
    update.revenue_per_hour = rph;
    update.rph_tier         = assignRphTier(rph);
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