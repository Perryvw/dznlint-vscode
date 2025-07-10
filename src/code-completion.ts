import * as dznlint from "dznlint";
import * as vscode from "vscode";
import { astNameToString, dznLintRangeToVscode } from "./util";
import { findFirstParent, isKeyword } from "dznlint/util";

export function codeCompletionProvider(
    program: dznlint.Program,
    typeChecker: dznlint.semantics.TypeChecker
): vscode.CompletionItemProvider {
    return {
        provideCompletionItems(document, position, token, context) {
            const file = program.getCachedFile(document.fileName);
            if (file) {
                const leafAtPosition = dznlint.utils.findLeafAtPosition(
                    file,
                    position.line,
                    position.character,
                    program
                );
                if (leafAtPosition) {
                    if (!shouldCompleteNode(leafAtPosition)) return undefined;

                    const { scope, isMember, owningSymbol, range } = getCompletionScope(
                        leafAtPosition,
                        position,
                        typeChecker
                    );
                    const items: vscode.CompletionItem[] = [];
                    if (owningSymbol) {
                        const ownerType = typeChecker.typeOfSymbol(owningSymbol);
                        const members = typeChecker.getMembersOfType(ownerType);
                        for (const [name, symbol] of members) {
                            items.push(completionItemForNode(name, symbol.declaration, range));
                        }
                    } else if (isMember) {
                        return undefined; // We are a member but no owning symbol -> can't autocomplete
                    } else {
                        // Not a member, autocomplete with variables available in scope
                        for (const [name, declaration] of typeChecker.findAllVariablesKnownInScope(scope)) {
                            items.push(completionItemForNode(name, declaration, range));
                        }
                        items.push(...keywordsInScope(scope));
                    }
                    return new vscode.CompletionList(items);
                }
            }
        },
    };
}

