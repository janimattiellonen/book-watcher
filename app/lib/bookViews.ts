import { type Book, BOOK_STATUSES, type BookStatus } from '../../src/db/books';

export interface BookView {
  status: BookStatus;
  path: string;
  title: string;
  empty: string;
}

/** One page per book status (spec US-4). `books.tsx` serves all four. */
export const BOOK_VIEWS: readonly BookView[] = [
  {
    status: 'new',
    path: '/',
    title: 'Suggestions',
    empty: 'No suggestions. New books show up here when a listener finds them.',
  },
  {
    status: 'accepted',
    path: '/reading-list',
    title: 'Reading list',
    empty: 'Your reading list is empty.',
  },
  { status: 'read', path: '/read', title: 'Read', empty: 'No books marked as read.' },
  { status: 'rejected', path: '/rejected', title: 'Rejected', empty: 'No rejected books.' },
];

/**
 * The view for the `:view` route param; no param is the index, Suggestions. A param, not
 * the request URL, because data requests go to `/_root.data`-style URLs.
 */
export function viewForParam(param: string | undefined): BookView | undefined {
  return BOOK_VIEWS.find((view) => view.path === `/${param ?? ''}`);
}

/** The button that moves a book into each status. */
export const STATUS_ACTIONS: Record<BookStatus, string> = {
  new: 'Back to suggestions',
  accepted: 'Add to reading list',
  read: 'Mark as read',
  rejected: 'Reject',
};

/** Where a book is, for pages that list books in any status. */
export function bookStatusLabel(book: Pick<Book, 'status' | 'eligibleAt'>): string {
  switch (book.status) {
    case 'new':
      // Never seen in range, so it was never a suggestion (spec: price range).
      return book.eligibleAt ? 'Suggestion' : 'Not in price range';
    case 'accepted':
      return 'On reading list';
    case 'read':
      return 'Read';
    case 'rejected':
      return 'Rejected';
  }
}

/** `?listener=<id>`; anything else means no filter. */
export function parseListenerFilter(searchParams: URLSearchParams): number | undefined {
  const value = searchParams.get('listener');
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

export type StatusChange =
  | { ok: true; bookIds: number[]; status: BookStatus; redirectTo: string }
  | { ok: false; error: string };

const isBookStatus = (value: unknown): value is BookStatus =>
  BOOK_STATUSES.includes(value as BookStatus);

/**
 * A status change as posted by a book card (one `bookId`) or the bulk form (many). The
 * form says where to go back to; only same-site paths are followed.
 */
export function parseStatusChange(formData: FormData): StatusChange {
  const status = formData.get('status');
  if (!isBookStatus(status)) return { ok: false, error: 'Unknown status' };

  const ids = formData.getAll('bookId');
  if (ids.length === 0) return { ok: false, error: 'No books selected' };
  if (!ids.every((id) => typeof id === 'string' && /^\d+$/.test(id))) {
    return { ok: false, error: 'Bad book id' };
  }

  const back = formData.get('redirectTo');
  const redirectTo = localPath(back);
  return { ok: true, bookIds: ids.map(Number), status, redirectTo };
}

/** Resolve against a dummy origin the way a browser would; keep the path only if the origin holds. */
function localPath(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  try {
    const base = 'http://local.invalid';
    const url = new URL(value, base);
    return url.origin === base ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}
