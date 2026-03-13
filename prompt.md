@bellinge.inp This is a typical input file (.inp) of Storm Water Management Model (SWMM). Please create a VS Code extension to help user inspect the file. It is supposed to be similar to Rainbow CSV extensions. The extension should enable:

- The whole file is divided into several sections, each section with a heading wrapped in [*]. Freeze section heading and the subsequent comment lines (start with ;) on the top, so users can know what section does the context belong to when scrolling the window.

- I want users to be able to quickly navigate between different sections.

- Each section it is usually in the format of a table. So I want to highlight different columns with different colors (just like the Rainbow CSV extensions). Normally, you can find headings of the table right below the section heading. Also, please highlight the text rather than the background.

- Implement in-document navigation. For example. the F74F370_F74F360_l1 in the [CONDUITS] section is related to F74F370 and F74F360 in the [JUNCTIONS], [STORAGE], or [OUTFALLS], etc. So user should be able to jump from the conduit section to the node section at the corresponding node using Ctrl+click. There are also other similar relation existed in other sections.
