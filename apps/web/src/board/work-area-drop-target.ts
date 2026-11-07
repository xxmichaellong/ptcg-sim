/** Only a work-area window actually painted under the pointer can take a drop. */
export const workAreaDropTargetAt = (
  root: Element | null,
  x: number,
  y: number,
  sourceZoneId?: string
): string | null => {
  const windows = root?.querySelectorAll<HTMLElement>(
    '[data-work-area-id][data-work-area-drop-active="true"]'
  );
  for (const window of [...(windows ?? [])].reverse()) {
    const id = window.dataset.workAreaId;
    if (
      !id ||
      id === sourceZoneId ||
      window.closest('[inert], [aria-hidden="true"]')
    )
      continue;
    const bounds = window.getBoundingClientRect();
    if (
      bounds.width > 0 &&
      bounds.height > 0 &&
      x >= bounds.left &&
      x <= bounds.right &&
      y >= bounds.top &&
      y <= bounds.bottom
    )
      return id;
  }
  return null;
};
