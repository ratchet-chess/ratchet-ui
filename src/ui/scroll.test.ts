import { describe, expect, it } from 'vitest';
import { scrollChildIntoView } from './scroll.ts';

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function makeBox(top: number, clientHeight: number, scrollTop: number, clientTop = 0) {
  return {
    clientHeight,
    clientTop,
    scrollTop,
    getBoundingClientRect: () => rect(top, clientHeight + clientTop * 2),
  };
}

function makeEl(top: number, height: number) {
  return { getBoundingClientRect: () => rect(top, height) };
}

describe('scrollChildIntoView', () => {
  it('leaves scrollTop unchanged when child is already inside the container', () => {
    const box = makeBox(1100, 200, 40);
    scrollChildIntoView(box, makeEl(1150, 20));
    expect(box.scrollTop).toBe(40);
  });

  it('scrolls down to reveal a child below the container viewport even when container is off-screen', () => {
    const box = makeBox(1100, 200, 40);
    scrollChildIntoView(box, makeEl(1310, 24));
    expect(box.scrollTop).toBe(74);
  });

  it('scrolls up to reveal a child above the container viewport', () => {
    const box = makeBox(1100, 200, 100);
    scrollChildIntoView(box, makeEl(1070, 20));
    expect(box.scrollTop).toBe(70);
  });

  it('accounts for container top border via clientTop', () => {
    const box = makeBox(100, 200, 50, 2);
    scrollChildIntoView(box, makeEl(101, 20));
    expect(box.scrollTop).toBe(49);
  });

  it('aligns top when child is taller than the container', () => {
    const box = makeBox(100, 100, 20);
    scrollChildIntoView(box, makeEl(130, 150));
    expect(box.scrollTop).toBe(50);
  });

  it('does nothing when the container has zero height', () => {
    const box = makeBox(0, 0, 25);
    scrollChildIntoView(box, makeEl(40, 20));
    expect(box.scrollTop).toBe(25);
  });
});
