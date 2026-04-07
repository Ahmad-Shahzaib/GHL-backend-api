import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLAppointment, GHLResource } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/calendar/appointments
 * @desc    Get all appointments with filtering
 * @access  Private
 */
router.get(
  '/appointments',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const locationId = req.query.locationId as string | undefined;
    const calendarId = req.query.calendarId as string | undefined;
    const startTime = req.query.startTime as string | undefined;
    const endTime = req.query.endTime as string | undefined;
    const userId = req.query.userId as string | undefined;

    let appointments: GHLAppointment[] = [];
    let total = 0;

    try {
      logger.info('Fetching appointments with params:', { locationId, calendarId, limit, page });

      const appointmentsResponse = await ghlClient.getAppointments({
        limit,
        page,
        locationId,
        calendarId,
        startTime,
        endTime,
        userId,
      });

      appointments = appointmentsResponse.events || [];
      total = appointmentsResponse.meta?.total || appointments.length;
    } catch (error: any) {
      logger.warn('Failed to fetch appointments from GHL API, returning empty array:', error?.message);
      // Return empty array instead of erroring - the GHL API may not have this data or scope
    }

    const response: ApiResponse<GHLAppointment[]> = {
      success: true,
      data: appointments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: false,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

/**
 * @route   GET /api/calendar/appointments/:id
 * @desc    Get single appointment by ID
 * @access  Private
 */
router.get(
  '/appointments/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;

    if (!id) {
      throw Errors.BadRequest('Appointment ID is required');
    }

    const appointment = await ghlClient.getAppointment(id);

    const response: ApiResponse<GHLAppointment> = {
      success: true,
      data: appointment,
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/calendar/appointments
 * @desc    Create a new appointment
 * @access  Private
 */
router.post(
  '/appointments',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const appointmentData = req.body;
    const locationId = req.query.locationId as string || req.body.locationId;

    if (!appointmentData.calendarId) {
      throw Errors.BadRequest('Calendar ID is required');
    }
    if (!appointmentData.startTime || !appointmentData.endTime) {
      throw Errors.BadRequest('Start time and end time are required');
    }

    // Add locationId to appointment data
    const dataWithLocation = {
      ...appointmentData,
      locationId,
    };

    const appointment = await ghlClient.createAppointment(dataWithLocation);

    const response: ApiResponse<GHLAppointment> = {
      success: true,
      data: appointment,
    };

    res.status(201).json(response);
  })
);

/**
 * @route   GET /api/calendar/resources
 * @desc    Get all calendar resources (rooms/equipment)
 * @access  Private
 */
router.get(
  '/resources',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    let resources: GHLResource[] = [];
    let total = 0;

    try {
      const resourcesResponse = await ghlClient.getResources(locationId);
      resources = resourcesResponse.resources || [];
      total = resourcesResponse.meta?.total || resources.length;
    } catch (error: any) {
      logger.warn('Failed to fetch resources from GHL API, returning empty array:', error?.message);
    }

    const response: ApiResponse<GHLResource[]> = {
      success: true,
      data: resources,
      meta: { total } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

/**
 * @route   POST /api/calendar/resources
 * @desc    Create a new resource (room/equipment)
 * @access  Private
 */
router.post(
  '/resources',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const resourceData = req.body;
    const locationId = req.query.locationId as string || req.body.locationId;

    if (!resourceData.name) {
      throw Errors.BadRequest('Resource name is required');
    }

    const resource = await ghlClient.createResource({
      ...resourceData,
      locationId,
    });

    const response: ApiResponse<GHLResource> = {
      success: true,
      data: resource,
    };

    res.status(201).json(response);
  })
);

/**
 * @route   GET /api/calendar/resources/:id
 * @desc    Get single resource by ID
 * @access  Private
 */
router.get(
  '/resources/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;

    if (!id) {
      throw Errors.BadRequest('Resource ID is required');
    }

    const resource = await ghlClient.getResource(id);

    const response: ApiResponse<GHLResource> = {
      success: true,
      data: resource,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/calendar/calendars
 * @desc    Get all calendars
 * @access  Private
 */
router.get(
  '/calendars',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    try {
      const calendarsResponse = await ghlClient.getCalendars(locationId);

      const response: ApiResponse<typeof calendarsResponse.calendars> = {
        success: true,
        data: calendarsResponse.calendars || [],
      };

      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch calendars from GHL:', error?.message || error);
      // Return empty array instead of error
      const response: ApiResponse<any[]> = {
        success: true,
        data: [],
      };
      res.json(response);
    }
  })
);

/**
 * @route   GET /api/calendar/providers
 * @desc    Get all providers (users) - alias for users
 * @access  Private
 */
router.get(
  '/providers',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const locationId = req.query.locationId as string | undefined;

    let providers: any[] = [];
    let total = 0;

    try {
      const usersResponse = await ghlClient.getUsers({ limit, locationId });

      // Map users to providers format
      providers = (usersResponse.users || []).map((user: any) => ({
        id: user.id,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email,
        phone: user.phone || '',
        role: user.roles?.role || user.type || 'Provider',
        type: user.roles?.type || 'account',
        availability_start: '09:00',
        availability_end: '17:00',
      }));

      total = usersResponse.meta?.total || providers.length;
    } catch (error: any) {
      logger.warn('Failed to fetch providers from GHL API, returning empty array:', error?.message);
    }

    const response: ApiResponse<typeof providers> = {
      success: true,
      data: providers,
      meta: { total } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

export default router;
