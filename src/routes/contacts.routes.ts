import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLContact } from '../types';

const router = Router();

/**
 * @route   GET /api/contacts
 * @desc    Get all contacts with pagination and filtering
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const query = req.query.query as string | undefined;
    const locationId = req.query.locationId as string | undefined;
    
    const contactsResponse = await ghlClient.getContacts({
      limit,
      page,
      query,
      locationId,
    });
    
    const contacts = contactsResponse.contacts || [];
    const total = contactsResponse.meta?.total || contacts.length;
    
    const response: ApiResponse<GHLContact[]> = {
      success: true,
      data: contacts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: !!contactsResponse.meta?.nextPageUrl,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };
    
    // Add pagination headers
    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page-Count', Math.ceil(total / limit).toString());
    
    res.json(response);
  })
);

/**
 * @route   GET /api/contacts/:id
 * @desc    Get contact by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    if (!id) {
      throw Errors.BadRequest('Contact ID is required');
    }
    
    const contact = await ghlClient.getContact(id);
    
    const response: ApiResponse<GHLContact> = {
      success: true,
      data: contact,
    };
    
    res.json(response);
  })
);

/**
 * @route   GET /api/contacts/search
 * @desc    Search contacts by query
 * @access  Private
 */
router.get(
  '/search',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const locationId = req.query.locationId as string | undefined;
    
    if (!query) {
      throw Errors.BadRequest('Search query is required');
    }
    
    const contactsResponse = await ghlClient.getContacts({
      limit,
      query,
      locationId,
    });
    
    const contacts = contactsResponse.contacts || [];
    
    const response: ApiResponse<GHLContact[]> = {
      success: true,
      data: contacts,
      meta: {
        total: contactsResponse.meta?.total || contacts.length,
      } as PaginationMeta,
    };
    
    res.json(response);
  })
);

export default router;
