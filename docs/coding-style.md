# Bananabox Coding Style

Bananabox Coding Style shows Epitech coding-style diagnostics in VS Code using `epiclang`.
It checks files while you type, marks violations in the editor and can suggest
or apply C layout corrections when you save.

## Getting started

Install epiclang on the machine that hosts your workspace. For WSL or Remote SSH,
that means the remote machine. Install the extension through **Extensions → … →
Install from VSIX…**, then open a C project.

Checks are enabled by default. After a 600 ms pause in typing, Bananabox Coding Style checks
the current buffer, including unsaved changes. It also checks files when they
open or save. If epiclang cannot be found, use **Bananabox Coding Style: Locate the epiclang
executable** or set `bananalens.compiler` to its full path.

Most projects need no configuration: the extension finds headers and reads build
flags from `compile_commands.json` or the Makefile. Corrections are off until you
choose a correction mode.

## Reading diagnostics

Violations appear inline and in VS Code's Problems panel. Hover over a finding
for its full message, rule identifier and related compiler notes. Underlines use
the range reported by clang, or the relevant token, line or trailing whitespace.

The summary below the file header shows severity counts and actions to review
findings, recheck the file and choose a correction mode. It occupies an existing
blank line; when there is none, the summary appears as a CodeLens above the code.
Hover shows timing, compiler findings and whether a check is pending or failed.
The status bar also shows the current file's summary.

Use **Show the violations of this file** for a list grouped by rule family, or
**Go to next violation** and **Go to previous violation** to navigate. Trailing
whitespace findings have quick fixes for one line or the entire file.
**Check the whole project** checks matching files with progress and cancellation.
All of these commands are prefixed with **Bananabox Coding Style:** in the Command Palette.

## Corrections

Run **Bananabox Coding Style: Choose correction mode** from the Command Palette or the
editor's Bananabox Coding Style context menu.

| Mode | On save |
| --- | --- |
| Off (`off`, default) | Keep checking; leave the source unchanged. |
| Suggestion (`suggest`) | Show a description of the proposed changes, with **View diff** and **Apply** actions. |
| Automatic (`onSave`) | Apply the verified changes as part of the save. |

In Suggestion mode, accept with **Ctrl+Alt+Enter** (**Cmd+Alt+Enter** on macOS) or
dismiss with **Escape**. Accepted edits remain unsaved and can be undone. Editing
the document invalidates its pending proposal. Tab keeps its normal behaviour.
Automatic mode also participates in VS Code Auto Save. Avoid using another
format-on-save provider with a conflicting style on the same document.

Corrections work on `.c` and `.h` files opened in C mode. They respect workspace
trust, exclusions and the extension's enable switch. C++ documents and untitled
buffers are not corrected.

The extension uses a compatible local clang-format 14 to 21, or downloads a verified
clang-format 21 into extension storage. The first download needs access to
GitHub. Preparation runs in the background; saves proceed unchanged until the
formatter is ready. Failures appear in the status bar and **Output → Bananabox Coding Style**.
To supply your own executable, set `bananalens.corrections.clangFormat`.

### What can be corrected

The layout profile follows the bundled Epitech coding style v7.1.

| Rules | Coverage |
| --- | --- |
| C-G1 | Add a missing Epitech header using the year, project folder and filename. Existing headers are preserved. |
| C-G2, C-G3 | Separate function definitions and indent nested preprocessor directives. |
| C-G6, C-G7, C-G8, C-A3 | Normalize line endings, trailing whitespace and leading or trailing blank lines outside protected content. |
| C-L1, C-L2, C-L3 | Split ordinary statements and control bodies; adjust indentation and spacing. |
| C-L4, C-L7 | Place braces and space pointer declarations using the clang-format profile. |
| C-L6 | Remove unnecessary blank lines after instructions, preserving declaration separators and ambiguous bodies. |
| C-F3 | Wrap lines where possible within 79 columns plus newline, preserving long literals and comments. |

Moving declarations, inserting missing declaration separators, naming, function
length, complexity, include guards, API changes and architecture still need manual
work. The formatter does not add or remove braces, reorder includes, split string
literals or rewrite expressions. In particular, it does not change `f()` to
`f(void)`.

Before a proposal is offered or applied, epiclang checks the original and the
candidate. New diagnostic occurrences or incomplete checks reject the proposal.
This includes warnings hidden by display filters and findings in included
headers. An unavailable compiler, cancellation or an expired time budget leaves
the save unchanged. Existing compiler errors can also prevent suggestions.

Uppercase macro calls and function-like macros defined in the current file keep
their argument whitespace. List imported lowercase macros that stringify
arguments in `bananalens.corrections.whitespaceSensitiveMacros`:

```json
{
  "bananalens.corrections.mode": "suggest",
  "bananalens.corrections.whitespaceSensitiveMacros": ["stringify"]
}
```

Files with line splicing, trigraphs, digraphs, universal-character escapes,
`__LINE__`, `#line`, formatter on/off markers or unterminated literals/comments
are skipped. Indirect line-number macros and other whitespace-dependent macros
need review; use Suggestion or Off for those files. See the
[development guide](development.md) for the checks and resource limits.

## Appearance

Run **Bananabox Coding Style: Customize lenses and colours** to preview changes, select User,
Workspace or Workspace folder scope, then **Apply changes**. **Reset appearance**
removes overrides at the selected scope.

