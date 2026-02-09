import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme/tokens.js';

export interface MenuItem {
  label: string;
  hint?: string;
  value: string;
  disabled?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  selectedIndex: number;
  variant?: 'default' | 'buttons';
  compact?: boolean;
  spacing?: number;
}

export function Menu({ items, selectedIndex, variant = 'default', compact = false, spacing }: MenuProps) {
  const gap = spacing ?? (compact ? 0 : 1);
  return (
    <Box flexDirection="column" gap={gap} alignItems={compact ? 'center' : undefined}>
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        const baseColor = item.disabled ? PALETTE.dim : PALETTE.text;
        const buttonColor = selected ? PALETTE.accent : PALETTE.warm;
        const buttonText = selected ? PALETTE.bg : baseColor;
        const prefix = selected ? '▶' : ' ';

        if (variant === 'buttons') {
          if (compact) {
            return (
              <Box key={`${item.value}-${index}`} justifyContent="center">
                <Text color={selected ? PALETTE.accent : PALETTE.dim}>{prefix} </Text>
                <Text color={selected ? PALETTE.bg : buttonText} backgroundColor={selected ? PALETTE.accent : undefined} bold={!item.disabled}>
                  {item.label}
                </Text>
              </Box>
            );
          }

          return (
            <Box
              key={`${item.value}-${index}`}
              borderStyle="round"
              borderColor={buttonColor}
              paddingX={compact ? 0 : 1}
              width="100%"
            >
              <Text color={selected ? PALETTE.accent : PALETTE.dim}>{prefix} </Text>
              <Text color={buttonText} bold={!item.disabled} wrap="truncate-end">
                {item.label}
              </Text>
              {item.hint && !compact ? <Text color={PALETTE.dim} wrap="truncate-end">  {item.hint}</Text> : null}
            </Box>
          );
        }

        const color = item.disabled ? PALETTE.dim : selected ? PALETTE.bg : PALETTE.text;
        const backgroundColor = selected ? PALETTE.accent : undefined;

        return (
          <Box key={`${item.value}-${index}`} justifyContent={compact ? 'center' : undefined}>
            <Text color={selected ? PALETTE.accent : PALETTE.dim}>{prefix} </Text>
            <Text color={color} backgroundColor={backgroundColor}>
              {item.label}
            </Text>
            {item.hint && !compact ? (
              <Text color={PALETTE.dim}>  {item.hint}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
