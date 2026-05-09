import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { Equipment } from '../models/Equipment';

const router = Router();

// GET /api/equipment?locationId=xxx
router.get('/', async (req: Request, res: Response) => {
  try {
    const { locationId } = req.query;
    if (!locationId) {
      res.status(400).json({ success: false, error: 'locationId is required' });
      return;
    }
    const equipment = await Equipment.find({ locationId: String(locationId) }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: equipment });
  } catch (error) {
    logger.error('Error fetching equipment:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch equipment' });
  }
});

// POST /api/equipment?locationId=xxx
router.post('/', async (req: Request, res: Response) => {
  try {
    const locationId = (req.query.locationId as string) || req.body.locationId;
    if (!locationId) {
      res.status(400).json({ success: false, error: 'locationId is required' });
      return;
    }
    const { name, is_fully_paid, monthly_cost } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ success: false, error: 'Machine name is required' });
      return;
    }
    const item = await Equipment.create({
      locationId,
      name: name.trim(),
      is_fully_paid: is_fully_paid ?? true,
      monthly_cost:  is_fully_paid ? 0 : (parseFloat(monthly_cost) || 0),
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    logger.error('Error creating equipment:', error);
    res.status(500).json({ success: false, error: 'Failed to create equipment' });
  }
});

// PATCH /api/equipment/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { name, is_fully_paid, monthly_cost } = req.body;
    const update: Record<string, any> = {};
    if (name         !== undefined) update.name          = name.trim();
    if (is_fully_paid !== undefined) {
      update.is_fully_paid = is_fully_paid;
      update.monthly_cost  = is_fully_paid ? 0 : (parseFloat(monthly_cost) || 0);
    } else if (monthly_cost !== undefined) {
      update.monthly_cost = parseFloat(monthly_cost) || 0;
    }
    const updated = await Equipment.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!updated) {
      res.status(404).json({ success: false, error: 'Equipment not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating equipment:', error);
    res.status(500).json({ success: false, error: 'Failed to update equipment' });
  }
});

// DELETE /api/equipment/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await Equipment.findByIdAndDelete(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Equipment not found' });
      return;
    }
    res.json({ success: true, data: { message: 'Equipment deleted' } });
  } catch (error) {
    logger.error('Error deleting equipment:', error);
    res.status(500).json({ success: false, error: 'Failed to delete equipment' });
  }
});

export default router;