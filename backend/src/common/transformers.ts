import { Transform } from 'class-transformer';

/** Trims string values; leaves other types untouched (validators then reject them). */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and turns an empty string into null (for optional nullable text fields). */
export const TrimToNull = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t === '' ? null : t;
  });
