import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ClinicKpiGoal } from '../models/ClinicKpiGoal';

const router = Router();

// ── Phase 1 preset definitions (source of truth) ────────────────────────────
export const PHASE1_PRESETS = [
  { preset_key: 'room_utilization',   preset_name: 'Increase Room Utilization',   target_value: 75,  direction: 'higher_better', display_order: 1, phase: 1, unit: '%'    },
  { preset_key: 'prime_hour_high_ticket', preset_name: 'Protect Prime-Hour Revenue', target_value: 70, direction: 'higher_better', display_order: 2, phase: 1, unit: '%' },
  { preset_key: 'schedule_gaps',      preset_name: 'Reduce Schedule Gaps',        target_value: 15,  direction: 'lower_better',  display_order: 3, phase: 1, unit: '%'    },
  { preset_key: 'revenue_per_hour',   preset_name: 'Boost Revenue Per Hour',      target_value: 500, direction: 'higher_better', display_order: 4, phase: 1, unit: '$/hr' },
  { preset_key: 'avg_ticket_value',   preset_name: 'Increase Average Ticket',     target_value: 600, direction: 'higher_better', display_order: 5, phase: 1, unit: '$'    },
  { preset_key: 'schedule_efficiency',preset_name: 'Improve Schedule Efficiency', target_value: 80,  direction: 'higher_better', display_order: 6, phase: 1, unit: '%'    },
  { preset_key: 'no_show_rate',       preset_name: 'Reduce No-Show Rate',         target_value: 8,   direction: 'lower_better',  display_order: 7, phase: 1, unit: '%'    },
  { preset_key: 'idle_time',          preset_name: 'Minimize Idle Time',          target_value: 20,  direction: 'lower_better',  display_order: 8, phase: 1, unit: '%'    },
] as const;

// Phase 2 presets — stored client-side only for "Coming Soon" display
export const PHASE2_PRESETS = [
  { preset_key: 'provider_utilization',     preset_name: 'Improve Provider Utilization',   target_value: 80,  direction: 'higher_better', unit: '%'    },
  { preset_key: 'prime_hour_rph',           preset_name: 'Maximize Prime-Hour RPH',         target_value: 800, direction: 'higher_better', unit: '$/hr' },
  { preset_key: 'consultation_conversion',  preset_name: 'Improve Consultation Conversion', target_value: 50,  direction: 'higher_better', unit: '%'    },
  { preset_key: 'client_retention',         preset_name: 'Increase Client Retention',       target_value: 45,  direction: 'higher_better', unit: '%'    },
  { preset_key: 'lead_response_time',       preset_name: 'Shorten Lead Response Time',      target_value: 5,   direction: 'lower_better',  unit: 'min'  },
  { preset_key: 'provider_room_switches',   preset_name: 'Reduce Provider Room Switches',   target_value: 2,   direction: 'lower_better',  unit: ''     },
  { preset_key: 'treatment_throughput',     preset_name: 'Increase Treatment Throughput',   target_value: 10,  direction: 'higher_better', unit: '/day' },
];

/**
 * @route   GET /api/kpi-goals
 * @desc    Get all KPI goals for a clinic. Auto-seeds Phase 1 defaults on first call.
 * @access  Private
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clinic_id = req.query.locationId as string;
    if (!clinic_id) {
      res.status(400).json({ success: false, error: 'locationId is required' });
      return;
    }

    // Auto-seed Phase 1 defaults if this clinic has no goals yet
    const existingCount = await ClinicKpiGoal.countDocuments({ clinic_id });
    if (existingCount === 0) {
      await ClinicKpiGoal.insertMany(
        PHASE1_PRESETS.map(p => ({ ...p, clinic_id }))
      );
      logger.info(`Seeded ${PHASE1_PRESETS.length} KPI goals for clinic ${clinic_id}`);
    }

    const goals = await ClinicKpiGoal.find({ clinic_id }).sort({ display_order: 1 }).lean();
    res.json({ success: true, data: goals });
  } catch (error) {
    logger.error('Error fetching KPI goals:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch KPI goals' });
  }
});

/**
 * @route   PATCH /api/kpi-goals/:id
 * @desc    Update a single KPI goal (target_value, is_active, display_order)
 * @access  Private
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { target_value, is_active, display_order } = req.body;
    const update: Record<string, any> = {};
    if (target_value  !== undefined) update.target_value  = target_value;
    if (is_active     !== undefined) update.is_active     = is_active;
    if (display_order !== undefined) update.display_order = display_order;

    const updated = await ClinicKpiGoal.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!updated) {
      res.status(404).json({ success: false, error: 'KPI goal not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating KPI goal:', error);
    res.status(500).json({ success: false, error: 'Failed to update KPI goal' });
  }
});

/**
 * @route   POST /api/kpi-goals/reorder
 * @desc    Bulk update display_order for drag-and-drop reordering
 * @access  Private
 */
router.post('/reorder', async (req: Request, res: Response) => {
  try {
    // body: { order: [{ id, display_order }] }
    const { order } = req.body as { order: { id: string; display_order: number }[] };
    if (!Array.isArray(order)) {
      res.status(400).json({ success: false, error: 'order array is required' });
      return;
    }
    await Promise.all(
      order.map(item =>
        ClinicKpiGoal.findByIdAndUpdate(item.id, { display_order: item.display_order })
      )
    );
    res.json({ success: true, data: { message: 'Order updated' } });
  } catch (error) {
    logger.error('Error reordering KPI goals:', error);
    res.status(500).json({ success: false, error: 'Failed to reorder KPI goals' });
  }
});

export default router;