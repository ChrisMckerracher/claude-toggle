import React from 'react';
import { render } from 'ink';
import { TuiApp } from './tui/app/App.js';

export function launchTUI(): void {
  render(<TuiApp />);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  launchTUI();
}
