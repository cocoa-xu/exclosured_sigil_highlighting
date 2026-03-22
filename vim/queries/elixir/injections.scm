; Inject Rust highlighting into ~RUST sigils
((sigil
  (sigil_name) @_sigil_name
  (quoted_content) @injection.content)
 (#eq? @_sigil_name "RUST")
 (#set! injection.language "rust")
 (#set! injection.combined))
