import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, RoomUtilizationHeatmap } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/room-heatmap
 * @desc    Get room utilization heatmap data
 * @access  Private
 * @query   locationId - Optional location ID
 * @query   startDate - Optional start date (ISO format)
 * @query   endDate - Optional end date (ISO format)
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    logger.info('Fetching room utilization heatmap:', { locationId, startDate, endDate });

    const heatmapData = await ghlClient.getRoomUtilizationHeatmap({
      locationId,
      startDate,
      endDate,
    });

    const response: ApiResponse<RoomUtilizationHeatmap> = {
      success: true,
      data: heatmapData,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/room-heatmap/stats
 * @desc    Get room utilization statistics summary
 * @access  Private
 * @query   locationId - Optional location ID
 */
router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    
    const locationId = req.query.locationId as string | undefined;

    logger.info('Fetching room utilization stats:', { locationId });

    const heatmapData = await ghlClient.getRoomUtilizationHeatmap({
      locationId,
    });

    // Calculate summary statistics
    const totalRooms = heatmapData.data.length;
    const avgUtilization = totalRooms > 0
      ? Math.round(heatmapData.data.reduce((sum, r) => sum + r.utilPct, 0) / totalRooms)
      : 0;
    
    const topPerformingRooms = heatmapData.data
      .filter(r => r.utilPct >= 55)
      .map(r => ({ room: r.room, utilPct: r.utilPct, totalRevenue: r.totalRevenue }));
    
    const underperformingRooms = heatmapData.data
      .filter(r => r.utilPct < 55)
      .map(r => ({ room: r.room, utilPct: r.utilPct, totalRevenue: r.totalRevenue }));

    const totalRevenue = heatmapData.data.reduce((sum, r) => sum + r.totalRevenue, 0);

    const stats = {
      totalRooms,
      avgUtilization,
      uniqueDays: heatmapData.uniqueDays,
      totalRevenue,
      topPerformingRooms,
      underperformingRooms,
    };

    const response: ApiResponse<typeof stats> = {
      success: true,
      data: stats,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/room-heatmap/by-room/:roomName
 * @desc    Get heatmap data for a specific room
 * @access  Private
 */
router.get(
  '/by-room/:roomName',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    
    const { roomName } = req.params;
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    if (!roomName) {
      throw new Error('Room name is required');
    }

    logger.info('Fetching room heatmap for specific room:', { roomName, locationId });

    const heatmapData = await ghlClient.getRoomUtilizationHeatmap({
      locationId,
      startDate,
      endDate,
    });

    const roomData = heatmapData.data.find(r => r.room === roomName);

    if (!roomData) {
      throw new Error(`Room "${roomName}" not found`);
    }

    const response: ApiResponse<typeof roomData> = {
      success: true,
      data: roomData,
    };

    res.json(response);
  })
);

export default router;
