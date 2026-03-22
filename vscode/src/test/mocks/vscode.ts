/* Minimal mock of the vscode module for unit tests. */

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;

    constructor(startLine: number, startChar: number, endLine: number, endChar: number);
    constructor(start: Position, end: Position);
    constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
        if (typeof a === 'number') {
            this.start = new Position(a, b as number);
            this.end = new Position(c!, d!);
        } else {
            this.start = a;
            this.end = b as Position;
        }
    }

    contains(pos: Position): boolean {
        if (pos.line < this.start.line || pos.line > this.end.line) { return false; }
        if (pos.line === this.start.line && pos.character < this.start.character) { return false; }
        if (pos.line === this.end.line && pos.character >= this.end.character) { return false; }
        return true;
    }
}

export class Uri {
    private constructor(
        public readonly scheme: string,
        public readonly path: string,
        public readonly fsPath: string,
    ) {}
    static file(p: string): Uri { return new Uri('file', p, p); }
    static parse(v: string): Uri {
        const scheme = v.split('://')[0] || 'file';
        return new Uri(scheme, v, v);
    }
    toString(): string { return `${this.scheme}://${this.path}`; }
}

export class TextEdit {
    constructor(public range: Range, public newText: string) {}
}

export class Location {
    constructor(public uri: Uri, public range: Range) {}
}

export class DiagnosticRelatedInformation {
    constructor(public location: Location, public message: string) {}
}

export class Diagnostic {
    source?: string;
    code?: string | number;
    tags?: number[];
    relatedInformation?: DiagnosticRelatedInformation[];
    constructor(public range: Range, public message: string, public severity?: number) {}
}

export const workspace = {
    asRelativePath: (uri: Uri | string) => typeof uri === 'string' ? uri : uri.fsPath,
    workspaceFolders: [{ uri: Uri.file('/workspace') }],
};

export const languages = {};
export const commands = {};
export const window = {};
export const EventEmitter = class { event = () => {}; fire() {} dispose() {} };
