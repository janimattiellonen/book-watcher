import { data, redirect } from 'react-router';

import { setStatus } from '../../src/db/books';
import { parseStatusChange } from '../lib/bookViews';
import { db } from '../lib/db.server';
import type { Route } from './+types/bookStatus';

/**
 * POST /books/status: moves one or many books to a status, then back to the page the
 * form came from. A plain form post, so marking works without JavaScript.
 */
export async function action({ request }: Route.ActionArgs) {
  const change = parseStatusChange(await request.formData());
  if (!change.ok) throw data(change.error, { status: 400 });

  await setStatus(db, change.bookIds, change.status);
  return redirect(change.redirectTo);
}
