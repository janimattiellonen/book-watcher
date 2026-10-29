import { z } from 'zod';

import type { ListenerInput } from '../../src/db/listeners';
import { FORMATS, SOURCE_IDS } from '../../src/sources/types';

/** The languages both source adapters can search in. */
export const LANGUAGES = [
  { code: 'fi', label: 'Finnish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'en', label: 'English' },
] as const;

export const SOURCE_LABELS: Record<(typeof SOURCE_IDS)[number], string> = {
  adlibris: 'Adlibris',
  bokus: 'Bokus',
};

/** The form as submitted, kept as text so an invalid form shows back what was typed. */
export interface ListenerFormValues {
  name: string;
  author: string;
  language: string;
  format: string;
  minPriceEur: string;
  maxPriceEur: string;
  sources: string[];
  enabled: boolean;
}

export type ListenerFormErrors = Partial<Record<keyof ListenerFormValues, string>>;

export type ListenerFormResult =
  | { ok: true; input: ListenerInput }
  | { ok: false; errors: ListenerFormErrors; values: ListenerFormValues };

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

/** Largest value the `numeric(10,2)` price columns hold. */
const MAX_PRICE_EUR = 99_999_999.99;

/** Plain decimals only: no hex, exponent or more than two decimals. */
const PRICE_PATTERN = /^-?\d+(?:[.,]\d{1,2})?$/;

/** Empty means no bound. A decimal comma is accepted, as Finnish keyboards type one. */
const price = z
  .string()
  .trim()
  .transform((text) => {
    if (text === '') return null;
    return PRICE_PATTERN.test(text) ? Number(text.replace(',', '.')) : Number.NaN;
  })
  .pipe(
    z
      .number({ error: 'Enter a price in euros, such as 4.99' })
      .min(0, 'The price cannot be negative')
      .max(MAX_PRICE_EUR, 'The price is too large')
      .nullable(),
  );

const schema = z
  .object({
    name: requiredText('Name'),
    author: requiredText('Author'),
    language: z.enum(
      LANGUAGES.map((language) => language.code),
      'Choose a language',
    ),
    format: z.enum(FORMATS, 'Choose a format'),
    minPriceEur: price,
    maxPriceEur: price,
    sources: z.array(z.enum(SOURCE_IDS, 'Unknown source')).min(1, 'Choose at least one source'),
    enabled: z.boolean(),
  })
  .refine(
    ({ minPriceEur, maxPriceEur }) =>
      minPriceEur === null || maxPriceEur === null || minPriceEur <= maxPriceEur,
    { path: ['maxPriceEur'], message: 'The maximum price must be at least the minimum' },
  );

export function readListenerForm(formData: FormData): ListenerFormValues {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };
  return {
    name: text('name'),
    author: text('author'),
    language: text('language'),
    format: text('format'),
    minPriceEur: text('minPriceEur'),
    maxPriceEur: text('maxPriceEur'),
    sources: formData.getAll('sources').filter((value) => typeof value === 'string'),
    enabled: formData.get('enabled') === 'on',
  };
}

/** Validates the listener form; on failure, one message per field. */
export function parseListenerForm(formData: FormData): ListenerFormResult {
  const values = readListenerForm(formData);
  const parsed = schema.safeParse(values);
  if (parsed.success) return { ok: true, input: parsed.data };

  const errors: ListenerFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof ListenerFormValues;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors, values };
}
