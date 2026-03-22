# Developer Guide

## Prerequisites

- Node.js >= 18
- npm

## VS Code Extension

### Build

```sh
cd vscode
npm install
npm run compile
```

### Run Tests

```sh
cd vscode
npm test
```

### Load Locally in VS Code

**Option A — Extension Development Host (recommended for development):**

```sh
cd vscode
code --extensionDevelopmentPath="$(pwd)"
```

This opens a new VS Code window with the extension loaded. Changes to TypeScript
require `npm run compile` and reloading the window (`Cmd+Shift+P` → "Reload Window").

**Option B — Symlink into extensions directory:**

```sh
cd vscode
ln -s "$(pwd)" ~/.vscode/extensions/exclosured-rust-sigil
```

Restart VS Code to pick up the extension.

**Option C — Install a .vsix package:**

```sh
cd vscode
npm install -g @vscode/vsce
vsce package                  # produces exclosured-rust-sigil-*.vsix
code --install-extension exclosured-rust-sigil-*.vsix
```

### Watch Mode

For active development, run the TypeScript compiler in watch mode:

```sh
cd vscode
npm run watch
```

Then use `Cmd+Shift+P` → "Reload Window" in the Extension Development Host
after each change.

## Vim / Neovim

No build step needed. Add the `vim/` directory to your runtime path.

### Neovim (Tree-sitter)

With [lazy.nvim](https://github.com/folke/lazy.nvim):

```lua
{
  "cocoa-xu/exclosured_sigil_highlighting",
  config = function(plugin)
    vim.opt.rtp:append(plugin.dir .. "/vim")
  end,
}
```

Requires `nvim-treesitter` with the Elixir and Rust parsers installed.

### Traditional Vim

```vim
" In your .vimrc
set runtimepath+=~/path/to/exclosured_sigil_highlighting/vim
```

Requires Rust syntax files to be available (ships with Vim).
