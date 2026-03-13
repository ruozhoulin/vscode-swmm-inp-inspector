# SWMM INP Inspector

A lightweight VS Code extension for inspecting Storm Water Management Model (`.inp`) files.

## Features

- Sticky section context: section headings like `[SUBCATCHMENTS]` are exposed as document symbols so VS Code Sticky Scroll can pin the current section while you scroll.
- Fast section navigation: run `SWMM INP: Go to Section` from Command Palette to jump to any section.
- Rainbow columns: table-like rows are tokenized by whitespace and highlighted by column index (similar to Rainbow CSV).

## Usage

1. Open a `.inp` file.
2. Run `SWMM INP: Go to Section` to jump between headings.
3. Use `SWMM INP: Refresh Rainbow Columns` if you want to force a recolor after large edits.

## Development (F5)

Press `F5` in this project and choose `Run SWMM INP Inspector` to launch an Extension Development Host window.  
If VS Code prompts about debugging `Plain Text`, ensure this workspace is opened and the launch configuration is selected in **Run and Debug**.

## Settings

- `swmmInp.enableRainbowColumns` (default: `true`): toggles rainbow column highlighting.
- `swmmInp.rainbowPalette`: array of color strings used for column backgrounds.

## Notes

- This extension sets language defaults for `[swmm-inp]` to enable sticky scroll and keep one sticky line.
- Comment lines starting with `;`, blank lines, and section heading lines are excluded from rainbow highlighting.
