# dznlint for VSCode

This extension adds `dznlint` integration to VSCode. dnzlint is a static analysis and linting tool for [the Dezyne language](https://dezyne.org/).

## Configuring linting ruleset

To configure the ruleset you want to use for your project, add a `dznlint.config.json` file to your workspace root.

For example:

```json
{
    "implicit_illegal": "warning", // Do not allow explicit illegals
    "naming_convention": {
        "component": "[A-Z][a-zA-Z0-9]*", // Set naming convention for component
        "interface": "I[A-Z][a-zA-Z0-9]*" // Set naming convention for interface
    },
    "no_shadowing": "warning" // Set shadowing rule violations to 'warning' severity
}
```

For all configuration options, see [the dznlint repository](https://github.com/Perryvw/dznlint).
