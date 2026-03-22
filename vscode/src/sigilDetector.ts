import * as vscode from 'vscode';

export interface SigilRegion {
    /** Full range of the sigil (including delimiters) */
    fullRange: vscode.Range;
    /** Range of just the content between delimiters */
    contentRange: vscode.Range;
    /** The raw content text */
    content: string;
    /** Content with common leading indentation stripped */
    dedentedContent: string;
    /** Number of characters of common indentation stripped */
    baseIndent: number;
    /** Parsed defwasm context, if available */
    context?: DefwasmContext;
}

export interface CrateDep {
    name: string;
    version: string;
    features?: string[];
}

export interface DefwasmContext {
    functionName: string;
    args: DefwasmArg[];
    returnType: string;
    deps: CrateDep[];
}

export interface DefwasmArg {
    name: string;
    elixirType: string;
    rustType: string;
}

const ELIXIR_TO_RUST_TYPES: Record<string, string> = {
    'binary': '&mut [u8]',
    'string': '&str',
    'integer': 'i32',
    'i32': 'i32',
    'i64': 'i64',
    'f32': 'f32',
    'float': 'f64',
    'f64': 'f64',
};

export function mapElixirTypeToRust(elixirType: string): string {
    return ELIXIR_TO_RUST_TYPES[elixirType] || 'i32';
}

/**
 * Find all ~RUST sigil regions in a document.
 */
export function findSigilRegions(document: vscode.TextDocument): SigilRegion[] {
    const regions: SigilRegion[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Heredoc style: ~RUST"""
        const heredocIdx = line.indexOf('~RUST"""');
        if (heredocIdx !== -1) {
            const region = parseHeredocSigil(document, lines, i, heredocIdx);
            if (region) {
                regions.push(region);
                // Skip past the region
                i = region.fullRange.end.line;
            }
            continue;
        }

        // Single-quote style: ~RUST"..."
        const sqMatch = line.match(/~RUST"([^"]*)"/);
        if (sqMatch) {
            const startCol = line.indexOf('~RUST"') + 6;
            const content = sqMatch[1];
            const endCol = startCol + content.length;
            regions.push({
                fullRange: new vscode.Range(i, line.indexOf('~RUST"'), i, endCol + 1),
                contentRange: new vscode.Range(i, startCol, i, endCol),
                content,
                dedentedContent: content,
                baseIndent: 0,
                context: parseDefwasmContext(document, i),
            });
            continue;
        }
    }

    return regions;
}

