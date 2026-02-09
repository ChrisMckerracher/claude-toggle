import { useEffect, useState } from 'react';
import { UI } from '../theme/tokens.js';

export interface Viewport {
  width: number;
  height: number;
  isTiny: boolean;
}

function readViewport(): Viewport {
  const rawWidth = process.stdout.columns ?? 80;
  const rawHeight = process.stdout.rows ?? 24;

  return {
    width: rawWidth,
    height: rawHeight,
    isTiny: rawWidth < UI.minWidth || rawHeight < UI.minHeight,
  };
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => readViewport());

  useEffect(() => {
    const onResize = () => {
      setViewport(readViewport());
    };

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return viewport;
}
