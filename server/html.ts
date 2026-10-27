export interface Cell {
  text: string;
  colspan: number;
  rowspan: number;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

export function cellText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const plain = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeEntities(plain)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function htmlToText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  return cellText(body.replace(/<\/(tr|table|div|p|li)>/gi, '\n'));
}

function attrNumber(attrs: string, name: string): number {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i'));
  const value = match ? Number(match[1]) : 1;
  return Number.isFinite(value) && value > 0 ? Math.min(value, 20) : 1;
}

export function extractTables(html: string): Cell[][][] {
  const tables: Cell[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html))) {
    const rows: Cell[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableMatch[1]))) {
      const cells: Cell[] = [];
      const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        cells.push({
          text: cellText(cellMatch[3]),
          colspan: attrNumber(cellMatch[2], 'colspan'),
          rowspan: attrNumber(cellMatch[2], 'rowspan'),
        });
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length >= 2) tables.push(rows);
  }
  return tables;
}

export function toMatrix(rows: Cell[][]): string[][] {
  const grid: string[][] = [];
  rows.forEach((row, r) => {
    if (!grid[r]) grid[r] = [];
    let col = 0;
    for (const cell of row) {
      while (grid[r][col] !== undefined) col++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][col + dc] = dr === 0 && dc === 0 ? cell.text : '';
        }
      }
      col += cell.colspan;
    }
  });
  return grid;
}

/** 把表格矩阵摊平成方便喂给模型的文本 */
export function matrixToText(matrix: string[][]): string {
  return matrix
    .map((row) => row.map((cell) => cell.replace(/\n/g, ' / ')).join(' | '))
    .filter((line) => line.replace(/[|\s]/g, ''))
    .join('\n');
}
