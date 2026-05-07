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
  '/free-slots/:calendarId',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { calendarId } = req.params;
    const { startDate, endDate, userId } = req.query;

    if (!calendarId) throw Errors.BadRequest('Calendar ID is required');
    if (!startDate || !endDate) throw Errors.BadRequest('startDate and endDate are required');

    const slots = await ghlClient.getFreeSlots(calendarId, { 
      startDate: startDate as string, 
      endDate: endDate as string, 
      userId: userId as string 
    });
    
    res.json({ success: true, data: slots });
  })
);

router.get(
  '/providers',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    logger.info('Calendar providers route called', {
      query: req.query,
      locationId,
      userLocationId: req.user?.locationId,
      userCompanyId: req.user?.companyId,
    });

    let providers: any[] = [];
    let total = 0;

    try {
      const companyId = (req.query.companyId as string) || req.user?.companyId || 'K9bORvG0pKtvt7QO4R9B';
      logger.info('Fetching providers', { locationId, companyId, limit });
      let staffTeam: any = [];

      try {
        staffTeam = await ghlClient.getLocationStaffTeam(locationId || '');
        logger.info('Location staff/team response', { locationId, staffTeam });
      } catch (err: any) {
        logger.warn('Location staff/team fetch failed, falling back to users endpoint:', err?.message || err);
      }

      const teamData = Array.isArray(staffTeam)
        ? staffTeam
        : staffTeam?.data || staffTeam?.teamMembers || [];

      logger.info('Parsed location staff/team data', { teamDataLength: Array.isArray(teamData) ? teamData.length : 0, teamData });

      if (Array.isArray(teamData) && teamData.length > 0) {
        providers = teamData.map((user: any) => ({
          id:                 user.id || user.userId || user._id || user.user?.id || '',
          name:               user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.user?.name || '',
          email:              user.email || user.user?.email || '',
          phone:              user.phone || user.user?.phone || '',
          role:               user.role || user.user?.role || user.type || 'Provider',
          type:               user.type || user.user?.type || 'account',
          availability_start: '09:00',
          availability_end:   '17:00',
        }));
        total = providers.length;
      } else {
        const usersResponse = await ghlClient.getUsers({ limit, locationId, companyId });
        logger.info('getUsers fallback response', {
          locationId,
          companyId,
          usersLength: Array.isArray(usersResponse.users) ? usersResponse.users.length : 0,
          meta: usersResponse.meta,
          usersSample: (usersResponse.users || []).slice(0, 5),
        });
        providers = (usersResponse.users || []).map((user: any) => ({
          id:                 user.id,
          name:               user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email:              user.email,
          phone:              user.phone || '',
          role:               user.roles?.role || user.role || user.type || 'Provider',
          type:               user.roles?.type || user.type || 'account',
          availability_start: '09:00',
          availability_end:   '17:00',
        }));
        total = usersResponse.meta?.total || providers.length;
      }
    } catch (error: any) {
      logger.warn('Failed to fetch providers from GHL API', {
        locationId,
        companyId: (req.query.companyId as string) || req.user?.companyId,
        query: req.query,
        error,
        errorMessage: error?.message,
        errorStack: error?.stack,
      });
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
