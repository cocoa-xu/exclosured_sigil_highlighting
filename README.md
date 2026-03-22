# Exclosured Rust Sigil Highlighting

Syntax highlighting and LSP support for Rust code inside `~RUST` sigils in Elixir, used by the [Exclosured](https://github.com/cocoa-xu/exclosured) library.

## Features

### Syntax Highlighting

Rust code inside `~RUST"""..."""` sigils gets full syntax highlighting in your editor.

Supports all Elixir sigil delimiter styles: `"""`, `"`, `[]`, `()`, `{}`.

### LSP Support (VS Code)

- **Completion** — Rust completions from rust-analyzer, prioritised over Elixir suggestions
- **Hover** — type info and documentation on hover
- **Go to Definition** — Cmd/Ctrl+Click to jump to definitions
- **Signature Help** — parameter hints when calling functions
- **Diagnostics** — rust-analyzer errors and warnings shown inline in the Elixir file

The extension generates a hidden `.exclosured/` Cargo workspace with one member per sigil. Each `defwasm` gets its own `Cargo.toml` with the correct `deps:`, so different sigils can use different crate versions without conflicts.

### defwasm Context Awareness

The extension parses `defwasm` declarations to provide rust-analyzer with proper type context:

```elixir
defwasm :render_stats_card, args: [data: :binary], deps: [maud: "0.26"] do
  ~RUST"""
  use maud::html;
  let markup = html! { div { "hello" } };
  # ← rust-analyzer knows `data: &mut [u8]` and can resolve `maud::html`
  """
end
```

Supported `deps:` formats:

| Format | Example |
|--------|---------|
| Atom key | `deps: [maud: "0.26"]` |
| String key | `deps: ["pulldown-cmark": "0.12"]` |
| Tuple | `deps: [{"serde", "1"}]` |
| Tuple + features | `deps: [{"serde", "1", features: ["derive"]}]` |

## Installation

### VS Code

**From GitHub Releases:**

Download the `.vsix` file from [Releases](https://github.com/cocoa-xu/exclosured_sigil_highlighting/releases), then:

```sh
code --install-extension exclosured-rust-sigil-*.vsix
```

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

Requires `nvim-treesitter` with Elixir and Rust parsers installed.

### Traditional Vim

```vim
set runtimepath+=~/path/to/exclosured_sigil_highlighting/vim
```

## Contributing

See [developer.md](developer.md) for build, test, and local development instructions.

## License

MIT
