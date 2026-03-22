import { describe, it, expect } from 'vitest';
import { Position, Range } from './mocks/vscode';
import { elixirToVirtual, virtualToElixir, virtualRangeToElixir } from '../providers';
import { PREAMBLE_LINES } from '../cargoProject';
import type { SigilRegion } from '../sigilDetector';

function makeRegion(contentStartLine: number, baseIndent: number): SigilRegion {
    return {
        fullRange: new Range(contentStartLine - 1, 0, contentStartLine + 10, 0) as any,
        contentRange: new Range(contentStartLine, 0, contentStartLine + 10, 0) as any,
        content: '',
        dedentedContent: '',
        baseIndent,
    };
}

// ── elixirToVirtual ─────────────────────────────────────────────────

describe('elixirToVirtual', () => {
    it('maps first content line to PREAMBLE_LINES', () => {
        // Sigil content starts at Elixir line 12
        const region = makeRegion(12, 2);
        const result = elixirToVirtual(region, new Position(12, 2) as any);

        expect(result.line).toBe(PREAMBLE_LINES);
        expect(result.character).toBe(0); // 2 - baseIndent(2) = 0
    });

    it('offsets lines correctly', () => {
        const region = makeRegion(12, 2);
        const result = elixirToVirtual(region, new Position(15, 6) as any);

        expect(result.line).toBe(PREAMBLE_LINES + 3); // 15 - 12 + 4 = 7
        expect(result.character).toBe(4); // 6 - 2 = 4
    });

    it('clamps column to 0 when less than baseIndent', () => {
        const region = makeRegion(12, 4);
        const result = elixirToVirtual(region, new Position(12, 2) as any);

        expect(result.character).toBe(0);
    });

    it('handles zero baseIndent', () => {
        const region = makeRegion(5, 0);
        const result = elixirToVirtual(region, new Position(7, 10) as any);

        expect(result.line).toBe(PREAMBLE_LINES + 2);
        expect(result.character).toBe(10);
    });
});

// ── virtualToElixir ─────────────────────────────────────────────────

describe('virtualToElixir', () => {
    it('maps PREAMBLE_LINES back to content start', () => {
        const region = makeRegion(12, 2);
        const result = virtualToElixir(region, new Position(PREAMBLE_LINES, 0) as any);

        expect(result.line).toBe(12);
        expect(result.character).toBe(2); // 0 + baseIndent(2)
    });

    it('offsets lines correctly', () => {
        const region = makeRegion(12, 2);
        const result = virtualToElixir(region, new Position(PREAMBLE_LINES + 3, 4) as any);

        expect(result.line).toBe(15);
        expect(result.character).toBe(6); // 4 + 2
    });
});

// ── Round trip ───────────────────────────────────────────────────────

describe('round trip', () => {
    it('elixir → virtual → elixir is identity', () => {
        const region = makeRegion(20, 4);
        const original = new Position(23, 8) as any;

        const virtual = elixirToVirtual(region, original);
        const back = virtualToElixir(region, virtual);

        expect(back.line).toBe(original.line);
        expect(back.character).toBe(original.character);
    });

    it('virtual → elixir → virtual is identity', () => {
        const region = makeRegion(20, 4);
        const original = new Position(PREAMBLE_LINES + 2, 6) as any;

        const elixir = virtualToElixir(region, original);
        const back = elixirToVirtual(region, elixir);

        expect(back.line).toBe(original.line);
        expect(back.character).toBe(original.character);
    });
});

// ── virtualRangeToElixir ────────────────────────────────────────────

describe('virtualRangeToElixir', () => {
    it('maps both start and end', () => {
        const region = makeRegion(10, 2);
        const virtualRange = new Range(
            PREAMBLE_LINES, 0,
            PREAMBLE_LINES + 3, 5,
        ) as any;

        const result = virtualRangeToElixir(region, virtualRange);

        expect(result.start.line).toBe(10);
        expect(result.start.character).toBe(2);
        expect(result.end.line).toBe(13);
        expect(result.end.character).toBe(7);
    });
});
