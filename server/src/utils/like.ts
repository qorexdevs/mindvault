// escape LIKE/ILIKE wildcards so a search term is matched literally.
// without this, a query like "50%" or "a_b" treats % and _ as wildcards.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