function shouldCompleteNode(node: dznlint.ast.AnyAstNode): boolean {
    if (dznlint.utils.isIdentifier(node) && node.parent) {
        // Don't try to autocomplete the names of definitions (as you cannot complete the thing you're currently definiing)
        if (dznlint.utils.isVariableDefinition(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isFunctionParameter(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isOnParameter(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isEventParameter(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isPort(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isEvent(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isEventParameter(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isInstance(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isFunctionDefinition(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isEnumDefinition(node.parent))
            return false; // Don't complete the name nor values of an enum
        else if (dznlint.utils.isExtern(node.parent)) return false;
        else if (dznlint.utils.isComponentDefinition(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isInterfaceDefinition(node.parent) && node === node.parent.name) return false;
        else if (dznlint.utils.isIntDefinition(node.parent)) return false;
    }

    return true;
}

function getCompletionScope(
    node: dznlint.ast.AnyAstNode,
    position: vscode.Position,
    typeChecker: dznlint.semantics.TypeChecker
): {
    scope: dznlint.utils.ScopedBlock;
    isMember: boolean;
    owningSymbol?: dznlint.semantics.SemanticSymbol;
    range?: dznlint.SourceRange;
} {
    if (dznlint.utils.isIdentifier(node)) {
        const scope = dznlint.utils.findFirstParent(node, dznlint.utils.isScopedBlock)!;
        if (node.parent && dznlint.utils.isCompoundName(node.parent) && node === node.parent.name) {
            // We are completing X.Y<cursor> where X is owning symbol
            return {
                scope,
                isMember: true,
                owningSymbol: node.parent.compound && typeChecker.symbolOfNode(node.parent.compound),
                range: node.position,
            };
        } else {
            // We are in the left-hand side of compound: X<cursor>.Y
            return {
                scope,
                isMember: false,
                range: node.position,
            };
        }
    } else if (dznlint.utils.isCompoundName(node)) {
        const scope = dznlint.utils.findFirstParent(node, dznlint.utils.isScopedBlock)!;
        // We are in a compound name but not an identifier, X.<cursor> or .<cursor>
        if (node.compound) {
            // X.<cursor>
            return {
                scope,
                isMember: true,
                owningSymbol: typeChecker.symbolOfNode(node.compound),
            };
        } else {
            // .<cursor>
            return {
                scope,
                isMember: false, // explicitly global compound
            };
        }
    } else if (dznlint.utils.isCompoundBindingExpression(node)) {
        const scope = dznlint.utils.findFirstParent(node, dznlint.utils.isScopedBlock)!;
        // We are in a compound name but not an identifier, X.<cursor> or .<cursor>
        if (node.compound) {
            // X.<cursor>
            return {
                scope,
                isMember: true,
                owningSymbol: typeChecker.symbolOfNode(node.compound),
            };
        } else {
            // .<cursor>
            return {
                scope,
                isMember: false, // explicitly global compound
            };
        }
        // Following cases are added to handle weird parse results from incomplete trees
    } else if (dznlint.utils.isReply(node)) {
        const scope = dznlint.utils.findFirstParent(node, dznlint.utils.isScopedBlock)!;
        return {
            scope,
            isMember: false,
            owningSymbol: node.port && typeChecker.symbolOfNode(node.port),
            range: node.port?.position,
        };
    } else if (dznlint.utils.isGuardStatement(node)) {
        return {
            scope: node,
            isMember: true,
            owningSymbol: typeChecker.symbolOfNode(node.condition),
        };
    } else if (dznlint.utils.isErrorNode(node)) {
        const { scope, owningObject } = dznlint.utils.findNameAtLocationInErrorNode(
            node,
            position.line,
            position.character,
            typeChecker
        );
        return {
            scope,
            isMember: owningObject !== undefined,
            owningSymbol: owningObject,
        };
    } else if (dznlint.utils.isScopedBlock(node)) {
        return {
            scope: node,
            isMember: false,
        };
    } else {
        const scope = dznlint.utils.findFirstParent(node, dznlint.utils.isScopedBlock)!;
        return {
            scope,
            isMember: false,
        };
    }
}

function keywordsInScope(scope: dznlint.utils.ScopedBlock): vscode.CompletionItem[] {
    const keywords = [keywordCompletionItem("enum")];

    const needKeywordsForScope = (scopeType: dznlint.utils.ScopedBlock["kind"]) =>
        scope.kind === scopeType ||
        findFirstParent(scope, (p): p is dznlint.ast.Behavior => p.kind === scopeType) !== undefined;

    if (needKeywordsForScope(dznlint.ast.SyntaxKind.Behavior)) {
        keywords.push(
            keywordCompletionItem("on"),
            keywordCompletionItem("if"),
            keywordCompletionItem("in"),
            keywordCompletionItem("out"),
            // TODO: These should be in dznlint.typeChecker.findAllVariablesKnownInScope
            keywordCompletionItem("true"),
            keywordCompletionItem("false"),
            keywordCompletionItem("illegal"),
            keywordCompletionItem("void"),
            keywordCompletionItem("bool"),
            keywordCompletionItem("reply")
        );

        if (needKeywordsForScope(dznlint.ast.SyntaxKind.FunctionDefinition)) {
            // Only suggest return insdie functions
            keywords.push(keywordCompletionItem("return"));
        }
    } else {
        if (needKeywordsForScope(dznlint.ast.SyntaxKind.ComponentDefinition)) {
            keywords.push(
                keywordCompletionItem("behavior"),
                keywordCompletionItem("system"),
                keywordCompletionItem("requires"),
                keywordCompletionItem("provides")
            );
        } else if (needKeywordsForScope(dznlint.ast.SyntaxKind.InterfaceDefinition)) {
            keywords.push(
                keywordCompletionItem("behavior"),
                keywordCompletionItem("in"),
                keywordCompletionItem("out"),
                // TODO: These should be in dznlint.typeChecker.findAllVariablesKnownInScope
                keywordCompletionItem("void"),
                keywordCompletionItem("bool"),
                keywordCompletionItem("reply")
            );
        } else {
            if (!needKeywordsForScope(dznlint.ast.SyntaxKind.Namespace)) {
                // Only complete import when not inside a namespace
                keywords.push(keywordCompletionItem("import"));
            }

            keywords.push(
                keywordCompletionItem("namespace"),
                keywordCompletionItem("extern"),
                keywordCompletionItem("subint"),
                keywordCompletionItem("component"),
                keywordCompletionItem("interface")
            );
        }
    }

    return keywords;
}

function completionItemForNode(
    name: string,
    node: dznlint.ast.AnyAstNode,
    range?: dznlint.SourceRange
): vscode.CompletionItem {
    if (dznlint.utils.isEvent(node) || dznlint.utils.isFunctionDefinition(node)) {
        return functionLikeCompletionItem(name, node, range);
    }

    return {
        label: {
            label: name,
            description: completionDetail(node),
        },
        kind: completionKind(node),
        range: range && dznLintRangeToVscode(range),
    };
}

function functionLikeCompletionItem(
    name: string,
    node: dznlint.ast.Event | dznlint.ast.FunctionDefinition,
    range?: dznlint.SourceRange
): vscode.CompletionItem {
    const parameters = node.parameters.map(p => `${p.direction?.text} ${astNameToString(p.name)}`);

    return {
        label: {
            label: name,
            detail: `(${parameters.join(", ")})`,
            description: completionDetail(node),
        },
        kind: completionKind(node),
        range: range && dznLintRangeToVscode(range),
    };
}

function keywordCompletionItem(name: string): vscode.CompletionItem {
    return {
        label: name,
        kind: vscode.CompletionItemKind.Keyword,
    };
}

function completionKind(node: dznlint.ast.AnyAstNode): vscode.CompletionItemKind {
    switch (node.kind) {
        case dznlint.ast.SyntaxKind.Event:
            return vscode.CompletionItemKind.Event;
        case dznlint.ast.SyntaxKind.EnumDefinition:
            return vscode.CompletionItemKind.Enum;
        case dznlint.ast.SyntaxKind.Port:
            return vscode.CompletionItemKind.Field;
        case dznlint.ast.SyntaxKind.InterfaceDefinition:
            return vscode.CompletionItemKind.Interface;
        case dznlint.ast.SyntaxKind.Namespace:
            return vscode.CompletionItemKind.Module;
        case dznlint.ast.SyntaxKind.ComponentDefinition:
            return vscode.CompletionItemKind.Class;
        case dznlint.ast.SyntaxKind.ExternDeclaration:
            return vscode.CompletionItemKind.TypeParameter;
        case dznlint.ast.SyntaxKind.OnParameter:
        case dznlint.ast.SyntaxKind.VariableDefinition:
        case dznlint.ast.SyntaxKind.IntDefinition:
            return vscode.CompletionItemKind.Variable;
        case dznlint.ast.SyntaxKind.FunctionDefinition:
            return vscode.CompletionItemKind.Function;
        case dznlint.ast.SyntaxKind.Keyword:
            if (dznlint.utils.isReplyKeyword(node)) return vscode.CompletionItemKind.Property;
            return vscode.CompletionItemKind.Constant;
        case dznlint.ast.SyntaxKind.Instance:
            return vscode.CompletionItemKind.Variable;
        case dznlint.ast.SyntaxKind.Identifier:
            if (node.parent?.kind === dznlint.ast.SyntaxKind.EnumDefinition) {
                return vscode.CompletionItemKind.EnumMember;
            }
        default:
            return vscode.CompletionItemKind.Text;
    }
}

function completionDetail(node: dznlint.ast.AnyAstNode): string | undefined {
    switch (node.kind) {
        case dznlint.ast.SyntaxKind.Event:
            return "event";
        case dznlint.ast.SyntaxKind.EnumDefinition:
            return "enum";
        case dznlint.ast.SyntaxKind.Port:
            return "port";
        case dznlint.ast.SyntaxKind.InterfaceDefinition:
            return "interface";
        case dznlint.ast.SyntaxKind.Namespace:
            return "namespace";
        case dznlint.ast.SyntaxKind.ComponentDefinition:
            return "component";
        case dznlint.ast.SyntaxKind.ExternDeclaration:
            return "extern";
        case dznlint.ast.SyntaxKind.OnParameter:
            return "parameter";
        case dznlint.ast.SyntaxKind.VariableDefinition:
            return "var";
        case dznlint.ast.SyntaxKind.IntDefinition:
            return "int";
        case dznlint.ast.SyntaxKind.FunctionDefinition:
            return "function";
        case dznlint.ast.SyntaxKind.Keyword:
            return isKeyword(node) ? node.text : undefined;
    }
    return undefined;
}
