import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";
import * as dznlint from "dznlint";

import { codeCompletionProvider } from "./code-completion";
import { astNameToString, dznLintRangeToVscode } from "./util";
import { hoverProvider } from "./hover";

const dznDiagnosticsCollection = vscode.languages.createDiagnosticCollection("dznlint-diagnostics");

let program: dznlint.Program;

// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    console.log("dznlint-vscode active");

    program = await dznlint.Program.Init();
    const typeChecker = new dznlint.semantics.TypeChecker(program);

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

    vscode.languages.registerDocumentFormattingEditProvider("dzn", {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.ProviderResult<vscode.TextEdit[]> {
            const formatConfiguration = configuration
                ? (configuration as { format?: dznlint.DznLintFormatUserConfiguration })["format"]
                : undefined;

            const fullText = document.getText();
            return dznlint
                .format(fullText, formatConfiguration)
                .then(newText => [
                    vscode.TextEdit.replace(
                        new vscode.Range(document.positionAt(0), document.positionAt(fullText.length)),
                        newText
                    ),
                ]);
        },
    });

    // Experimental IDE features
    if (vscode.workspace.getConfiguration("dznlint").get("ideFeatures", false)) {
        vscode.languages.registerDefinitionProvider("dzn", {
            provideDefinition(document, position): vscode.Location | undefined {
                const file = program.getCachedFile(document.fileName);
                if (file) {
                    const name = dznlint.utils.findNameAtPosition(file, position.line, position.character, program);
                    if (name) {
                        const symbol = typeChecker.symbolOfNode(name);
                        if (symbol) {
                            const file = dznlint.utils.findFirstParent(symbol?.declaration, dznlint.utils.isSourceFile);
                            if (file?.fileName) {
                                const declaration = nodeHasName(symbol.declaration)
                                    ? symbol.declaration.name
                                    : symbol.declaration;
                                return new vscode.Location(
                                    vscode.Uri.file(file.fileName),
                                    new vscode.Position(
                                        declaration.position.from.line,
                                        declaration.position.from.column
                                    )
                                );
                            }
                        }
                    } else {
                        const leafAtPosition = dznlint.utils.findLeafAtPosition(
                            file,
                            position.line,
                            position.character,
                            program
                        );
                        if (leafAtPosition) {
                            if (dznlint.utils.isImportStatement(leafAtPosition)) {
                                // Try to resolve from project root
                                let filePath = path.join(workspaceRoot(), leafAtPosition.fileName);
                                if (fs.existsSync(filePath)) {
                                    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
                                }
                                // Otherwise try to resolve relative to current file
                                filePath = path.join(path.dirname(document.fileName), leafAtPosition.fileName);
                                if (fs.existsSync(filePath)) {
                                    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
                                }
                            }
                        }
                    }
                }
                return undefined;
            },
        });

        vscode.languages.registerCompletionItemProvider("dzn", codeCompletionProvider(program, typeChecker), ".");

        vscode.languages.registerHoverProvider("dzn", hoverProvider(program, typeChecker));

        vscode.languages.registerInlayHintsProvider("dzn", {
            provideInlayHints(document, range, token): vscode.InlayHint[] | undefined {
                const file = program.getCachedFile(document.fileName);
                if (file?.ast) {
                    const hints: vscode.InlayHint[] = [];

                    dznlint.ast.visitFile(
                        file.ast,
                        file.source,
                        node => {
                            if (dznlint.utils.isOnStatement(node)) {
                                for (const trigger of node.triggers) {
                                    if (
                                        !dznlint.utils.isKeyword(trigger) &&
                                        !dznlint.utils.isErrorNode(trigger) &&
                                        trigger.parameterList
                                    ) {
                                        const triggerSymbol = typeChecker.symbolOfNode(trigger.name);
                                        if (triggerSymbol) {
                                            const declaration = triggerSymbol.declaration as dznlint.ast.Event;
                                            for (
                                                let i = 0;
                                                i <
                                                Math.min(
                                                    declaration.parameters.length,
                                                    trigger.parameterList.parameters.length
                                                );
                                                i++
                                            ) {
                                                const direction = declaration.parameters[i].direction?.text ?? "in";
                                                const type = dznlint.utils.nameToString(
                                                    declaration.parameters[i].type.typeName
                                                );
                                                hints.push({
                                                    label: `${direction} ${type}`,
                                                    position: dznLintRangeToVscode(
                                                        trigger.parameterList.parameters[i].position
                                                    ).start,
                                                    paddingRight: true,
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        program
                    );

                    return hints;
                }

                return undefined;
            },
        });

        vscode.languages.registerSignatureHelpProvider(
            "dzn",
            {
                provideSignatureHelp(document, position, token, context): vscode.SignatureHelp | undefined {
                    const file = program.getCachedFile(document.fileName);
                    if (file) {
                        const node = dznlint.utils.findLeafAtPosition(file, position.line, position.character, program);
                        if (node && dznlint.utils.isCallExpression(node)) {
                            const type = typeChecker.typeOfNode(node.expression);
                            if (!type.declaration) return undefined;
                            if (
                                !dznlint.utils.isEvent(type.declaration) &&
                                !dznlint.utils.isFunctionDefinition(type.declaration)
                            )
                                return undefined;

                            const help = new vscode.SignatureHelp();
                            help.signatures.push(new vscode.SignatureInformation(type.name));
                            help.activeSignature = 0;
                            help.signatures[0].label += `(`;
                            let paramIndex = help.signatures[0].label.length;
                            for (let i = 0; i < type.declaration.parameters.length; i++) {
                                const param = type.declaration.parameters[i];
                                const label = `${param.direction?.text ?? "in"} ${astNameToString(
                                    param.type.typeName
                                )} ${astNameToString(param.name)}`;
                                help.signatures[0].label += label;
                                help.signatures[0].parameters.push({
                                    label: [paramIndex, help.signatures[0].label.length],
                                });
                                if (i < type.declaration.parameters.length - 1) {
                                    help.signatures[0].label += ", ";
                                }
                                paramIndex = help.signatures[0].label.length;
                            }
                            help.signatures[0].label += `)`;

                            help.activeParameter = 0;
                            for (const arg of node.arguments.arguments) {
                                if (dznLintRangeToVscode(arg.position).end.isBefore(position)) {
                                    help.activeParameter++;
                                } else {
                                    break;
                                }
                            }

                            return help;
                        }
                    }
                    return undefined;
                },
            },
            "(",
            ","
        );
    }
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
            range: dznLintRangeToVscode(d.range),
        });
    }

    dznDiagnosticsCollection.set(document.uri, documentDiagnostics);
}

export function readIncludePaths(): string[] {
    let includePaths = vscode.workspace.getConfiguration("dznlint").get<string>("includePaths")?.trim() ?? "";
    if (includePaths.length === 0) {
        // If no dznlint include dirs were found, try looking for dezyne.ide include paths instead
        includePaths = vscode.workspace.getConfiguration("dezyne.ide").get<string>("importPath")?.trim() ?? "";
    }

    const root = workspaceRoot();

    let splitPaths: string[];
    if (includePaths.includes("-I ")) {
        splitPaths = includePaths
            .split("-I ")
            .map(p => p.trim())
            .filter(p => p.length > 0);
    } else {
        splitPaths = includePaths
            .split(";")
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }
    return splitPaths.map(p => (path.isAbsolute(p) ? p : path.join(root, p)));
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

export function workspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function nodeHasName(node: dznlint.ast.AnyAstNode): node is dznlint.ast.AnyAstNode & { name: dznlint.ast.AnyAstNode } {
    return "name" in node;
}
