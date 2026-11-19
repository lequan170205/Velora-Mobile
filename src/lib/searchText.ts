/**
 * Lower-cases and strips diacritics so a query typed without accents ("quan")
 * still matches accented text ("Quân"). Vietnamese `đ` has no decomposition,
 * so it is mapped explicitly.
 */
export const normalizeSearchText = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim()
