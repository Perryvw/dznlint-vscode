import * as dznlint from "dznlint";
import * as vscode from "vscode";
import { astNameToString } from "./util";
import { isKeyword } from "dznlint/util";

export function hoverProvider(
    program: dznlint.Program,
    typeChecker: dznlint.semantics.TypeChecker
): vscode.HoverProvider {
    return {
        provideHover(document, position, token): vscode.ProviderResult<vscode.Hover> {
            const file = program.getCachedFile(document.fileName);
            if (file) {
                const leafAtPosition = dznlint.utils.findLeafAtPosition(
                    file,
                    position.line,
                    position.character,
                    program
                );
                if (leafAtPosition && dznlint.utils.isIdentifier(leafAtPosition)) {
                    const symbol = typeChecker.symbolOfNode(leafAtPosition);
                    if (symbol && !isKeyword(symbol.declaration)) {
                        const tooltip = symbolTooltip(symbol.declaration, typeChecker);
                        if (tooltip) {
                            return {
                                contents: tooltip,
                            };
                        }
                    }
                }
            }
        },
    };
}

type Tooltip = vscode.MarkdownString[];

function symbolTooltip(
    declaration: dznlint.ast.AnyAstNode,
    typeChecker: dznlint.semantics.TypeChecker
): Tooltip | undefined {
    if (dznlint.utils.isFunctionDefinition(declaration)) return functionTooltip(declaration);
    if (dznlint.utils.isEvent(declaration)) return eventTooltip(declaration);
    if (dznlint.utils.isPort(declaration)) return portTooltip(declaration);
    if (dznlint.utils.isOnParameter(declaration)) return onParameterTooltip(declaration, typeChecker);
    if (dznlint.utils.isVariableDefinition(declaration)) return variableDefinitionTooltip(declaration);
    if (dznlint.utils.isExtern(declaration)) return externDefinitionTooltip(declaration);
    if (dznlint.utils.isInstance(declaration)) return instanceTooltip(declaration);

    return undefined;
}

function functionTooltip(declaration: dznlint.ast.FunctionDefinition): Tooltip {
    const typeName = astNameToString(declaration.returnType.typeName);
    const funcName = astNameToString(declaration.name);
    const params = declaration.parameters
        .map(
            p =>
                `${p.direction ? p.direction.text + " " : ""}${astNameToString(p.type.typeName)} ${astNameToString(
                    p.name
                )}`
        )
        .join(", ");
    return [dznHighlightedString(`${typeName} ${funcName}(${params})`)];
}

function eventTooltip(declaration: dznlint.ast.Event): Tooltip {
    const typeName = astNameToString(declaration.type.typeName);
    const interfaceName =
        declaration.parent && dznlint.utils.isInterfaceDefinition(declaration.parent)
            ? `${astNameToString(declaration.parent.name)}.`
            : "";
    const funcName = astNameToString(declaration.name);
    const params = declaration.parameters
        .map(
            p =>
                `${p.direction ? p.direction.text + " " : ""}${astNameToString(p.type.typeName)} ${astNameToString(
                    p.name
                )}`
        )
        .join(", ");
    return [dznHighlightedString(`${typeName} ${interfaceName}${funcName}(${params});`)];
}

function portTooltip(declaration: dznlint.ast.Port): Tooltip {
    return [
        dznHighlightedString(
            `${declaration.direction.text} ${astNameToString(declaration.type.typeName)} ${astNameToString(
                declaration.name
            )};`
        ),
    ];
}

function onParameterTooltip(declaration: dznlint.ast.OnParameter, typeChecker: dznlint.semantics.TypeChecker): Tooltip {
    const parentOn = dznlint.utils.findFirstParent<dznlint.ast.OnPortTrigger>(
        declaration,
        (p: dznlint.ast.AnyAstNode): p is dznlint.ast.OnPortTrigger => p.kind === dznlint.ast.SyntaxKind.OnTrigger
    );
    if (!parentOn) {
        throw `Can't find expected on trigger parent for OnParameter`;
    }

    const eventType = typeChecker.typeOfNode(parentOn.name);
    if (
        eventType === dznlint.semantics.ERROR_TYPE ||
        !eventType.declaration ||
        !dznlint.utils.isEvent(eventType.declaration)
    ) {
        // Return on statement without types
        const params = parentOn.parameterList?.parameters.map(p =>
            p.assignment ? `${astNameToString(p.name)} <- ${astNameToString(p.assignment)}` : astNameToString(p.name)
        );

        return [dznHighlightedString(`on ${astNameToString(parentOn.name)}(${params?.join(", ")}):`)];
    } else {
        // Return on statement enhanced with types
        const params = eventType.declaration.parameters.map((p, i) => {
            const typedParam = `${p.direction ? p.direction.text + " " : ""}${astNameToString(
                p.type.typeName
            )} ${astNameToString(p.name)}`;
            const assignment = parentOn.parameterList?.parameters[i]?.assignment;
            if (assignment) {
                return `${typedParam} <- ${astNameToString(assignment)}`;
            } else {
                return typedParam;
            }
        });

        return [dznHighlightedString(`on ${astNameToString(parentOn.name)}(${params?.join(", ")}):`)];
    }
}

function variableDefinitionTooltip(declaration: dznlint.ast.VariableDefinition): Tooltip {
    return [
        dznHighlightedString(`${astNameToString(declaration.type.typeName)} ${astNameToString(declaration.name)};`),
    ];
}

function externDefinitionTooltip(declaration: dznlint.ast.ExternDeclaration): Tooltip {
    return [dznHighlightedString(`extern ${astNameToString(declaration.name)} $${declaration.value.text}$;`)];
}

function instanceTooltip(declaration: dznlint.ast.Instance): Tooltip {
    return [
        dznHighlightedString(`${astNameToString(declaration.type.typeName)} ${astNameToString(declaration.name)};`),
    ];
}

function dznHighlightedString(str: string): vscode.MarkdownString {
    return new vscode.MarkdownString(`\`\`\`dzn\n${str}`);
}
