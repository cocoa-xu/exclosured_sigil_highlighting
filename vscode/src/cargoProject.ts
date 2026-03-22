import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SigilRegion, CrateDep, findSigilRegions } from './sigilDetector';

const PROJECT_DIR = '.exclosured';

/** Lines before user code in the generated Rust wrapper. */
export const PREAMBLE_LINES = 4;

export interface SigilMapping {
    sourceUri: vscode.Uri;
    contentStartLine: number;
    baseIndent: number;
    contentLineCount: number;
}

interface PendingWrite {
    rsPath: string;
    rsContent: string;
    cargoPath: string;
    cargoContent: string;
}

export class CargoProjectManager implements vscode.Disposable {
    private projectPath = '';
    private fileMap = new Map<string, SigilMapping>();
    private writeTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingWrites = new Map<string, PendingWrite>();

    /** Create the workspace-level Cargo.toml. Returns false if no workspace. */
    async initialize(): Promise<boolean> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return false; }

        this.projectPath = path.join(folders[0].uri.fsPath, PROJECT_DIR);
        await fs.promises.mkdir(this.projectPath, { recursive: true });

        // Workspace manifest — each sigil becomes an independent member
        await fs.promises.writeFile(
            path.join(this.projectPath, 'Cargo.toml'),
            [
                '[workspace]',
                'members = ["sigil_*"]',
                'resolver = "2"',
                '',
            ].join('\n'),
        );

        // Keep generated files out of git
        await fs.promises.writeFile(
            path.join(this.projectPath, '.gitignore'),
            '*\n',
        );

        return true;
    }

    /** Debounced: extract all sigils from a document and queue writes. */
    syncDocument(document: vscode.TextDocument): void {
        if (!this.projectPath) { return; }

        const regions = findSigilRegions(document);
        for (const region of regions) {
            this.queueWrite(document.uri, region);
        }
        this.scheduleFlush();
    }

    /** Immediate: ensure this sigil's member crate exists, return its lib.rs URI. */
    ensureFile(region: SigilRegion, sourceUri: vscode.Uri): vscode.Uri {
        const member = this.memberName(sourceUri, region);
        const memberDir = path.join(this.projectPath, member);
        const srcDir = path.join(memberDir, 'src');
        const rsFile = path.join(srcDir, 'lib.rs');

        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(rsFile, generateRustFile(region));
        fs.writeFileSync(
            path.join(memberDir, 'Cargo.toml'),
            generateMemberCargoToml(member, region),
        );

        this.fileMap.set(rsFile, {
            sourceUri,
            contentStartLine: region.contentRange.start.line,
            baseIndent: region.baseIndent,
            contentLineCount: region.dedentedContent.split('\n').length,
        });

        return vscode.Uri.file(rsFile);
    }

    /** Look up the source mapping for a generated lib.rs path. */
    getMapping(generatedPath: string): SigilMapping | undefined {
        return this.fileMap.get(generatedPath);
    }

    // ── internals ──────────────────────────────────────────

    private memberName(sourceUri: vscode.Uri, region: SigilRegion): string {
        const rel = vscode.workspace.asRelativePath(sourceUri);
        const safe = rel.replace(/[^a-zA-Z0-9]/g, '_');
        return `sigil_${safe}_l${region.contentRange.start.line}`;
    }

    private queueWrite(sourceUri: vscode.Uri, region: SigilRegion): void {
        const member = this.memberName(sourceUri, region);
        const memberDir = path.join(this.projectPath, member);
        const srcDir = path.join(memberDir, 'src');
        const rsFile = path.join(srcDir, 'lib.rs');

        this.pendingWrites.set(rsFile, {
            rsPath: rsFile,
            rsContent: generateRustFile(region),
            cargoPath: path.join(memberDir, 'Cargo.toml'),
            cargoContent: generateMemberCargoToml(member, region),
        });

        this.fileMap.set(rsFile, {
            sourceUri,
            contentStartLine: region.contentRange.start.line,
            baseIndent: region.baseIndent,
            contentLineCount: region.dedentedContent.split('\n').length,
        });
    }

    private scheduleFlush(): void {
        if (this.writeTimer) { clearTimeout(this.writeTimer); }
        this.writeTimer = setTimeout(() => this.flush(), 50);
    }

    private flush(): void {
        for (const pw of this.pendingWrites.values()) {
            fs.mkdirSync(path.dirname(pw.rsPath), { recursive: true });
            fs.writeFileSync(pw.rsPath, pw.rsContent);
            fs.writeFileSync(pw.cargoPath, pw.cargoContent);
        }
        this.pendingWrites.clear();
    }

    dispose(): void {
        if (this.writeTimer) { clearTimeout(this.writeTimer); }
        this.flush();
    }
}

// ── Code generation ─────────────────────────────────────────────────

export function generateMemberCargoToml(memberName: string, region: SigilRegion): string {
    const lines = [
        '[package]',
        `name = "${memberName}"`,
        'version = "0.0.0"',
        'edition = "2021"',
        'publish = false',
        '',
    ];

    const deps = region.context?.deps;
    if (deps && deps.length > 0) {
        lines.push('[dependencies]');
        for (const dep of deps) {
            if (dep.features && dep.features.length > 0) {
                const feats = dep.features.map(f => `"${f}"`).join(', ');
                lines.push(`${dep.name} = { version = "${dep.version}", features = [${feats}] }`);
            } else {
                lines.push(`${dep.name} = "${dep.version}"`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function generateRustFile(region: SigilRegion): string {
    const ctx = region.context;
    const lines: string[] = [];

    lines.push('// Auto-generated context for rust-analyzer');

    if (ctx) {
        lines.push('#[allow(unreachable_code, unused_variables, dead_code, unused_mut)]');
        const params = ctx.args.map(a => `${a.name}: ${a.rustType}`).join(', ');
        lines.push(`pub fn __exclosured_inline(${params}) -> ${ctx.returnType} {`);
    } else {
        lines.push('#[allow(unreachable_code, unused_variables, dead_code, unused_mut)]');
        lines.push('pub fn __exclosured_inline() {');
    }

    lines.push('// --- user code starts here ---');
    lines.push(region.dedentedContent);
    lines.push('// --- user code ends here ---');

    if (ctx && ctx.returnType !== '()') {
        lines.push('unreachable!()');
    }
    lines.push('}');

    return lines.join('\n');
}
