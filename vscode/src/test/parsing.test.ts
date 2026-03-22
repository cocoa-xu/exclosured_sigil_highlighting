import { describe, it, expect } from 'vitest';
import {
    parseDeps,
    parseArgs,
    parseReturnType,
    mapElixirTypeToRust,
    calculateBaseIndent,
} from '../sigilDetector';

// ── mapElixirTypeToRust ─────────────────────────────────────────────

describe('mapElixirTypeToRust', () => {
    it('maps :binary to &mut [u8]', () => {
        expect(mapElixirTypeToRust('binary')).toBe('&mut [u8]');
    });

    it('maps :string to &str', () => {
        expect(mapElixirTypeToRust('string')).toBe('&str');
    });

    it('maps :integer to i32', () => {
        expect(mapElixirTypeToRust('integer')).toBe('i32');
    });

    it('maps numeric types directly', () => {
        expect(mapElixirTypeToRust('i32')).toBe('i32');
        expect(mapElixirTypeToRust('i64')).toBe('i64');
        expect(mapElixirTypeToRust('f32')).toBe('f32');
        expect(mapElixirTypeToRust('f64')).toBe('f64');
    });

    it('maps :float to f64', () => {
        expect(mapElixirTypeToRust('float')).toBe('f64');
    });

    it('defaults unknown types to i32', () => {
        expect(mapElixirTypeToRust('unknown')).toBe('i32');
    });
});

// ── parseArgs ───────────────────────────────────────────────────────

describe('parseArgs', () => {
    it('parses single arg', () => {
        const decl = 'defwasm :foo, args: [data: :binary] do';
        const args = parseArgs(decl);
        expect(args).toEqual([
            { name: 'data', elixirType: 'binary', rustType: '&mut [u8]' },
        ]);
    });

    it('parses multiple args', () => {
        const decl = 'defwasm :foo, args: [input: :binary, count: :i32] do';
        const args = parseArgs(decl);
        expect(args).toHaveLength(2);
        expect(args[0]).toEqual({ name: 'input', elixirType: 'binary', rustType: '&mut [u8]' });
        expect(args[1]).toEqual({ name: 'count', elixirType: 'i32', rustType: 'i32' });
    });

    it('returns empty for no args', () => {
        const decl = 'defwasm :foo do';
        expect(parseArgs(decl)).toEqual([]);
    });

    it('handles multi-line declaration', () => {
        const decl = `defwasm :foo,
    args: [data: :binary],
    deps: [maud: "0.26"] do`;
        const args = parseArgs(decl);
        expect(args).toEqual([
            { name: 'data', elixirType: 'binary', rustType: '&mut [u8]' },
        ]);
    });
});

// ── parseReturnType ─────────────────────────────────────────────────

describe('parseReturnType', () => {
    it('parses explicit return type', () => {
        const decl = 'defwasm :foo, return_type: :i64 do';
        expect(parseReturnType(decl)).toBe('i64');
    });

    it('defaults to i32', () => {
        const decl = 'defwasm :foo, args: [data: :binary] do';
        expect(parseReturnType(decl)).toBe('i32');
    });

    it('maps Elixir type names', () => {
        expect(parseReturnType('return_type: :float')).toBe('f64');
    });
});

// ── parseDeps ───────────────────────────────────────────────────────

describe('parseDeps', () => {
    it('parses atom key format: maud: "0.26"', () => {
        const decl = 'defwasm :foo, deps: [maud: "0.26"] do';
        const deps = parseDeps(decl);
        expect(deps).toEqual([{ name: 'maud', version: '0.26' }]);
    });

    it('parses string key format: "pulldown-cmark": "0.12"', () => {
        const decl = 'defwasm :foo, deps: ["pulldown-cmark": "0.12"] do';
        const deps = parseDeps(decl);
        expect(deps).toEqual([{ name: 'pulldown-cmark', version: '0.12' }]);
    });

    it('parses tuple format: {"serde", "1"}', () => {
        const decl = 'defwasm :foo, deps: [{"serde", "1"}] do';
        const deps = parseDeps(decl);
        expect(deps).toEqual([{ name: 'serde', version: '1', features: undefined }]);
    });

    it('parses tuple with features: {"serde", "1", features: ["derive"]}', () => {
        const decl = 'defwasm :foo, deps: [{"serde", "1", features: ["derive"]}] do';
        const deps = parseDeps(decl);
        expect(deps).toEqual([{ name: 'serde', version: '1', features: ['derive'] }]);
    });

    it('parses multiple mixed deps', () => {
        const decl = 'defwasm :foo, deps: [{"serde", "1", features: ["derive"]}, {"serde_json", "1"}] do';
        const deps = parseDeps(decl);
        expect(deps).toHaveLength(2);
        expect(deps[0]).toEqual({ name: 'serde', version: '1', features: ['derive'] });
        expect(deps[1]).toEqual({ name: 'serde_json', version: '1', features: undefined });
    });

    it('returns empty when no deps', () => {
        const decl = 'defwasm :foo, args: [data: :binary] do';
        expect(parseDeps(decl)).toEqual([]);
    });

    it('handles nested brackets in features', () => {
        const decl = 'defwasm :foo, deps: [{"serde", "1", features: ["derive", "alloc"]}] do';
        const deps = parseDeps(decl);
        expect(deps[0].features).toEqual(['derive', 'alloc']);
    });
});

// ── calculateBaseIndent ─────────────────────────────────────────────

describe('calculateBaseIndent', () => {
    it('detects uniform indentation', () => {
        expect(calculateBaseIndent([
            '    let x = 1;',
            '    let y = 2;',
        ])).toBe(4);
    });

    it('uses minimum indentation', () => {
        expect(calculateBaseIndent([
            '    let x = 1;',
            '  if true {',
            '      y = 2;',
            '  }',
        ])).toBe(2);
    });

    it('skips empty lines', () => {
        expect(calculateBaseIndent([
            '    let x = 1;',
            '',
            '    let y = 2;',
        ])).toBe(4);
    });

    it('returns 0 for no indentation', () => {
        expect(calculateBaseIndent([
            'let x = 1;',
            'let y = 2;',
        ])).toBe(0);
    });

    it('returns 0 for all-empty lines', () => {
        expect(calculateBaseIndent(['', '  ', ''])).toBe(0);
    });
});
