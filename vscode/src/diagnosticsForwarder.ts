import * as vscode from 'vscode';
import { CargoProjectManager, PREAMBLE_LINES } from './cargoProject';

/**
 * Watches rust-analyzer diagnostics on generated .rs files and
 * mirrors them (with mapped positions) onto the original Elixir files.
 */
export class DiagnosticsForwarder implements vscode.Disposable {
    private collection: vscode.DiagnosticCollection;
    /** sourceUri → (generatedPath → mapped diagnostics) */
    private perSource = new Map<string, Map<string, vscode.Diagnostic[]>>();
    private disposables: vscode.Disposable[] = [];

    constructor(private cargo: CargoProjectManager) {
        this.collection = vscode.languages.createDiagnosticCollection('exclosured-rust');

        this.disposables.push(
            this.collection,
            vscode.languages.onDidChangeDiagnostics(e => this.onChanged(e)),
        );
    }

    private onChanged(e: vscode.DiagnosticChangeEvent): void {
        for (const uri of e.uris) {
            const mapping = this.cargo.getMapping(uri.fsPath);
            if (!mapping) { continue; }

            const raw = vscode.languages.getDiagnostics(uri);
            const mapped: vscode.Diagnostic[] = [];

            for (const diag of raw) {
                const sl = diag.range.start.line;
                const el = diag.range.end.line;

                // Only forward diagnostics whose primary range is in user code
                if (sl < PREAMBLE_LINES
                    || sl >= PREAMBLE_LINES + mapping.contentLineCount) {
                    continue;
                }

                const range = new vscode.Range(
                    sl - PREAMBLE_LINES + mapping.contentStartLine,
                    diag.range.start.character + mapping.baseIndent,
                    el - PREAMBLE_LINES + mapping.contentStartLine,
                    diag.range.end.character + mapping.baseIndent,
                );

                const d = new vscode.Diagnostic(range, diag.message, diag.severity);
                d.source = 'rust-analyzer (exclosured)';
                d.code = diag.code;
                d.tags = diag.tags;

                // Map relatedInformation that points into the generated file
                if (diag.relatedInformation) {
                    d.relatedInformation = diag.relatedInformation
                        .filter(ri => {
                            // Keep related info from other files as-is
                            if (ri.location.uri.fsPath !== uri.fsPath) { return true; }
                            // Only keep related info within user code section
                            const rl = ri.location.range.start.line;
                            return rl >= PREAMBLE_LINES
                                && rl < PREAMBLE_LINES + mapping.contentLineCount;
                        })
                        .map(ri => {
                            if (ri.location.uri.fsPath !== uri.fsPath) { return ri; }
                            const rr = ri.location.range;
                            return new vscode.DiagnosticRelatedInformation(
                                new vscode.Location(
                                    mapping.sourceUri,
                                    new vscode.Range(
                                        rr.start.line - PREAMBLE_LINES + mapping.contentStartLine,
                                        rr.start.character + mapping.baseIndent,
                                        rr.end.line - PREAMBLE_LINES + mapping.contentStartLine,
                                        rr.end.character + mapping.baseIndent,
                                    ),
                                ),
                                ri.message,
                            );
                        });
                }

                mapped.push(d);
            }

            // Merge per-source so multiple sigils in one file all show
            const srcKey = mapping.sourceUri.toString();
            if (!this.perSource.has(srcKey)) {
                this.perSource.set(srcKey, new Map());
            }
            this.perSource.get(srcKey)!.set(uri.fsPath, mapped);

            const merged: vscode.Diagnostic[] = [];
            for (const diags of this.perSource.get(srcKey)!.values()) {
                merged.push(...diags);
            }
            this.collection.set(mapping.sourceUri, merged);
        }
    }

    dispose(): void {
        for (const d of this.disposables) { d.dispose(); }
    }
}