function parseHeredocSigil(
    document: vscode.TextDocument,
    lines: string[],
    startLine: number,
    sigilCol: number,
): SigilRegion | null {
    const contentStart = startLine + 1;

    for (let i = contentStart; i < lines.length; i++) {
        const endMatch = lines[i].match(/^(\s*)"""([a-z]*)/);
        if (endMatch) {
            const contentLines = lines.slice(contentStart, i);
            const content = contentLines.join('\n');
            const baseIndent = calculateBaseIndent(contentLines);
            const dedentedContent = contentLines
                .map(l => l.substring(baseIndent))
                .join('\n');

            return {
                fullRange: new vscode.Range(
                    startLine, sigilCol,
                    i, (endMatch[1]?.length || 0) + 3 + (endMatch[2]?.length || 0),
                ),
                contentRange: new vscode.Range(contentStart, 0, i, 0),
                content,
                dedentedContent,
                baseIndent,
                context: parseDefwasmContext(document, startLine),
            };
        }
    }

    return null;
}

export function calculateBaseIndent(lines: string[]): number {
    let min = Infinity;
    for (const line of lines) {
        if (line.trim().length === 0) { continue; }
        const indent = line.match(/^(\s*)/)?.[1].length || 0;
        min = Math.min(min, indent);
    }
    return min === Infinity ? 0 : min;
}

/**
 * Look backward from the sigil line to find a `defwasm` declaration
 * and parse its arguments / return type.
 */
function parseDefwasmContext(
    document: vscode.TextDocument,
    sigilLine: number,
): DefwasmContext | undefined {
    for (let i = sigilLine; i >= Math.max(0, sigilLine - 10); i--) {
        const line = document.lineAt(i).text;
        const m = line.match(/defwasm\s+:(\w+)/);
        if (m) {
            // Gather the full declaration text (may span multiple lines)
            let decl = '';
            for (let j = i; j <= sigilLine; j++) {
                decl += document.lineAt(j).text + '\n';
            }
            return {
                functionName: m[1],
                args: parseArgs(decl),
                returnType: parseReturnType(decl),
                deps: parseDeps(decl),
            };
        }
    }
    return undefined;
}

export function parseArgs(decl: string): DefwasmArg[] {
    const args: DefwasmArg[] = [];
    const m = decl.match(/args:\s*\[(.*?)\]/s);
    if (!m) { return args; }

    const pairs = m[1].match(/(\w+):\s*:(\w+)/g);
    if (!pairs) { return args; }

    for (const pair of pairs) {
        const pm = pair.match(/(\w+):\s*:(\w+)/);
        if (pm) {
            args.push({
                name: pm[1],
                elixirType: pm[2],
                rustType: mapElixirTypeToRust(pm[2]),
            });
        }
    }
    return args;
}

export function parseReturnType(decl: string): string {
    const m = decl.match(/return_type:\s*:(\w+)/);
    return m ? mapElixirTypeToRust(m[1]) : 'i32';
}

/**
 * Parse deps from a defwasm declaration. Supports three formats:
 *   deps: [maud: "0.26"]                                  — atom key
 *   deps: ["pulldown-cmark": "0.12"]                      — string key
 *   deps: [{"serde", "1", features: ["derive"]}]          — tuple ± features
 */
export function parseDeps(decl: string): CrateDep[] {
    const deps: CrateDep[] = [];

    // Extract the deps: [...] content.  Use a manual bracket-matcher
    // so nested brackets (e.g. features: ["derive"]) don't break things.
    const depsIdx = decl.indexOf('deps:');
    if (depsIdx === -1) { return deps; }

    const afterDeps = decl.substring(depsIdx + 5);
    const bracketStart = afterDeps.indexOf('[');
    if (bracketStart === -1) { return deps; }

    let depth = 0;
    let bracketEnd = -1;
    for (let i = bracketStart; i < afterDeps.length; i++) {
        if (afterDeps[i] === '[') { depth++; }
        else if (afterDeps[i] === ']') {
            depth--;
            if (depth === 0) { bracketEnd = i; break; }
        }
    }
    if (bracketEnd === -1) { return deps; }

    const inner = afterDeps.substring(bracketStart + 1, bracketEnd);

    // 1) Tuple format: {"name", "version"} or {"name", "version", features: ["f1","f2"]}
    const tupleRe = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*features:\s*\[([^\]]*)\])?\s*\}/g;
    let tm;
    while ((tm = tupleRe.exec(inner)) !== null) {
        const features = tm[3]
            ? tm[3].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, ''))
            : undefined;
        deps.push({ name: tm[1], version: tm[2], features });
    }

    // 2) Keyword format: atom_key: "version"  or  "string-key": "version"
    //    Only match if not already captured by the tuple regex.
    const kwRe = /"?([^":{}\s,]+)"?\s*:\s*"([^"]+)"/g;
    let km;
    while ((km = kwRe.exec(inner)) !== null) {
        const name = km[1];
        // Skip if this looks like it's inside a tuple (features: ...)
        if (name === 'features') { continue; }
        if (!deps.find(d => d.name === name)) {
            deps.push({ name, version: km[2] });
        }
    }

    return deps;
}

/**
 * Get the sigil region at a specific cursor position, if any.
 */
export function getSigilAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): SigilRegion | undefined {
    const regions = findSigilRegions(document);
    return regions.find(r => r.contentRange.contains(position));
}
