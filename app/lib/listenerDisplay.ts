import { LANGUAGES } from './listenerSchema';

export const languageLabel = (code: string) =>
  LANGUAGES.find((language) => language.code === code)?.label ?? code;

export function priceRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Any price';
  if (min === null) return `Up to ${max?.toFixed(2)} €`;
  if (max === null) return `From ${min.toFixed(2)} €`;
  return `${min.toFixed(2)}–${max.toFixed(2)} €`;
}
