import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { DEMO_ROUTES, HTTP_METHODS, demoRouteAccess } from './routes';

const app = resolve('src/app');
const pages = resolve('src/pages');
const filenames = (root: string, pattern: RegExp) => readdirSync(resolve(root, 'api'), { recursive: true })
  .map(String)
  .filter(file => pattern.test(file))
  .map(file => resolve(root, 'api', file));
const appFiles = filenames(app, /(?:^|\/)route\.ts$/);
const pagesFiles = filenames(pages, /\.ts$/);
const config = ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram([...appFiles, ...pagesFiles], options);
const checker = program.getTypeChecker();
const supported = [...HTTP_METHODS, 'HEAD', 'OPTIONS'];

function exportsFrom(file: string) {
  const source = program.getSourceFile(file)!;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
}

function pagesMethods(file: string) {
  const exported = exportsFrom(file).find(symbol => symbol.name === 'default');
  if (!exported) throw new Error(`Missing default Pages API handler in ${file}`);
  const handler = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const node = handler.valueDeclaration;
  // A Pages API handler that dispatches requests itself is reachable for every
  // verb unless it rejects all but one with an early method check.
  if (node && ts.isFunctionDeclaration(node)) {
    for (const statement of node.body?.statements ?? []) {
      if (!ts.isIfStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
      const { left, operatorToken, right } = statement.expression;
      if (ts.isPropertyAccessExpression(left) && left.name.text === 'method'
        && ts.isIdentifier(left.expression) && node.parameters[0]?.name.getText() === left.expression.text
        && operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        && ts.isStringLiteral(right) && ts.isBlock(statement.thenStatement)
        && ts.isReturnStatement(statement.thenStatement.statements.at(-1)!)) return [right.text];
    }
  }
  return HTTP_METHODS;
}

it('classifies every exported App and Pages API handler and rejects stale entries', () => {
  const actual = [
    ...appFiles.flatMap(file => exportsFrom(file)
      .filter(symbol => supported.includes(symbol.name))
      .map(symbol => `${symbol.name} /${relative(app, file).replace(/\/route\.ts$/, '')}`)),
    ...pagesFiles.flatMap(file => pagesMethods(file).map(method =>
      `${method} /${relative(pages, file).replace(/\.ts$/, '').replace(/\/index$/, '')}`)),
  ];
  const classified = Object.entries(DEMO_ROUTES).flatMap(([path, methods]) =>
    Object.keys(methods).map(method => `${method} ${path}`));
  expect(classified.sort()).toEqual(actual.sort());
});

it('matches listing detail without overriding literal endpoints or admitting unknown methods', () => {
  expect(demoRouteAccess('/api/traffic/DEMO-1', 'GET')).toBe('read');
  expect(demoRouteAccess('/api/traffic/notes/', 'POST')).toBe('deny');
  expect(demoRouteAccess('/api/traffic/DEMO-1', 'DELETE')).toBe('deny');
  expect(demoRouteAccess('/api/traffic/DEMO-1/nested', 'GET')).toBe('deny');
  expect(demoRouteAccess('/api/new-route', 'GET')).toBe('deny');
});
