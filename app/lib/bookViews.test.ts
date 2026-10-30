import { describe, expect, it } from 'vitest';

import { bookStatusLabel, parseListenerFilter, parseStatusChange, viewForParam } from './bookViews';

function form(entries: [string, string][]): FormData {
  const formData = new FormData();
  for (const [name, value] of entries) formData.append(name, value);
  return formData;
}

describe('viewForParam', () => {
  it('maps each page to its status', () => {
    expect(viewForParam(undefined)?.status).toBe('new');
    expect(viewForParam('reading-list')?.status).toBe('accepted');
    expect(viewForParam('read')?.status).toBe('read');
    expect(viewForParam('rejected')?.status).toBe('rejected');
    expect(viewForParam('new')).toBeUndefined();
    expect(viewForParam('elsewhere')).toBeUndefined();
  });
});

describe('bookStatusLabel', () => {
  it('tells a suggestion from a book never seen in range', () => {
    const eligibleAt = new Date();
    expect(bookStatusLabel({ status: 'new', eligibleAt })).toBe('Suggestion');
    expect(bookStatusLabel({ status: 'new', eligibleAt: null })).toBe('Not in price range');
    expect(bookStatusLabel({ status: 'accepted', eligibleAt })).toBe('On reading list');
  });
});

describe('parseListenerFilter', () => {
  it('reads a listener id and ignores anything else', () => {
    expect(parseListenerFilter(new URLSearchParams('listener=12'))).toBe(12);
    expect(parseListenerFilter(new URLSearchParams('listener='))).toBeUndefined();
    expect(parseListenerFilter(new URLSearchParams('listener=1e3'))).toBeUndefined();
    expect(parseListenerFilter(new URLSearchParams(''))).toBeUndefined();
  });
});

describe('parseStatusChange', () => {
  it('reads one book from a card', () => {
    expect(
      parseStatusChange(
        form([
          ['bookId', '7'],
          ['status', 'accepted'],
          ['redirectTo', '/?listener=2'],
        ]),
      ),
    ).toEqual({ ok: true, bookIds: [7], status: 'accepted', redirectTo: '/?listener=2' });
  });

  it('reads many books from a bulk form', () => {
    const change = parseStatusChange(
      form([
        ['bookId', '1'],
        ['bookId', '2'],
        ['bookId', '3'],
        ['status', 'read'],
      ]),
    );
    expect(change).toMatchObject({ ok: true, bookIds: [1, 2, 3], status: 'read' });
  });

  it('refuses an unknown status, no books and a bad id', () => {
    expect(parseStatusChange(form([['bookId', '1']])).ok).toBe(false);
    expect(
      parseStatusChange(
        form([
          ['bookId', '1'],
          ['status', 'deleted'],
        ]),
      ).ok,
    ).toBe(false);
    expect(parseStatusChange(form([['status', 'read']]))).toEqual({
      ok: false,
      error: 'No books selected',
    });
    expect(
      parseStatusChange(
        form([
          ['bookId', '1; drop'],
          ['status', 'read'],
        ]),
      ).ok,
    ).toBe(false);
  });

  it('only goes back to a same-site path', () => {
    const redirectTo = (value: string) => {
      const change = parseStatusChange(
        form([
          ['bookId', '1'],
          ['status', 'read'],
          ['redirectTo', value],
        ]),
      );
      return change.ok ? change.redirectTo : null;
    };
    expect(redirectTo('/rejected')).toBe('/rejected');
    expect(redirectTo('https://example.com/')).toBe('/');
    expect(redirectTo('//example.com/')).toBe('/');
    expect(redirectTo('/\\evil.example')).toBe('/');
    expect(redirectTo('/\t/evil.example')).toBe('/');
    expect(redirectTo('/%5Cevil.example')).toBe('/%5Cevil.example');
    expect(redirectTo('/rejected?page=2')).toBe('/rejected?page=2');
  });
});
