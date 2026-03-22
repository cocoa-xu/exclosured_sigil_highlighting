" Syntax highlighting for Rust code inside ~RUST sigils in Elixir files.
" Works with traditional Vim (no Tree-sitter required).

if exists('b:exclosured_rust_sigil_loaded')
  finish
endif
let b:exclosured_rust_sigil_loaded = 1

" Include Rust syntax as a cluster
let s:saved_syntax = get(b:, 'current_syntax', '')
unlet! b:current_syntax
syntax include @RustInSigil syntax/rust.vim
let b:current_syntax = s:saved_syntax

" ~RUST""" ... """ (heredoc — most common)
syntax region elixirRustSigilHeredoc matchgroup=elixirSigilDelimiter
  \ start='\~RUST"""'
  \ end='^\s*"""'
  \ contains=@RustInSigil keepend

" ~RUST"..."
syntax region elixirRustSigilString matchgroup=elixirSigilDelimiter
  \ start='\~RUST"' end='"'
  \ contains=@RustInSigil keepend

" ~RUST[...]
syntax region elixirRustSigilBracket matchgroup=elixirSigilDelimiter
  \ start='\~RUST\[' end='\]'
  \ contains=@RustInSigil keepend

" ~RUST(...)
syntax region elixirRustSigilParen matchgroup=elixirSigilDelimiter
  \ start='\~RUST(' end=')'
  \ contains=@RustInSigil keepend

" ~RUST{...}
syntax region elixirRustSigilCurly matchgroup=elixirSigilDelimiter
  \ start='\~RUST{' end='}'
  \ contains=@RustInSigil keepend
