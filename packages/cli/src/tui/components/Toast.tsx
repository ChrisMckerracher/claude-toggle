import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme/tokens.js';

export interface ToastMessage {
  type: 'success' | 'error' | 'warn' | 'info';
  text: string;
}

interface ToastProps {
  message: ToastMessage;
}

function colorFor(type: ToastMessage['type']): string {
  if (type === 'success') return PALETTE.success;
  if (type === 'error') return PALETTE.error;
  if (type === 'warn') return PALETTE.warn;
  return PALETTE.accent;
}

function iconFor(type: ToastMessage['type']): string {
  if (type === 'success') return '✓';
  if (type === 'error') return '✗';
  if (type === 'warn') return '!';
  return 'i';
}

export function Toast({ message }: ToastProps) {
  const color = colorFor(message.type);
  const icon = iconFor(message.type);

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1}>
      <Text color={color} bold>
        {icon}
      </Text>
      <Text> </Text>
      <Text color={PALETTE.text}>{message.text}</Text>
    </Box>
  );
}
