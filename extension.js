const vscode = require("vscode");

const SECTION_PATTERN = /^\s*\[([^\]]+)\]\s*$/;
const DEFAULT_PALETTE = [
  "rgba(255, 99, 132, 0.20)",
  "rgba(255, 159, 64, 0.20)",
  "rgba(255, 205, 86, 0.20)",
  "rgba(75, 192, 192, 0.20)",
  "rgba(54, 162, 235, 0.20)",
  "rgba(153, 102, 255, 0.20)",
  "rgba(0, 200, 83, 0.20)",
  "rgba(201, 203, 207, 0.20)"
];

/** @type {vscode.TextEditorDecorationType[]} */
let decorationTypes = [];
/** @type {NodeJS.Timeout | undefined} */
let refreshTimer;

class SwmmSectionSymbolProvider {
  /**
   * @param {vscode.TextDocument} document
   * @returns {vscode.ProviderResult<vscode.DocumentSymbol[]>}
   */
  provideDocumentSymbols(document) {
    const sections = parseSections(document);
    return sections.map((section) => {
      const headingText = document.lineAt(section.line).text;
      const endText = document.lineAt(section.endLine).text;
      const selectionRange = new vscode.Range(section.line, 0, section.line, headingText.length);
      const range = new vscode.Range(section.line, 0, section.endLine, endText.length);
      return new vscode.DocumentSymbol(
        section.name,
        `Line ${section.line + 1}`,
        vscode.SymbolKind.Namespace,
        range,
        selectionRange
      );
    });
  }
}

class SwmmSectionFoldingProvider {
  /**
   * @param {vscode.TextDocument} document
   * @returns {vscode.ProviderResult<vscode.FoldingRange[]>}
   */
  provideFoldingRanges(document) {
    return parseSections(document)
      .filter((section) => section.endLine > section.line)
      .map(
        (section) =>
          new vscode.FoldingRange(
            section.line,
            section.endLine,
            vscode.FoldingRangeKind.Region
          )
      );
  }
}

/**
 * @param {vscode.TextDocument} document
 * @returns {{name: string, line: number, endLine: number}[]}
 */
function parseSections(document) {
  /** @type {{name: string, line: number, endLine: number}[]} */
  const sections = [];
  /** @type {{name: string, line: number, endLine: number} | undefined} */
  let current;

  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    const match = text.match(SECTION_PATTERN);
    if (!match) {
      continue;
    }
    if (current) {
      current.endLine = line - 1;
      sections.push(current);
    }
    current = {
      name: match[1].trim(),
      line,
      endLine: line
    };
  }

  if (current) {
    current.endLine = document.lineCount - 1;
    sections.push(current);
  }

  return sections;
}

/**
 * @param {string} line
 * @returns {string}
 */
function stripInlineComment(line) {
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ";" && !inQuotes) {
      return line.slice(0, index);
    }
  }

  return line;
}

/**
 * @param {string} line
 * @returns {{start: number, end: number}[]}
 */
function tokenizeColumns(line) {
  /** @type {{start: number, end: number}[]} */
  const tokens = [];
  const matcher = /"[^"]*"|\S+/g;
  let match = matcher.exec(line);

  while (match) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length
    });
    match = matcher.exec(line);
  }

  return tokens;
}

/**
 * @param {number} paletteSize
 * @param {vscode.TextDocument} document
 * @returns {vscode.Range[][]}
 */
function buildRainbowRanges(paletteSize, document) {
  /** @type {vscode.Range[][]} */
  const rangesByColor = Array.from({ length: paletteSize }, () => []);

  for (let line = 0; line < document.lineCount; line += 1) {
    const original = document.lineAt(line).text;
    const trimmed = original.trim();

    if (!trimmed || trimmed.startsWith(";")) {
      continue;
    }
    if (SECTION_PATTERN.test(trimmed)) {
      continue;
    }

    const content = stripInlineComment(original);
    const tokens = tokenizeColumns(content);
    if (!tokens.length) {
      continue;
    }

    for (let column = 0; column < tokens.length; column += 1) {
      const token = tokens[column];
      if (token.end <= token.start) {
        continue;
      }
      rangesByColor[column % paletteSize].push(
        new vscode.Range(line, token.start, line, token.end)
      );
    }
  }

  return rangesByColor;
}

/**
 * @returns {boolean}
 */
function isRainbowEnabled() {
  return vscode.workspace
    .getConfiguration("swmmInp")
    .get("enableRainbowColumns", true);
}

/**
 * @returns {string[]}
 */
function getPalette() {
  const configured = vscode.workspace
    .getConfiguration("swmmInp")
    .get("rainbowPalette", DEFAULT_PALETTE);

  if (!Array.isArray(configured)) {
    return DEFAULT_PALETTE;
  }

  const palette = configured
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return palette.length ? palette : DEFAULT_PALETTE;
}

function recreateDecorationTypes() {
  for (const decorationType of decorationTypes) {
    decorationType.dispose();
  }

  const palette = getPalette();
  decorationTypes = palette.map((color) =>
    vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      borderRadius: "2px"
    })
  );
}

/**
 * @param {vscode.TextEditor} editor
 */
function applyRainbowDecorations(editor) {
  if (editor.document.languageId !== "swmm-inp") {
    return;
  }

  if (!decorationTypes.length) {
    recreateDecorationTypes();
  }

  if (!isRainbowEnabled()) {
    for (const decorationType of decorationTypes) {
      editor.setDecorations(decorationType, []);
    }
    return;
  }

  const rangesByColor = buildRainbowRanges(
    decorationTypes.length,
    editor.document
  );
  decorationTypes.forEach((decorationType, index) => {
    editor.setDecorations(decorationType, rangesByColor[index]);
  });
}

function refreshVisibleEditors() {
  for (const editor of vscode.window.visibleTextEditors) {
    applyRainbowDecorations(editor);
  }
}

function scheduleRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    refreshVisibleEditors();
  }, 100);
}

async function goToSection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "swmm-inp") {
    vscode.window.showInformationMessage(
      "Open a SWMM .inp file to use section navigation."
    );
    return;
  }

  const sections = parseSections(editor.document);
  if (!sections.length) {
    vscode.window.showInformationMessage(
      "No section headings were found in this file."
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    sections.map((section) => ({
      label: `[${section.name}]`,
      description: `Line ${section.line + 1}`,
      section
    })),
    {
      placeHolder: "Select a SWMM section to jump to"
    }
  );

  if (!picked) {
    return;
  }

  const target = new vscode.Position(picked.section.line, 0);
  editor.selection = new vscode.Selection(target, target);
  editor.revealRange(
    new vscode.Range(target, target),
    vscode.TextEditorRevealType.InCenter
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  recreateDecorationTypes();

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: "swmm-inp" },
      new SwmmSectionSymbolProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: "swmm-inp" },
      new SwmmSectionFoldingProvider()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("swmmInp.goToSection", goToSection)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "swmmInp.refreshRainbowColumns",
      refreshVisibleEditors
    )
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(scheduleRefresh)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(scheduleRefresh)
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "swmm-inp") {
        scheduleRefresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("swmmInp.enableRainbowColumns") ||
        event.affectsConfiguration("swmmInp.rainbowPalette")
      ) {
        recreateDecorationTypes();
        scheduleRefresh();
      }
    })
  );

  scheduleRefresh();
}

function deactivate() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  for (const decorationType of decorationTypes) {
    decorationType.dispose();
  }
  decorationTypes = [];
}

module.exports = {
  activate,
  deactivate
};
