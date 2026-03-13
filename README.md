# SWMM INP Inspector

`SWMM INP Inspector` is a VS Code extension for reading large Storm Water Management Model (`.inp`) files.

It adds section-aware context, table-friendly coloring, and cross-reference navigation so you can move around complex models quickly.

## Feature overview

- Sticky section context: section headings like `[CONDUITS]` and their immediate `;` header comments stay visible with Sticky Scroll.
- Section quick navigation: jump to any section from Command Palette.
- Rainbow columns: table-like rows are tokenized by column and colored by token index (text color only, no background fill).
- Relation navigation: Ctrl/Cmd+click (Go to Definition) on IDs to jump to referenced entities across sections.

## Quick start

1. Open a SWMM `.inp` file.
2. Confirm the language mode is `SWMM INP`.
3. Use `SWMM INP: Go to Section` from Command Palette.
4. Ctrl/Cmd+click IDs (for example node/link IDs) to navigate to their definitions.

## Commands

- `SWMM INP: Go to Section`
- `SWMM INP: Refresh Rainbow Columns`

## Settings

- `swmmInp.enableRainbowColumns` (boolean, default `true`)  
  Enable or disable rainbow token coloring.
- `swmmInp.rainbowPalette` (string[])  
  Ordered list of text colors; column color is `columnIndex % palette.length`.

## How the extension works

### 1) Section parsing and sticky context

- Sections are detected with `[SECTION]` heading lines.
- Each section range ends at the line before the next section heading.
- Consecutive `;` comment lines immediately below a section heading are treated as header context.
- Document symbols are emitted as a nested tree: section symbol -> header comment symbols.  
  This allows Sticky Scroll to pin both the section name and explanatory comment lines.

### 2) Rainbow column highlighting

- For normal data rows, tokens are split by whitespace while preserving quoted strings.
- For section header comment rows (for example `;;Name  From Node  To Node`), tokens are split using 2+ spaces to keep multi-word labels together.
- Section headings, blank lines, and non-header comment lines are ignored.
- Decorations are refreshed on document edits, active editor changes, visible editor changes, and palette setting changes.

### 3) In-document relation navigation

The definition provider builds a per-document analysis cache that includes:

- parsed rows per line,
- section metadata,
- canonical entity indexes (nodes, links, subcatchments, raingages, curves, patterns).

Navigation resolution strategy:

1. Apply section/column-specific relation rules where available.
2. If no rule exists and the token is not itself a definition token, fall back to searching all indexed entity types.
3. Filter duplicate/self locations and return one or multiple jump targets.

Examples of built-in relation rules:

- `[CONDUITS]`, `[PUMPS]`, `[ORIFICES]`, `[WEIRS]`, `[OUTLETS]`: `From Node`/`To Node` -> node definitions.
- `[XSECTIONS]`, `[LOSSES]`, `[VERTICES]`: first token (`Link`) -> link definitions.
- `[SUBCATCHMENTS]`: `Rain Gage` -> raingage, `Outlet` -> node/subcatchment.
- `[DWF]`: node token -> node definitions; pattern tokens -> pattern definitions.
- `[STORAGE]`: tabular curve parameter -> curve definitions.
- `[TAGS]`: second token resolves by first-token tag type (`NODE`, `LINK`, `SUBCATCH`, etc.).

## Development (F5)

Press `F5` and select `Run SWMM INP Inspector` to start an Extension Development Host window.

If VS Code prompts to debug `Plain Text`, open this project folder and select the extension-host launch profile in **Run and Debug**.

## Packaging and publishing

- Marketplace metadata lives in `package.json`.
- Excluded package content is controlled by `.vscodeignore`.
- Build a package with:

```bash
npm run package
```

- Publish with `vsce` (after publisher setup and login):

```bash
npx @vscode/vsce login <publisher-id>
npx @vscode/vsce publish
```

## Known limitations

- Relation navigation depends on SWMM table conventions and may not resolve every custom modeling pattern.
- When an identifier exists in multiple entity categories, VS Code may show multiple definition targets.