You can choose which parts of each message are visible, adjust spacing and
message limits, toggle bold or italic text, and set foreground, background and
underline colours per severity. Colours accept `#RRGGBB` or `#RRGGBBAA`; choosing
**Theme** restores theme colours. Fatal, Major, Minor and Info default to coral,
amber, cyan and lavender, with light and high-contrast variants.

Compact mode shows the level; Full also shows the rule and message. Visibility
controls can override either mode. The most severe messages appear first when
several findings share a line; hover always contains all findings. Appearance
changes redraw the editor without rerunning epiclang.

Bananabox Coding Style supplies `errorLens.excludeBySource: ["Banana", "epiclang"]` as a
default to avoid duplicate inline messages. If you already have a custom list,
add these two sources. To use Error Lens for rendering instead, remove them and
keep `bananalens.inline.preferErrorLens: true`. Native diagnostics and quick fixes
remain available.

All appearance controls are also under `bananalens.inline.*` in Settings. Theme
overrides use `workbench.colorCustomizations` with keys such as
`bananalens.inline.majorForeground`, `majorBackground` and `majorUnderline`.
Explicit `bananalens.inline.colors.*` settings take precedence over theme values,
including high-contrast themes. Foreground and background also colour the summary
badge; native squiggles retain VS Code's colours.

## Project configuration

The project root is the nearest directory containing `.bananalens.json`, then the
nearest Git repository, then the topmost directory with a Makefile or compilation
database within the workspace. A nested `lib/my/Makefile` does not take over the
root of a Git project.

Compiler flags are selected in this order:

1. An explicit `command` or `args` in `.bananalens.json`.
2. A matching `compile_commands.json` entry, run through epiclang.
3. `make -nB`, if explicitly enabled.
4. Flags read from the Makefile and discovered header directories, with `include/`
   first among discovered directories.

Normal Makefile reading does not execute make. The optional dry run can execute
Makefile `$(shell)` expressions. Build and linker flags such as `-o`, `-c`, `-O*`,
`-MMD`, `-MF`, `-L`, `-l` and `-Werror` are removed from imported build commands.
Additional arguments supplied explicitly remain your responsibility.

For extra include paths, defines or exclusions, add `.bananalens.json` at the
project root. Comments and trailing commas are accepted; a JSON schema provides
completion.

```jsonc
{
  "includePaths": ["lib/my/include"],
  "extraArgs": ["-DDEBUG"],
  "exclude": ["tests/**", "bonus/**"]
}
```

Other fields include `compiler`, `command`, `args`, `autoIncludes`, `env`,
`ignoreWarnings`, `make` and `inline`. Command templates accept `{file}`,
`{fileBasename}`, `{project}` and `{workspace}`. Explicit `args` bypass automatic
flag discovery. See the [schema](../schemas/bananalens.schema.json) and
[example configuration](example.bananalens.json).

### Common settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `bananalens.enabled` | `true` | Enable checks and corrections. |
| `bananalens.compiler` | `epiclang` | Compiler name or full path. |
| `bananalens.runOnSave`, `runOnOpen`, `runOnType` | `true` | Automatic check triggers. |
| `bananalens.debounceMs` | `600` | Pause after typing before checking. |
| `bananalens.autoIncludes`, `useMakefile`, `useCompileCommands` | `true` | Discover include paths and build flags. |
| `bananalens.extraArgs`, `includePaths` | `[]` | Additional compiler flags and include directories. |
| `bananalens.exclude` | node_modules, .git, .vscode | File globs to skip. |
| `bananalens.inline.mode` | `full` | Full, compact or no inline messages. |
| `bananalens.summary.position` | `afterHeader` | Summary below the header or at the top. |
| `bananalens.summary.attribution` | `false` | Show the optional author lens. |
| `bananalens.maxConcurrency` | `0` | Compiler jobs; zero selects 1 to 4 based on available CPUs. |
| `bananalens.timeoutMs` | `30000` | Compiler timeout. |
| `bananalens.ruleDocUrl` | empty | Rule-link template containing `{rule}`. |
| `bananalens.verbose` | `false` | Log full compiler commands. |

Settings can be scoped to a workspace or folder where supported. Existing
explicit settings remain in effect when updating.

## Troubleshooting

For missing headers, check the detected root and compiler command in
**Output → Bananabox Coding Style** with verbose logging enabled. After changing build files,
use **Refresh build configuration** if a result appears stale.

Use **Clear all diagnostics** to clear findings, **Enable / disable** to toggle
checking, and **Show output** to inspect failures. If corrections do not appear,
check the selected mode, formatter preparation status, exclusions and compiler
errors. Protected constructs and verification failures can legitimately leave a
file unchanged.

## Development

The coding-style sources live in `src/codingStyle`. Run `npm run test:coding-style` for their tests, `npm test` for all Bananabox tests, and `npm run package` to create `bananabox-<version>.vsix` with both MyEpitech and coding-style features.

The original Banana Lens engine is distributed under its [MIT license](../licenses/Banana-Lens.txt).

Toggle inline BananaLens messages with **Ctrl+Alt+L** (**Cmd+Alt+L** on macOS), or use **Bananabox Coding Style: Toggle Inline Error Lenses**. This keeps diagnostics and analysis enabled and restores the previous compact/full display.
