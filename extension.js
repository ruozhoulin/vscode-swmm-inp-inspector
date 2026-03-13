/**
 * SWMM INP Inspector extension entrypoint.
 *
 * This file intentionally keeps all logic in one place for maintainability in
 * small extensions. The implementation is organized into three subsystems:
 * 1) section parsing + sticky context symbols,
 * 2) rainbow column decorations,
 * 3) Ctrl/Cmd+click relation navigation (definition provider).
 */
const vscode = require("vscode");

const SECTION_PATTERN = /^\s*\[([^\]]+)\]\s*$/;
const COMMENT_PATTERN = /^\s*;/;
const DEFAULT_PALETTE = [
  "#E06C75",
  "#D19A66",
  "#E5C07B",
  "#98C379",
  "#56B6C2",
  "#61AFEF",
  "#C678DD",
  "#ABB2BF"
];
const ENTITY_TYPES = Object.freeze({
  NODE: "NODE",
  LINK: "LINK",
  SUBCATCH: "SUBCATCH",
  RAINGAGE: "RAINGAGE",
  CURVE: "CURVE",
  PATTERN: "PATTERN"
});
// Sections whose first data column defines IDs for a canonical entity type.
const DEFINITION_SECTION_TYPES = new Map([
  ["JUNCTIONS", ENTITY_TYPES.NODE],
  ["OUTFALLS", ENTITY_TYPES.NODE],
  ["STORAGE", ENTITY_TYPES.NODE],
  ["DIVIDERS", ENTITY_TYPES.NODE],
  ["CONDUITS", ENTITY_TYPES.LINK],
  ["PUMPS", ENTITY_TYPES.LINK],
  ["ORIFICES", ENTITY_TYPES.LINK],
  ["WEIRS", ENTITY_TYPES.LINK],
  ["OUTLETS", ENTITY_TYPES.LINK],
  ["SUBCATCHMENTS", ENTITY_TYPES.SUBCATCH],
  ["RAINGAGES", ENTITY_TYPES.RAINGAGE],
  ["CURVES", ENTITY_TYPES.CURVE],
  ["PATTERNS", ENTITY_TYPES.PATTERN]
]);
// [TAGS] first column values map to canonical entity categories.
const TAG_TYPE_TO_ENTITY_TYPE = new Map([
  ["NODE", ENTITY_TYPES.NODE],
  ["JUNCTION", ENTITY_TYPES.NODE],
  ["OUTFALL", ENTITY_TYPES.NODE],
  ["STORAGE", ENTITY_TYPES.NODE],
  ["DIVIDER", ENTITY_TYPES.NODE],
  ["LINK", ENTITY_TYPES.LINK],
  ["CONDUIT", ENTITY_TYPES.LINK],
  ["PUMP", ENTITY_TYPES.LINK],
  ["ORIFICE", ENTITY_TYPES.LINK],
  ["WEIR", ENTITY_TYPES.LINK],
  ["OUTLET", ENTITY_TYPES.LINK],
  ["SUBCATCH", ENTITY_TYPES.SUBCATCH],
  ["SUBCATCHMENT", ENTITY_TYPES.SUBCATCH],
  ["GAGE", ENTITY_TYPES.RAINGAGE],
  ["RAINGAGE", ENTITY_TYPES.RAINGAGE],
  ["CURVE", ENTITY_TYPES.CURVE],
  ["PATTERN", ENTITY_TYPES.PATTERN]
]);

/** @type {vscode.TextEditorDecorationType[]} */
let decorationTypes = [];
/** @type {NodeJS.Timeout | undefined} */
let refreshTimer;
/** @type {Map<string, {version: number, analysis: DocumentAnalysis}>} */
const analysisCache = new Map();

/**
 * Feeds Outline/Document Symbols and sticky-scroll section context.
 */
class SwmmSectionSymbolProvider {
  /**
   * @param {vscode.TextDocument} document
   * @returns {vscode.ProviderResult<vscode.DocumentSymbol[]>}
   */
  provideDocumentSymbols(document) {
    const sections = getDocumentAnalysis(document).sections;
    return sections.map((section) => createSectionSymbol(document, section));
  }
}

