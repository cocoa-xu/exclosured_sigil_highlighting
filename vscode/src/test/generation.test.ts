import { describe, it, expect } from 'vitest';
import { Range } from './mocks/vscode';
import { generateRustFile, generateMemberCargoToml, PREAMBLE_LINES } from '../cargoProject';
import type { SigilRegion, DefwasmContext, CrateDep } from '../sigilDetector';

function makeRegion(opts: {
    dedentedContent: string;
    context?: DefwasmContext;
}): SigilRegion {
    return {
        fullRange: new Range(0, 0, 10, 0) as any,
        contentRange: new Range(1, 0, 9, 0) as any,
        content: opts.dedentedContent,
        dedentedContent: opts.dedentedContent,
        baseIndent: 0,
        context: opts.context,
    };
}

// ── generateRustFile ────────────────────────────────────────────────

describe('generateRustFile', () => {
    it('generates wrapper with context', () => {
        const region = makeRegion({
            dedentedContent: 'let x = data.len();\nreturn x as i32;',
            context: {
                functionName: 'hash',
                args: [{ name: 'data', elixirType: 'binary', rustType: '&mut [u8]' }],
                returnType: 'i32',
                deps: [],
            },
        });

        const code = generateRustFile(region);
        const lines = code.split('\n');

        expect(lines[0]).toBe('// Auto-generated context for rust-analyzer');
        expect(lines[1]).toContain('#[allow(');
        expect(lines[2]).toBe('pub fn __exclosured_inline(data: &mut [u8]) -> i32 {');
        expect(lines[3]).toBe('// --- user code starts here ---');
        // User code starts at line PREAMBLE_LINES
        expect(lines[PREAMBLE_LINES]).toBe('let x = data.len();');
        expect(lines[PREAMBLE_LINES + 1]).toBe('return x as i32;');
    });

    it('generates wrapper without context', () => {
        const region = makeRegion({
            dedentedContent: 'return 42;',
        });

        const code = generateRustFile(region);
        expect(code).toContain('pub fn __exclosured_inline() {');
        expect(code).toContain('return 42;');
        // No unreachable!() since no return type
        expect(code).not.toContain('unreachable!()');
    });

    it('adds unreachable!() for non-unit return type', () => {
        const region = makeRegion({
            dedentedContent: 'if true { return 1; }',
            context: {
                functionName: 'test',
                args: [],
                returnType: 'i32',
                deps: [],
            },
        });

        const code = generateRustFile(region);
        expect(code).toContain('unreachable!()');
    });

    it('generates multiple params', () => {
        const region = makeRegion({
            dedentedContent: 'return 0;',
            context: {
                functionName: 'multi',
                args: [
                    { name: 'a', elixirType: 'binary', rustType: '&mut [u8]' },
                    { name: 'b', elixirType: 'i32', rustType: 'i32' },
                ],
                returnType: 'i64',
                deps: [],
            },
        });

        const code = generateRustFile(region);
        expect(code).toContain('pub fn __exclosured_inline(a: &mut [u8], b: i32) -> i64 {');
    });
});

// ── generateMemberCargoToml ─────────────────────────────────────────

describe('generateMemberCargoToml', () => {
    it('generates minimal Cargo.toml without deps', () => {
        const region = makeRegion({ dedentedContent: '' });
        const toml = generateMemberCargoToml('sigil_test_l10', region);

        expect(toml).toContain('name = "sigil_test_l10"');
        expect(toml).toContain('edition = "2021"');
        expect(toml).toContain('publish = false');
        expect(toml).not.toContain('[dependencies]');
    });

    it('generates Cargo.toml with simple deps', () => {
        const region = makeRegion({
            dedentedContent: '',
            context: {
                functionName: 'test',
                args: [],
                returnType: 'i32',
                deps: [{ name: 'maud', version: '0.26' }],
            },
        });
        const toml = generateMemberCargoToml('sigil_test_l10', region);

        expect(toml).toContain('[dependencies]');
        expect(toml).toContain('maud = "0.26"');
    });

    it('generates Cargo.toml with deps with features', () => {
        const region = makeRegion({
            dedentedContent: '',
            context: {
                functionName: 'test',
                args: [],
                returnType: 'i32',
                deps: [
                    { name: 'serde', version: '1', features: ['derive'] },
                    { name: 'serde_json', version: '1' },
                ],
            },
        });
        const toml = generateMemberCargoToml('sigil_test_l10', region);

        expect(toml).toContain('serde = { version = "1", features = ["derive"] }');
        expect(toml).toContain('serde_json = "1"');
    });
});
