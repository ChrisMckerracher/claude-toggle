export interface CommandResult {
  exitCode: number;
  stdoutLines?: string[];
  stderrLines?: string[];
  launchTui?: boolean;
}

export function success(stdoutLines?: string[]): CommandResult {
  return {
    exitCode: 0,
    stdoutLines,
  };
}

export function failure(stderrLines: string[], exitCode = 1): CommandResult {
  return {
    exitCode,
    stderrLines,
  };
}
