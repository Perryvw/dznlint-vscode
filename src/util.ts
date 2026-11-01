import * as dznlint from "dznlint";
import * as vscode from "vscode";

export function dznLintRangeToVscode(range: dznlint.SourceRange): vscode.Range {
    return new vscode.Range(
        new vscode.Position(Math.max(0, range.from.line), range.from.column),
        new vscode.Position(Math.max(0, range.to.line), range.to.column)
    );
}

export function astNameToString(name: dznlint.ast.Name): string {
    if (dznlint.utils.isCompoundName(name)) {
        return `${name.compound ? astNameToString(name.compound) : ""}.${name.name.text}`;
    } else {
        return name.text;
    }
}
