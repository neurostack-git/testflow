// ── Filename helpers ─────────────────────────────────────────────────────────

/** Hard-cap a display name, appending an ellipsis when it exceeds `max`. */
export function trimName(name: string, max = 48): string {
  return name.length > max ? name.slice(0, max) + "…" : name;
}

/**
 * Extract a human-readable filename from an S3 key.
 * Keys look like `projects/<id>/<uuid>_<original-name>` — strip the path and
 * the leading `<uuid>_` prefix, falling back gracefully if the shape differs.
 */
export function displayFilename(key: string): string {
  const base = key.split("/").pop() ?? key;
  const withoutPrefix = base.split("_").slice(1).join("_");
  return withoutPrefix || base || key;
}
