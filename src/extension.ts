import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";
import * as dznlint from "dznlint";

const dznDiagnosticsCollection = vscode.languages.createDiagnosticCollection("dznlint-diagnostics");

let program: dznlint.Program;

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log("dznlint-vscode active");

    program = new dznlint.Program();

    // Push dznlint diagnostics collection to editor
    context.subscriptions.push(dznDiagnosticsCollection);

    // Look for configuration
    let configuration = tryLoadDznLintConfig();

    // Update diagnostics for currently open window when activating extension
    if (vscode.window.activeTextEditor?.document && isDznFile(vscode.window.activeTextEditor.document)) {
        updateDiagnostics(vscode.window.activeTextEditor.document, configuration);
    }

    // Update diagnostics after opening file
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && isDznFile(editor.document)) {
            updateDiagnostics(editor.document, configuration);
        }
    });

    // Update diagnostics after changing text
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isDznFile(event.document)) {
            updateDiagnostics(event.document, configuration);
        }
    });

    vscode.workspace.onDidSaveTextDocument(event => {
        if (event.fileName.endsWith(dznlint.DEFAULT_DZNLINT_CONFIG_FILE)) {
            configuration = JSON.parse(fs.readFileSync(event.fileName).toString());
        }
    });
}

// this method is called when your extension is deactivated
export function deactivate() {}

function isDznFile(document: vscode.TextDocument): boolean {
    return document.fileName.endsWith(".dzn");
}

function updateDiagnostics(document: vscode.TextDocument, configuration?: dznlint.DznLintUserConfiguration): void {
    program.host.includePaths = readIncludePaths();
    // Force the file cache to reload
    const sourceFile = program.parseFile(document.fileName, document.getText());
    if (!sourceFile) throw `Failed to parse new source file for ${document.fileName}`;

    const diagnostics = dznlint.lint([sourceFile], configuration, program);

    const documentDiagnostics = [];

    for (const d of diagnostics) {
        documentDiagnostics.push({
            message: d.message,
            severity: mapSeverity(d.severity),
            range: new vscode.Range(
                new vscode.Position(d.range.from.line - 1, d.range.from.column),
                new vscode.Position(d.range.to.line - 1, d.range.to.column)
            ),
        });
    }

    dznDiagnosticsCollection.set(document.uri, documentDiagnostics);
}

function readIncludePaths(): string[] {
    const includePaths = vscode.workspace.getConfiguration("dznlint").get<string>("includePaths")?.trim() ?? "";
    const root = workspaceRoot();
    return includePaths.length > 0 
        ? includePaths.split(";")
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => path.join(root, p)) 
        : [];
}

function mapSeverity(severity: dznlint.DiagnosticSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
        case dznlint.DiagnosticSeverity.Hint:
            return vscode.DiagnosticSeverity.Information;
        case dznlint.DiagnosticSeverity.Warning:
            return vscode.DiagnosticSeverity.Warning;
        case dznlint.DiagnosticSeverity.Error:
            return vscode.DiagnosticSeverity.Error;
    }
}

function tryLoadDznLintConfig(): dznlint.DznLintUserConfiguration | undefined {
    if (!vscode.workspace.workspaceFolders) {
        return;
    }

    const configFilePath = path.join(workspaceRoot(), dznlint.DEFAULT_DZNLINT_CONFIG_FILE);

    if (fs.existsSync(configFilePath)) {
        return JSON.parse(fs.readFileSync(configFilePath).toString());
    }
}

function workspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
