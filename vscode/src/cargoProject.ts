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

export class CargoProjectManager implements vscode.Disposable {
    private projectPath = '';
    private srcDir = '';
    private knownModules = new Set<string>();
    private allDeps = new Map<string, CrateDep>(); // name -> dep
    private fileMap = new Map<string, SigilMapping>(); // generatedPath -> mapping
    private writeTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingWrites = new Map<string, string>();

    /** Create the hidden Cargo project. Returns false if no workspace is open. */
    async initialize(): Promise<boolean> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return false; }

        this.projectPath = path.join(folders[0].uri.fsPath, PROJECT_DIR);
        this.srcDir = path.join(this.projectPath, 'src');

        await fs.promises.mkdir(this.srcDir, { recursive: true });

        // Cargo.toml (always rewrite so deps are fresh)
        this.writeCargoTomlSync();

        // .gitignore inside .exclosured so git ignores all generated files
        await fs.promises.writeFile(
            path.join(this.projectPath, '.gitignore'),
            '*\n',
        );

        await this.writeLibRs();
        return true;
    }

    /** Debounced: extract all sigils from a document and queue .rs file writes. */
    syncDocument(document: vscode.TextDocument): void {
        if (!this.projectPath) { return; }

        const regions = findSigilRegions(document);
        for (const region of regions) {
            const mod = this.moduleName(document.uri, region);
            const file = path.join(this.srcDir, `${mod}.rs`);
            this.pendingWrites.set(file, generateRustFile(region));
            this.knownModules.add(mod);
            this.collectDeps(region);
            this.fileMap.set(file, {
                sourceUri: document.uri,
                contentStartLine: region.contentRange.start.line,
                baseIndent: region.baseIndent,
                contentLineCount: region.dedentedContent.split('\n').length,
            });
        }
        this.scheduleFlush();
    }

    /** Write the .rs file immediately (for use right before an LSP request). */
    ensureFile(region: SigilRegion, sourceUri: vscode.Uri): vscode.Uri {
        const mod = this.moduleName(sourceUri, region);
        const file = path.join(this.srcDir, `${mod}.rs`);

        fs.writeFileSync(file, generateRustFile(region));

        this.fileMap.set(file, {
            sourceUri: sourceUri,
            contentStartLine: region.contentRange.start.line,
            baseIndent: region.baseIndent,
            contentLineCount: region.dedentedContent.split('\n').length,
        });

        let changed = false;
        if (!this.knownModules.has(mod)) {
            this.knownModules.add(mod);
            changed = true;
        }
        if (this.collectDeps(region) || changed) {
            this.writeLibRsSync();
            this.writeCargoTomlSync();
        }

        return vscode.Uri.file(file);
    }

    /** Merge region deps into allDeps. Returns true if anything changed. */
    private collectDeps(region: SigilRegion): boolean {
        const deps = region.context?.deps;
        if (!deps || deps.length === 0) { return false; }

        let changed = false;
        for (const dep of deps) {
            const existing = this.allDeps.get(dep.name);
            if (!existing || existing.version !== dep.version
                || JSON.stringify(existing.features) !== JSON.stringify(dep.features)) {
                this.allDeps.set(dep.name, dep);
                changed = true;
            }
        }
        return changed;
    }

    /** Look up the source mapping for a generated .rs file path. */
    getMapping(generatedPath: string): SigilMapping | undefined {
        return this.fileMap.get(generatedPath);
    }

    // ── internals ──────────────────────────────────────────

    private moduleName(sourceUri: vscode.Uri, region: SigilRegion): string {
        const rel = vscode.workspace.asRelativePath(sourceUri);
        const safe = rel.replace(/[^a-zA-Z0-9]/g, '_');
        return `sigil_${safe}_l${region.contentRange.start.line}`;
    }

    private scheduleFlush(): void {
        if (this.writeTimer) { clearTimeout(this.writeTimer); }
        this.writeTimer = setTimeout(() => this.flush(), 50);
    }

    private flush(): void {
        for (const [file, content] of this.pendingWrites) {
            fs.writeFileSync(file, content);
        }
        this.pendingWrites.clear();
        this.writeLibRsSync();
        this.writeCargoTomlSync();
    }

    private writeCargoTomlSync(): void {
        const lines = [
            '[package]',
            'name = "exclosured-virtual"',
            'version = "0.0.0"',
            'edition = "2021"',
            'publish = false',
            '',
        ];

        if (this.allDeps.size > 0) {
            lines.push('[dependencies]');
            for (const dep of this.allDeps.values()) {
                if (dep.features && dep.features.length > 0) {
                    const feats = dep.features.map(f => `"${f}"`).join(', ');
                    lines.push(`${dep.name} = { version = "${dep.version}", features = [${feats}] }`);
                } else {
                    lines.push(`${dep.name} = "${dep.version}"`);
                }
            }
            lines.push('');
        }

        fs.writeFileSync(
            path.join(this.projectPath, 'Cargo.toml'),
            lines.join('\n'),
        );
    }

    private writeLibRsSync(): void {
        const mods = [...this.knownModules].map(m => `mod ${m};`).join('\n');
        fs.writeFileSync(
            path.join(this.srcDir, 'lib.rs'),
            `// Auto-generated by exclosured-rust-sigil\n${mods}\n`,
        );
    }

    private async writeLibRs(): Promise<void> {
        const mods = [...this.knownModules].map(m => `mod ${m};`).join('\n');
        await fs.promises.writeFile(
            path.join(this.srcDir, 'lib.rs'),
            `// Auto-generated by exclosured-rust-sigil\n${mods}\n`,
        );
    }

    dispose(): void {
        if (this.writeTimer) { clearTimeout(this.writeTimer); }
        this.flush();
    }
}

function generateRustFile(region: SigilRegion): string {
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
