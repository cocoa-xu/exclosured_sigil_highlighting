import * as vscode from 'vscode';
import { getSigilAtPosition, SigilRegion } from './sigilDetector';
import { CargoProjectManager, PREAMBLE_LINES } from './cargoProject';

// ── Position mapping ────────────────────────────────────────────────

export function elixirToVirtual(region: SigilRegion, pos: vscode.Position): vscode.Position {
    return new vscode.Position(
        pos.line - region.contentRange.start.line + PREAMBLE_LINES,
        Math.max(0, pos.character - region.baseIndent),
    );
}

export function virtualToElixir(region: SigilRegion, pos: vscode.Position): vscode.Position {
    return new vscode.Position(
        pos.line - PREAMBLE_LINES + region.contentRange.start.line,
        pos.character + region.baseIndent,
    );
}

export function virtualRangeToElixir(region: SigilRegion, range: vscode.Range): vscode.Range {
    return new vscode.Range(
        virtualToElixir(region, range.start),
        virtualToElixir(region, range.end),
    );
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Ensure VS Code has the document loaded so rust-analyzer can serve requests. */
async function openGenerated(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.openTextDocument(uri);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLocationLink(loc: any): loc is vscode.LocationLink {
    return loc && 'targetUri' in loc && 'targetRange' in loc;
}

// ── Completion mapping ──────────────────────────────────────────────

function mapCompletionItem(
    item: vscode.CompletionItem,
    region: SigilRegion,
): vscode.CompletionItem {
    // Map textEdit ranges from generated file back to Elixir source
    if (item.textEdit) {
        const te = item.textEdit;
        if (te instanceof vscode.TextEdit) {
            item.textEdit = new vscode.TextEdit(
                virtualRangeToElixir(region, te.range),
                te.newText,
            );
        } else {
            // InsertReplaceEdit — cast through unknown since TS doesn't
            // expose the InsertReplaceEdit type directly on CompletionItem
            const ire = te as unknown as { newText: string; insert: vscode.Range; replace: vscode.Range };
            item.textEdit = {
                newText: ire.newText,
                insert: virtualRangeToElixir(region, ire.insert),
                replace: virtualRangeToElixir(region, ire.replace),
            } as unknown as vscode.TextEdit;
        }
    }

    // Map range (used when textEdit is absent)
    if (item.range && !item.textEdit) {
        if (item.range instanceof vscode.Range) {
            item.range = virtualRangeToElixir(region, item.range);
        } else {
            item.range = {
                inserting: virtualRangeToElixir(region, (item.range as { inserting: vscode.Range; replacing: vscode.Range }).inserting),
                replacing: virtualRangeToElixir(region, (item.range as { inserting: vscode.Range; replacing: vscode.Range }).replacing),
            };
        }
    }

    // Drop additionalTextEdits that target the wrapper (outside user code)
    if (item.additionalTextEdits) {
        item.additionalTextEdits = item.additionalTextEdits
            .filter(e => e.range.start.line >= PREAMBLE_LINES)
            .map(e => new vscode.TextEdit(
                virtualRangeToElixir(region, e.range),
                e.newText,
            ));
    }

    // Boost Rust items to top of the list
    const label = typeof item.label === 'string' ? item.label : item.label.label;
    item.sortText = `0_${item.sortText || label}`;
    if (!item.detail) {
        item.detail = '(Rust)';
    }

    return item;
}

// ── Completion ──────────────────────────────────────────────────────

export class RustSigilCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private cargo: CargoProjectManager) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): Promise<vscode.CompletionList | undefined> {
        const region = getSigilAtPosition(document, position);
        if (!region) { return undefined; }

        const fileUri = this.cargo.ensureFile(region, document.uri);
        await openGenerated(fileUri);
        const pos = elixirToVirtual(region, position);

        const result = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            fileUri,
            pos,
            context.triggerCharacter,
        );

        if (!result || !result.items || result.items.length === 0) {
            return undefined;
        }

        result.items = result.items.map(item => mapCompletionItem(item, region));
        return result;
    }
}

// ── Hover ───────────────────────────────────────────────────────────

export class RustSigilHoverProvider implements vscode.HoverProvider {
    constructor(private cargo: CargoProjectManager) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Hover | undefined> {
        const region = getSigilAtPosition(document, position);
        if (!region) { return undefined; }

        const fileUri = this.cargo.ensureFile(region, document.uri);
        await openGenerated(fileUri);
        const pos = elixirToVirtual(region, position);

        const results = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            fileUri,
            pos,
        );

        if (results && results.length > 0) {
            const hover = results[0];
            if (hover.range) {
                hover.range = virtualRangeToElixir(region, hover.range);
            }
            return hover;
        }
        return undefined;
    }
}

// ── Signature Help ──────────────────────────────────────────────────

export class RustSigilSignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(private cargo: CargoProjectManager) {}

    async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext,
    ): Promise<vscode.SignatureHelp | undefined> {
        const region = getSigilAtPosition(document, position);
        if (!region) { return undefined; }

        const fileUri = this.cargo.ensureFile(region, document.uri);
        await openGenerated(fileUri);
        const pos = elixirToVirtual(region, position);

        return vscode.commands.executeCommand<vscode.SignatureHelp>(
            'vscode.executeSignatureHelpProvider',
            fileUri,
            pos,
            context.triggerCharacter,
        );
    }
}

// ── Go to Definition ────────────────────────────────────────────────

export class RustSigilDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private cargo: CargoProjectManager) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
        const region = getSigilAtPosition(document, position);
        if (!region) { return undefined; }

        const fileUri = this.cargo.ensureFile(region, document.uri);
        await openGenerated(fileUri);
        const pos = elixirToVirtual(region, position);

        const results = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeDefinitionProvider',
            fileUri,
            pos,
        );

        if (!results || results.length === 0) { return undefined; }

        // Normalise everything to LocationLink for a uniform return type
        const mapped: vscode.LocationLink[] = results.map(loc => {
            if (isLocationLink(loc)) {
                const inGenerated = loc.targetUri.fsPath === fileUri.fsPath;
                return {
                    originSelectionRange: loc.originSelectionRange
                        ? virtualRangeToElixir(region, loc.originSelectionRange)
                        : undefined,
                    targetUri: inGenerated ? document.uri : loc.targetUri,
                    targetRange: inGenerated
                        ? virtualRangeToElixir(region, loc.targetRange)
                        : loc.targetRange,
                    targetSelectionRange: loc.targetSelectionRange
                        ? (inGenerated
                            ? virtualRangeToElixir(region, loc.targetSelectionRange)
                            : loc.targetSelectionRange)
                        : undefined,
                };
            }

            // Plain Location → convert to LocationLink
            const inGenerated = loc.uri.fsPath === fileUri.fsPath;
            const targetRange = inGenerated
                ? virtualRangeToElixir(region, loc.range)
                : loc.range;
            return {
                targetUri: inGenerated ? document.uri : loc.uri,
                targetRange,
                targetSelectionRange: targetRange,
            };
        });
        return mapped;
    }
}
