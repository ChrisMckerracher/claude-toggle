import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, UI } from '../theme/tokens.js';
import type { Viewport } from '../hooks/useViewport.js';

interface FrameProps {
  viewport: Viewport;
  footer: string;
  children: React.ReactNode;
  compact?: boolean;
  spacing?: number;
}

export function Frame({ viewport, footer, children, compact = false, spacing }: FrameProps) {
  const width = Math.max(40, viewport.width - 2);
  const height = Math.max(10, viewport.height - 1);
  const layoutSpacing = spacing ?? (compact ? 0 : 1);

  return (
    <Box width={width} height={height} paddingX={UI.framePaddingX} paddingY={UI.framePaddingY}>
      <Box flexDirection="column" width="100%" height="100%" borderStyle="double" borderColor={PALETTE.accent} paddingX={compact ? 0 : 1}>
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {children}
        </Box>

        <Box marginTop={layoutSpacing} justifyContent="space-between">
          <Text color={PALETTE.dim}>{footer}</Text>
          {!compact ? <Text color={PALETTE.dim}>Resize-aware</Text> : null}
        </Box>
      </Box>
    </Box>
  );
}
