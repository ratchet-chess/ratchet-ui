/**
 * Scrolls `box` vertically to bring `el` into view inside it without scrolling ancestors.
 *
 * @param box - scrollable container whose `scrollTop` is adjusted
 * @param el - descendant element to reveal inside `box`
 */
export function scrollChildIntoView(
  box: Pick<HTMLElement, 'clientHeight' | 'clientTop' | 'getBoundingClientRect' | 'scrollTop'>,
  el: Pick<HTMLElement, 'getBoundingClientRect'>,
): void {
  if (box.clientHeight <= 0) return;
  const boxRect = box.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const viewTop = boxRect.top + box.clientTop;
  const viewBottom = viewTop + box.clientHeight;
  if (elRect.top < viewTop || elRect.height >= box.clientHeight) {
    box.scrollTop += elRect.top - viewTop;
  } else if (elRect.bottom > viewBottom) {
    box.scrollTop += elRect.bottom - viewBottom;
  }
}
