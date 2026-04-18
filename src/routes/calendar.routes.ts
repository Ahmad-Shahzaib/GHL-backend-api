import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLAppointment, GHLResource } from '../types';
import { logger } from '../utils/logger';
import { setupLocationToken } from '../utils/setupLocationToken';

const router = Router();

router.get(
  '/appointments',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const page       = parseInt(req.query.page  as string) || 1;
    const limit      = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const calendarId = req.query.calendarId as string | undefined;
    const startTime  = req.query.startTime  as string | undefined;
    const endTime    = req.query.endTime    as string | undefined;
    const userId     = req.query.userId     as string | undefined;

    let appointments: GHLAppointment[] = [];
    let total = 0;

    try {
      logger.info('Fetching appointments with params:', { locationId, calendarId, limit, page });
      const appointmentsResponse = await ghlClient.getAppointments({ limit, page, locationId, calendarId, startTime, endTime, userId });
      appointments = appointmentsResponse.events || [];
      total        = appointmentsResponse.meta?.total || appointments.length;
    } catch (error: any) {
      logger.warn('Failed to fetch appointments from GHL API:', error?.message);
    }

    const response: ApiResponse<GHLAppointment[]> = {
      success: true,
      data: appointments,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1, hasNextPage: false, hasPrevPage: page > 1 } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

router.get(
  '/appointments/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Appointment ID is required');

    const appointment = await ghlClient.getAppointment(id);
    const response: ApiResponse<GHLAppointment> = { success: true, data: appointment };
    res.json(response);
  })
);

router.post(
  '/appointments',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId     = await setupLocationToken(req);
    const appointmentData = req.body;

    if (!appointmentData.calendarId)                          throw Errors.BadRequest('Calendar ID is required');
    if (!appointmentData.startTime || !appointmentData.endTime) throw Errors.BadRequest('Start time and end time are required');

    const appointment = await ghlClient.createAppointment({ ...appointmentData, locationId });
    const response: ApiResponse<GHLAppointment> = { success: true, data: appointment };
    res.status(201).json(response);
  })
);

router.get(
  '/resources',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    let resources: GHLResource[] = [];
    let total = 0;

    try {
      const resourcesResponse = await ghlClient.getResources(locationId);
      resources = resourcesResponse.resources || [];
      total     = resourcesResponse.meta?.total || resources.length;
    } catch (error: any) {
      logger.warn('Failed to fetch resources from GHL API:', error?.message);
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

router.post(
  '/resources',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId  = await setupLocationToken(req);
    const resourceData = req.body;
    if (!resourceData.name) throw Errors.BadRequest('Resource name is required');

    const resource = await ghlClient.createResource({ ...resourceData, locationId });
    const response: ApiResponse<GHLResource> = { success: true, data: resource };
    res.status(201).json(response);
  })
);

router.get(
  '/resources/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Resource ID is required');

    const resource = await ghlClient.getResource(id);
    const response: ApiResponse<GHLResource> = { success: true, data: resource };
    res.json(response);
  })
);

router.get(
  '/calendars',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);

    try {
      const calendarsResponse = await ghlClient.getCalendars(locationId);
      const response: ApiResponse<typeof calendarsResponse.calendars> = {
        success: true,
        data: calendarsResponse.calendars || [],
      };
      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch calendars from GHL:', error?.message || error);
      const response: ApiResponse<any[]> = { success: true, data: [] };
      res.json(response);
    }
  })
);

router.get(
  '/providers',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    let providers: any[] = [];
    let total = 0;

    try {
      const usersResponse = await ghlClient.getUsers({ limit, locationId });
      providers = (usersResponse.users || []).map((user: any) => ({
        id:                 user.id,
        name:               user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email:              user.email,
        phone:              user.phone || '',
        role:               user.roles?.role || user.type || 'Provider',
        type:               user.roles?.type || 'account',
        availability_start: '09:00',
        availability_end:   '17:00',
      }));
      total = usersResponse.meta?.total || providers.length;
    } catch (error: any) {
      logger.warn('Failed to fetch providers from GHL API:', error?.message);
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
