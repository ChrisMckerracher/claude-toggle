import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme/tokens.js';

interface PanelProps {
  title: string;
  children: React.ReactNode;
  width?: number;
  compact?: boolean;
}

export function Panel({ title, children, width, compact = false }: PanelProps) {
  if (compact) {
    return (
      <Box flexDirection="column" width={width}>
        <Text color={PALETTE.warm} bold>
          {title}
        </Text>
        {children}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PALETTE.warm}
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text color={PALETTE.warm} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}
