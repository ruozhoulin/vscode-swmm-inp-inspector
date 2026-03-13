# SWMM INP Inspector

A lightweight VS Code extension for inspecting Storm Water Management Model (`.inp`) files.

## Features

- Sticky section context: section headings like `[SUBCATCHMENTS]` and the consecutive comment header lines right under them are exposed to Sticky Scroll so section meaning stays visible while you scroll.
- Fast section navigation: run `SWMM INP: Go to Section` from Command Palette to jump to any section.
- Rainbow columns: table-like rows are tokenized by column index (similar to Rainbow CSV) and highlighted with text colors (not background fills). Section header comment rows are included.
- In-document relation navigation: Ctrl+click (Go to Definition) on IDs such as node/link/subcatchment references to jump to their defining sections.

## Usage

1. Open a `.inp` file.
2. Run `SWMM INP: Go to Section` to jump between headings.
3. Use `SWMM INP: Refresh Rainbow Columns` if you want to force a recolor after large edits.
4. Hold `Ctrl` (or `Cmd` on macOS) and click an identifier reference to jump to its related definition.

## Development (F5)

Press `F5` in this project and choose `Run SWMM INP Inspector` to launch an Extension Development Host window.  
If VS Code prompts about debugging `Plain Text`, ensure this workspace is opened and the launch configuration is selected in **Run and Debug**.

## Packaging for Marketplace

- Metadata is configured in `package.json` (`name`, `displayName`, `description`, `publisher`, `version`, keywords).
- Run `npm run package` to build a `.vsix` package with `vsce`.
- Packaging excludes are controlled by `.vscodeignore`.

## Settings

- `swmmInp.enableRainbowColumns` (default: `true`): toggles rainbow column highlighting.
- `swmmInp.rainbowPalette`: array of color strings used for column text colors.

## Notes

- This extension sets language defaults for `[swmm-inp]` to enable sticky scroll with up to 8 sticky lines.
- Consecutive comment lines (`;...`) immediately below a section heading are treated as header context and can be colored with rainbow columns.
