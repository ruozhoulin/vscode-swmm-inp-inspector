# SWMM INP Inspector

`SWMM INP Inspector` is a VS Code extension for reading large Storm Water Management Model (`.inp`) files.

It adds section-aware context, table-friendly coloring, and identifier occurrence lookup so you can move around complex models quickly.

## Feature overview

- Sticky section context: section headings like `[CONDUITS]` and their immediate `;` header comments stay visible with Sticky Scroll.
- Section quick navigation: jump to any section from Command Palette.
- Rainbow columns: table-like rows are tokenized by column and colored by token index (text color only, no background fill).
- Peek occurrences on click: Ctrl/Cmd+click (Go to Definition) opens Peek with all in-file occurrences of the clicked identifier.

## Quick start

1. Open a SWMM `.inp` file.
2. Confirm the language mode is `SWMM INP`.
3. Use `SWMM INP: Go to Section` from Command Palette.
4. Ctrl/Cmd+click an object ID to open a Peek list of all its in-file occurrences.

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

### 3) Identifier occurrence peek

The definition provider builds a per-document analysis cache that includes:

- parsed rows per line,
- section metadata,
- an identifier occurrence index (`identifier -> all token locations in the document`).

When you Ctrl/Cmd+click a token:

1. The provider identifies the token under cursor.
2. It normalizes the token key (case-insensitive, quote-aware).
3. It returns all matching locations from the occurrence index.
4. VS Code shows them in the Peek Definition panel (language defaults are configured to prefer peek).

## Development (F5)

Press `F5` and select `Run SWMM INP Inspector` to start an Extension Development Host window.

If VS Code prompts to debug `Plain Text`, open this project folder and select the extension-host launch profile in **Run and Debug**.

## Packaging and publishing

- Marketplace metadata lives in `package.json`.
- Marketplace icon is configured by `icon` in `package.json` (current file: `media/logo-epa.png`).
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

## License

This project is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`).  
See the `LICENSE` file for the full license text.

## Known limitations

- Peek results are purely token-based occurrences in the current file (not semantic model validation).
- Very common identifiers (if clicked) can produce large peek result lists.
