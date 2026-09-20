import type { APIRoute } from 'astro';
import { localAdminDenied } from '../../../../../server/admin/access';
import { getRepositories } from '../../../../../server/admin/context';
import { methodNotAllowed, readForm, redirectTo, safeReturnPath, serverError, textResponse } from '../../../../../server/admin/http';
import { statusNotice } from '../../../../../server/admin/messages';
import {
  parseProductId,
  parseReviewNotes,
  parseReviewStatus,
} from '../../../../../server/admin/validation';

// Admin write endpoint: LOCAL DEVELOPMENT ONLY. Must never be prerendered.
export const prerender = false;

/**
 * POST /api/admin/products/<id>/review
 *
 * Form fields:
 *   status  (optional) pending | approved | rejected
 *   notes   (optional) internal review notes; empty clears them
 *   return_to (optional) one of the admin queue paths
 *
 * With `status`, the status changes (and notes are saved with it). Without it, only the
 * notes are saved. Redirects back to a queue (status change) or the product (notes only).
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const denied = localAdminDenied(request);
  if (denied) return denied;

  const id = parseProductId(params.id);
  if (!id) return textResponse(404, 'Not found');

  const repos = getRepositories(locals);
  if (!repos) return textResponse(503, 'Database unavailable');

  const form = await readForm(request);
  if (form instanceof Response) return form;

  const rawStatus = form.get('status');
  const status = rawStatus === null || rawStatus === '' ? undefined : parseReviewStatus(rawStatus);
  if (rawStatus !== null && rawStatus !== '' && !status) {
    return textResponse(400, 'Invalid review status');
  }

  let notes: string | null | undefined;
  if (form.has('notes')) {
    const parsed = parseReviewNotes(form.get('notes'));
    if (!parsed.ok) {
      const back = safeReturnPath(form.get('return_to'), '/admin/products/pending');
      return redirectTo(`/admin/products/${id}`, { error: 'invalid', fields: 'reviewNotes', back });
    }
    notes = parsed.value;
  }

  if (!status && notes === undefined) return textResponse(400, 'Nothing to save');

  try {
    const product = await repos.adminProducts.getById(id);
    if (!product) return textResponse(404, 'Not found');

    const returnTo = safeReturnPath(form.get('return_to'), '/admin/products/pending');

    if (status && status !== product.reviewStatus) {
      await repos.adminProducts.changeReviewStatus(id, status, notes === undefined ? {} : { notes });
      const isPublic =
        status === 'approved' && (await repos.publicProducts.getApprovedProductBySlug(product.slug)) !== undefined;
      return redirectTo(returnTo, { notice: statusNotice(status, isPublic), product: id });
    }

    // Same status (or none): only the notes can change.
    if (notes !== undefined) {
      await repos.adminProducts.update(id, { reviewNotes: notes });
    }
    return redirectTo(`/admin/products/${id}`, { notice: 'notes_saved', back: returnTo });
  } catch (error) {
    return serverError('review', error);
  }
};

// Every other method is refused (after the local-only guard, so production still sees 404).
export const ALL: APIRoute = ({ request }) => localAdminDenied(request) ?? methodNotAllowed(['POST']);
