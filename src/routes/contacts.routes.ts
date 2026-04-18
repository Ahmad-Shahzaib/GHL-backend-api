import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLContact } from '../types';
import { setupLocationToken } from '../utils/setupLocationToken'; // FIX #6

const router = Router();

/**
 * @route   GET /api/contacts
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req); // FIX #2
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const query = req.query.query as string | undefined;

    const contactsResponse = await ghlClient.getContacts({ limit, page, query, locationId });
    const contacts = contactsResponse.contacts || [];
    const total    = contactsResponse.meta?.total || contacts.length;

    const response: ApiResponse<GHLContact[]> = {
      success: true,
      data: contacts,
      meta: {
        page, limit, total,
        totalPages:  Math.ceil(total / limit),
        hasNextPage: !!contactsResponse.meta?.nextPageUrl,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page-Count', Math.ceil(total / limit).toString());
    res.json(response);
  })
);

// FIX #7 — /search MUST come before /:id or Express matches "search" as an id
/**
 * @route   GET /api/contacts/search
 */
router.get(
  '/search',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const query = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!query) throw Errors.BadRequest('Search query is required');

    const contactsResponse = await ghlClient.getContacts({ limit, query, locationId });
    const contacts = contactsResponse.contacts || [];

    const response: ApiResponse<GHLContact[]> = {
      success: true,
      data: contacts,
      meta: { total: contactsResponse.meta?.total || contacts.length } as PaginationMeta,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/contacts/:id
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Contact ID is required');

    const contact = await ghlClient.getContact(id);
    const response: ApiResponse<GHLContact> = { success: true, data: contact };
    res.json(response);
  })
);

export default router;