/**
 * Enables folding by SWMM sections.
 */
class SwmmSectionFoldingProvider {
  /**
   * @param {vscode.TextDocument} document
   * @returns {vscode.ProviderResult<vscode.FoldingRange[]>}
   */
  provideFoldingRanges(document) {
    return getDocumentAnalysis(document)
      .sections
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
 * Implements Ctrl/Cmd+click "Go to Definition" for SWMM cross references.
 */
class SwmmDefinitionProvider {
  /**
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @returns {vscode.ProviderResult<vscode.Location | vscode.Location[]>}
   */
  provideDefinition(document, position) {
    const analysis = getDocumentAnalysis(document);
    const row = analysis.rowsByLine.get(position.line);
    if (!row) {
      return undefined;
    }

    const tokenIndex = row.tokens.findIndex(
      (token) =>
        position.character >= token.start && position.character < token.end
    );
    if (tokenIndex < 0) {
      return undefined;
    }

    const token = row.tokens[tokenIndex];
    if (!isIdentifierValue(token.value)) {
      return undefined;
    }

    // Candidate resolution strategy:
    // 1) use section/column-specific relation rules when available,
    // 2) otherwise fall back to matching the token across all indexed entity types.
    const idKey = toIdentifierKey(token.value);
    const preferredEntityTypes = getReferenceEntityTypesForToken(row, tokenIndex);
    const isDefinitionToken =
      tokenIndex === 0 && DEFINITION_SECTION_TYPES.has(row.sectionKey);

    /** @type {vscode.Location[]} */
    let candidates = [];
    if (preferredEntityTypes.length > 0) {
      for (const entityType of preferredEntityTypes) {
        candidates.push(
          ...getEntityLocations(analysis.entityIndexByType, entityType, idKey)
        );
      }
    } else if (!isDefinitionToken) {
      candidates = getAllEntityLocations(analysis.entityIndexByType, idKey);
    }

    // Do not navigate to the same token location the user clicked.
    const filtered = uniqueLocations(
      candidates.filter(
        (location) =>
          !(
            location.range.start.line === row.line &&
            location.range.start.character === token.start &&
            location.range.end.character === token.end
          )
      )
    );
    if (!filtered.length) {
      return undefined;
    }

    return filtered.length === 1 ? filtered[0] : filtered;
  }
}

/**
 * @typedef {{
 *   name: string,
 *   line: number,
 *   endLine: number,
 *   headerCommentLines: number[]
 * }} SectionInfo
 */
/**
 * @typedef {{
 *   value: string,
 *   start: number,
 *   end: number
 * }} ParsedToken
 */
/**
 * @typedef {{
 *   sectionName: string,
 *   sectionKey: string,
 *   line: number,
 *   tokens: ParsedToken[]
 * }} ParsedRow
 */
/**
 * @typedef {{
 *   sections: SectionInfo[],
 *   rowsByLine: Map<number, ParsedRow>,
 *   entityIndexByType: Map<string, Map<string, vscode.Location[]>>
 * }} DocumentAnalysis
 */

/**
 * @param {vscode.TextDocument} document
 * @returns {SectionInfo[]}
 */
function parseSections(document) {
  /** @type {SectionInfo[]} */
  const sections = [];

  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    const match = text.match(SECTION_PATTERN);
    if (!match) {
      continue;
    }
    sections.push({
      name: match[1].trim(),
      line,
      endLine: document.lineCount - 1,
      headerCommentLines: []
    });
  }

  sections.forEach((section, index) => {
    const next = sections[index + 1];
    // Section boundaries are derived from consecutive heading lines.
    section.endLine = next ? next.line - 1 : document.lineCount - 1;
    section.headerCommentLines = getHeaderCommentLines(document, section);
  });

  return sections;
}

/**
 * @returns {Map<string, Map<string, vscode.Location[]>>}
 */
function createEntityIndex() {
  return new Map([
    [ENTITY_TYPES.NODE, new Map()],
    [ENTITY_TYPES.LINK, new Map()],
    [ENTITY_TYPES.SUBCATCH, new Map()],
    [ENTITY_TYPES.RAINGAGE, new Map()],
    [ENTITY_TYPES.CURVE, new Map()],
    [ENTITY_TYPES.PATTERN, new Map()]
  ]);
}

/**
 * @param {Map<string, Map<string, vscode.Location[]>>} entityIndexByType
 * @param {string} entityType
 * @param {string} idKey
 * @param {vscode.Location} location
 */
function addEntityLocation(entityIndexByType, entityType, idKey, location) {
  const index = entityIndexByType.get(entityType);
  if (!index) {
    return;
  }
  const existing = index.get(idKey) || [];
  existing.push(location);
  index.set(idKey, existing);
}

/**
 * @param {Map<string, Map<string, vscode.Location[]>>} entityIndexByType
 * @param {string} entityType
 * @param {string} idKey
 * @returns {vscode.Location[]}
 */
function getEntityLocations(entityIndexByType, entityType, idKey) {
  return entityIndexByType.get(entityType)?.get(idKey) || [];
}

/**
 * @param {Map<string, Map<string, vscode.Location[]>>} entityIndexByType
 * @param {string} idKey
 * @returns {vscode.Location[]}
 */
function getAllEntityLocations(entityIndexByType, idKey) {
  /** @type {vscode.Location[]} */
  const all = [];
  for (const index of entityIndexByType.values()) {
    const matches = index.get(idKey);
    if (matches) {
      all.push(...matches);
    }
  }
  return all;
}

/**
 * @param {vscode.Location[]} locations
 * @returns {vscode.Location[]}
 */
function uniqueLocations(locations) {
  const seen = new Set();
  return locations.filter((location) => {
    const key = `${location.range.start.line}:${location.range.start.character}:${location.range.end.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * @param {vscode.TextDocument} document
 * @param {SectionInfo} section
 * @returns {number[]}
 */
function getHeaderCommentLines(document, section) {
  /** @type {number[]} */
  const lines = [];

  for (let line = section.line + 1; line <= section.endLine; line += 1) {
    const text = document.lineAt(line).text;
    if (!COMMENT_PATTERN.test(text)) {
      break;
    }
    lines.push(line);
  }

  return lines;
}

/**
 * @param {vscode.TextDocument} document
 * @param {SectionInfo} section
 * @returns {vscode.DocumentSymbol}
 */
function createSectionSymbol(document, section) {
  const headingText = document.lineAt(section.line).text;
  const endText = document.lineAt(section.endLine).text;
  const sectionSelectionRange = new vscode.Range(
    section.line,
    0,
    section.line,
    headingText.length
  );
  const sectionRange = new vscode.Range(
    section.line,
    0,
    section.endLine,
    endText.length
  );
  const sectionSymbol = new vscode.DocumentSymbol(
    section.name,
    `Line ${section.line + 1}`,
    vscode.SymbolKind.Namespace,
    sectionRange,
    sectionSelectionRange
  );

  // Build nested children for each immediate header comment line so VS Code
  // sticky scroll can pin "[SECTION]" followed by those explanatory comments.
  let parent = sectionSymbol;
  for (const commentLine of section.headerCommentLines) {
    const commentText = document.lineAt(commentLine).text;
    const commentSelectionRange = new vscode.Range(
      commentLine,
      0,
      commentLine,
      commentText.length
    );
    const commentRange = new vscode.Range(
      commentLine,
      0,
      section.endLine,
      endText.length
    );
    const commentSymbol = new vscode.DocumentSymbol(
      commentText.trim() || ";",
      `Line ${commentLine + 1}`,
      vscode.SymbolKind.String,
      commentRange,
      commentSelectionRange
    );
    parent.children.push(commentSymbol);
    parent = commentSymbol;
  }

  return sectionSymbol;
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
 * @param {string} value
 * @returns {string}
 */
function normalizeIdentifier(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * @param {string} value
 * @returns {string}
 */
function toIdentifierKey(value) {
  return normalizeIdentifier(value).toUpperCase();
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isNumericValue(value) {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isIdentifierValue(value) {
  const normalized = normalizeIdentifier(value);
  return normalized.length > 0 && !isNumericValue(normalized);
}

/**
 * @param {string} line
 * @returns {{offset: number, content: string}}
 */
function stripLeadingCommentMarker(line) {
  const match = line.match(/^(\s*;+\s*)(.*)$/);
  if (!match) {
    return {
      offset: 0,
      content: line
    };
  }
  return {
    offset: match[1].length,
    content: match[2]
  };
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
 * Tokenize table header comment lines where labels are separated by 2+ spaces.
 * @param {string} line
 * @returns {{start: number, end: number}[]}
 */
function tokenizeHeaderColumns(line) {
  /** @type {{start: number, end: number}[]} */
  const tokens = [];
  const matcher = /\S(?:.*?\S)?(?=\s{2,}|$)/g;
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
 * @param {string} line
 * @returns {ParsedToken[]}
 */
function parseDataRowTokens(line) {
  const content = stripInlineComment(line);
  return tokenizeColumns(content).map((token) => ({
    value: content.slice(token.start, token.end),
    start: token.start,
    end: token.end
  }));
}

/**
 * @param {vscode.TextDocument} document
 * @returns {DocumentAnalysis}
 */
function buildDocumentAnalysis(document) {
  const sections = parseSections(document);
  /** @type {Map<number, ParsedRow>} */
  const rowsByLine = new Map();
  const entityIndexByType = createEntityIndex();

  // Parse once per document version and build both:
  // - line -> parsed row lookup (for hover position/token lookup),
  // - entity indexes (for cross-reference resolution).
  for (const section of sections) {
    const sectionKey = section.name.toUpperCase();
    for (let line = section.line + 1; line <= section.endLine; line += 1) {
      const text = document.lineAt(line).text;
      const trimmed = text.trim();

      if (!trimmed || COMMENT_PATTERN.test(trimmed) || SECTION_PATTERN.test(trimmed)) {
        continue;
      }

      const tokens = parseDataRowTokens(text);
      if (!tokens.length) {
        continue;
      }

      rowsByLine.set(line, {
        sectionName: section.name,
        sectionKey,
        line,
        tokens
      });

      const definitionEntityType = DEFINITION_SECTION_TYPES.get(sectionKey);
      if (!definitionEntityType) {
        continue;
      }

      const idToken = tokens[0];
      if (!idToken || !isIdentifierValue(idToken.value)) {
        continue;
      }

      addEntityLocation(
        entityIndexByType,
        definitionEntityType,
        toIdentifierKey(idToken.value),
        new vscode.Location(
          document.uri,
          new vscode.Range(line, idToken.start, line, idToken.end)
        )
      );
    }
  }

  return {
    sections,
    rowsByLine,
    entityIndexByType
  };
}

/**
 * @param {vscode.TextDocument} document
 * @returns {DocumentAnalysis}
 */
function getDocumentAnalysis(document) {
  const key = document.uri.toString();
  const cached = analysisCache.get(key);
  if (cached && cached.version === document.version) {
    return cached.analysis;
  }
  const analysis = buildDocumentAnalysis(document);
  analysisCache.set(key, {
    version: document.version,
    analysis
  });
  return analysis;
}

/**
 * @param {vscode.TextDocument} document
 */
function clearDocumentAnalysis(document) {
  analysisCache.delete(document.uri.toString());
}

/**
 * @param {ParsedRow} row
 * @param {number} tokenIndex
 * @returns {string[]}
 */
function getReferenceEntityTypesForToken(row, tokenIndex) {
  const sectionKey = row.sectionKey;
  const tokens = row.tokens;

  // Token positions are based on SWMM section table conventions.
  // If no case matches, caller falls back to broad ID matching.
  switch (sectionKey) {
    case "CONDUITS":
    case "PUMPS":
    case "ORIFICES":
    case "WEIRS":
    case "OUTLETS":
      if (tokenIndex === 1 || tokenIndex === 2) {
        return [ENTITY_TYPES.NODE];
      }
      if (sectionKey === "PUMPS" && tokenIndex === 3) {
        return [ENTITY_TYPES.CURVE];
      }
      if (sectionKey === "OUTLETS" && tokenIndex === 5) {
        return [ENTITY_TYPES.CURVE];
      }
      return [];

    case "SUBCATCHMENTS":
      if (tokenIndex === 1) {
        return [ENTITY_TYPES.RAINGAGE];
      }
      if (tokenIndex === 2) {
        return [ENTITY_TYPES.NODE, ENTITY_TYPES.SUBCATCH];
      }
      return [];

    case "SUBAREAS":
    case "INFILTRATION":
    case "POLYGONS":
      return tokenIndex === 0 ? [ENTITY_TYPES.SUBCATCH] : [];

    case "XSECTIONS":
    case "LOSSES":
    case "VERTICES":
      return tokenIndex === 0 ? [ENTITY_TYPES.LINK] : [];

    case "COORDINATES":
    case "DWF":
      if (tokenIndex === 0) {
        return [ENTITY_TYPES.NODE];
      }
      if (sectionKey === "DWF" && tokenIndex >= 3) {
        return [ENTITY_TYPES.PATTERN];
      }
      return [];

    case "STORAGE":
      if (tokenIndex === 5) {
        const shape = normalizeIdentifier(tokens[4]?.value || "").toUpperCase();
        if (shape === "TABULAR") {
          return [ENTITY_TYPES.CURVE];
        }
      }
      return [];

    case "OUTFALLS":
      return tokenIndex === 5 ? [ENTITY_TYPES.NODE] : [];

    case "TAGS":
      if (tokenIndex !== 1) {
        return [];
      }
      const tagType = normalizeIdentifier(tokens[0]?.value || "").toUpperCase();
      const entityType = TAG_TYPE_TO_ENTITY_TYPE.get(tagType);
      return entityType ? [entityType] : [];

    default:
      return [];
  }
}

/**
 * @param {number} paletteSize
 * @param {vscode.TextDocument} document
 * @returns {vscode.Range[][]}
 */
function buildRainbowRanges(paletteSize, document) {
  /** @type {vscode.Range[][]} */
  const rangesByColor = Array.from({ length: paletteSize }, () => []);
  const sections = getDocumentAnalysis(document).sections;
  const headerCommentLines = new Set(
    sections.flatMap((section) => section.headerCommentLines)
  );

  for (let line = 0; line < document.lineCount; line += 1) {
    const original = document.lineAt(line).text;
    const trimmed = original.trim();

    if (!trimmed) {
      continue;
    }
    if (SECTION_PATTERN.test(trimmed)) {
      continue;
    }

    /** @type {{start: number, end: number}[]} */
    let tokens = [];
    if (headerCommentLines.has(line)) {
      // For ";;Name   From Node   To Node" style lines, tokenization uses
      // 2+ spaces as separators to preserve multi-word header labels.
      const header = stripLeadingCommentMarker(original);
      tokens = tokenizeHeaderColumns(header.content).map((token) => ({
        start: token.start + header.offset,
        end: token.end + header.offset
      }));
    } else {
      if (COMMENT_PATTERN.test(trimmed)) {
        continue;
      }
      const content = stripInlineComment(original);
      tokens = tokenizeColumns(content);
    }

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
      color
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

  // Debounce updates to avoid heavy re-decoration on rapid edits.
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

  const sections = getDocumentAnalysis(editor.document).sections;
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

  // Core language features.
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
    vscode.languages.registerDefinitionProvider(
      { language: "swmm-inp" },
      new SwmmDefinitionProvider()
    )
  );
  // User-facing commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("swmmInp.goToSection", goToSection)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "swmmInp.refreshRainbowColumns",
      refreshVisibleEditors
    )
  );

  // Refresh hooks for editor/doc/config changes.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(scheduleRefresh)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(scheduleRefresh)
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "swmm-inp") {
        clearDocumentAnalysis(event.document);
        scheduleRefresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearDocumentAnalysis(document);
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
  analysisCache.clear();
}

module.exports = {
  activate,
  deactivate
};
