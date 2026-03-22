import * as vscode from 'vscode';
import { CargoProjectManager } from './cargoProject';
import { DiagnosticsForwarder } from './diagnosticsForwarder';
import {
    RustSigilCompletionProvider,
    RustSigilHoverProvider,
    RustSigilSignatureHelpProvider,
    RustSigilDefinitionProvider,
} from './providers';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const cargo = new CargoProjectManager();
    const ok = await cargo.initialize();
    if (!ok) { return; }

    const elixir: vscode.DocumentSelector = { language: 'elixir', scheme: 'file' };

    // Sync .rs files when Elixir documents change (debounced inside manager)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'elixir') {
                cargo.syncDocument(e.document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'elixir') {
                cargo.syncDocument(doc);
            }
        }),
    );

    // Sync all currently-open Elixir documents
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'elixir') {
            cargo.syncDocument(doc);
        }
    }

    // Register LSP providers
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            elixir,
            new RustSigilCompletionProvider(cargo),
            '.', ':', '<',
        ),
        vscode.languages.registerHoverProvider(
            elixir,
            new RustSigilHoverProvider(cargo),
        ),
        vscode.languages.registerSignatureHelpProvider(
            elixir,
            new RustSigilSignatureHelpProvider(cargo),
            '(', ',',
        ),
        vscode.languages.registerDefinitionProvider(
            elixir,
            new RustSigilDefinitionProvider(cargo),
        ),
    );

    // Forward rust-analyzer diagnostics from generated files to Elixir sources
    context.subscriptions.push(new DiagnosticsForwarder(cargo));

    context.subscriptions.push(cargo);
}

export function deactivate(): void {}
