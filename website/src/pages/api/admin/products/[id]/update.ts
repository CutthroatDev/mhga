import type { APIRoute } from 'astro';
import { localAdminDenied } from '../../../../../server/admin/access';
import { getRepositories } from '../../../../../server/admin/context';
import { methodNotAllowed, readForm, redirectTo, safeReturnPath, serverError, textResponse } from '../../../../../server/admin/http';
import { parseProductEdit, parseProductId } from '../../../../../server/admin/validation';

// Admin write endpoint: LOCAL DEVELOPMENT ONLY. Must never be prerendered.
export const prerender = false;

/**
 * POST /api/admin/products/<id>/update
 *
 * Edits reviewed product information: name, summary, description, category, quality notes,
 * badges, details. Every field is validated on the server; if any is invalid nothing is
 * saved and the reviewer is sent back with the names of the fields to fix.
 * Review status and internal notes are NOT changed here (see .../review).
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

  const back = safeReturnPath(form.get('return_to'), '/admin/products/pending');

  try {
    const product = await repos.adminProducts.getById(id);
    if (!product) return textResponse(404, 'Not found');

    const categories = await repos.categories.getAll();
    const result = parseProductEdit(form, new Set(categories.map((category) => category.id)));

    if (!result.ok) {
      return redirectTo(`/admin/products/${id}`, {
        error: 'invalid',
        fields: result.fields.join(','),
        back,
      });
    }

    await repos.adminProducts.update(id, result.update);
    return redirectTo(`/admin/products/${id}`, { notice: 'updated', back });
  } catch (error) {
    return serverError('update', error);
  }
};

// Every other method is refused (after the local-only guard, so production still sees 404).
export const ALL: APIRoute = ({ request }) => localAdminDenied(request) ?? methodNotAllowed(['POST']);
