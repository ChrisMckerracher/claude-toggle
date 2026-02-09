import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { TEAMMATE_SECTION_END, TEAMMATE_SECTION_START } from './section-markers.js';

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (true) {
    index = haystack.indexOf(needle, index);
    if (index === -1) {
      return count;
    }

    count += 1;
    index += needle.length;
  }
}

function buildBaseContent(content: string): string {
  if (content.trim().length > 0) {
    return content.trimEnd();
  }

  return '# Project Context\n';
}

export async function upsertTeammateSection(filePath: string, sectionContent: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  if (!existsSync(filePath)) {
    await writeFile(filePath, '# Project Context\n\n', 'utf-8');
  }

  const content = await readFile(filePath, 'utf-8');
  const startCount = countOccurrences(content, TEAMMATE_SECTION_START);
  const endCount = countOccurrences(content, TEAMMATE_SECTION_END);

  if (startCount > 1 || endCount > 1) {
    throw new Error('Malformed teammate section markers: multiple managed sections found');
  }

  if (startCount !== endCount) {
    throw new Error('Malformed teammate section markers: start/end marker mismatch');
  }

  let body = content;
  if (startCount === 1) {
    const startIndex = content.indexOf(TEAMMATE_SECTION_START);
    const endIndex = content.indexOf(TEAMMATE_SECTION_END);

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      throw new Error('Malformed teammate section markers: unable to locate managed block boundaries');
    }

    const blockEndIndex = endIndex + TEAMMATE_SECTION_END.length;
    const prefix = content.slice(0, startIndex).trimEnd();
    const suffix = content.slice(blockEndIndex).trim();

    if (suffix.length > 0) {
      body = `${prefix}\n\n${suffix}`.trim();
    } else {
      body = prefix.trim();
    }
  }

  const normalized = buildBaseContent(body);
  const updated = `${normalized}\n\n${sectionContent.trimEnd()}\n`;
  await writeFile(filePath, updated, 'utf-8');
}
