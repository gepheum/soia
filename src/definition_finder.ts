/**
 * Utilities to help implement the jump-to-definition functionality for soia
 * files in IDEs.
 */
import type {
  Declaration,
  Module,
  ResolvedType,
  Token,
  Value,
} from "./types.js";

export interface DefinitionMatch {
  modulePath: string;
  position: number;
}

export function findDefinition(
  module: Module,
  position: number,
): DefinitionMatch | null {
  return findDefinitionInDeclarations(module.declarations, position);
}

function findDefinitionInDeclarations(
  declarations: readonly Declaration[],
  position: number,
): DefinitionMatch | null {
  for (const declaration of declarations) {
    const maybeMatch = findDefinitionInDeclaration(declaration, position);
    if (maybeMatch) {
      return maybeMatch;
    }
  }
  return null;
}

function findDefinitionInDeclaration(
  declaration: Declaration,
  position: number,
): DefinitionMatch | null {
  switch (declaration.kind) {
    case "constant": {
      return findDefinitionInValue(declaration.value, position);
    }
    case "field": {
      if (declaration.type) {
        return findDefinitionInResolvedType(declaration.type, position);
      }
      return null;
    }
    case "import":
    case "import-alias": {
      if (
        tokenContains(declaration.modulePath, position) &&
        declaration.resolvedModulePath
      ) {
        return {
          modulePath: declaration.resolvedModulePath,
          position: 0,
        };
      }
      return null;
    }
    case "method": {
      if (declaration.requestType) {
        const maybeMatch = findDefinitionInResolvedType(
          declaration.requestType,
          position,
        );
        if (maybeMatch) {
          return maybeMatch;
        }
      }
      if (declaration.responseType) {
        const maybeMatch = findDefinitionInResolvedType(
          declaration.responseType,
          position,
        );
        if (maybeMatch) {
          return maybeMatch;
        }
      }
      return null;
    }
    case "record": {
      return findDefinitionInDeclarations(declaration.fields, position);
    }
    case "removed": {
      return null;
    }
  }
}

function findDefinitionInValue(
  value: Value,
  position: number,
): DefinitionMatch | null {
  // TODO: we might want to support jump-to-definition when the user clicks on
  // a key within an object.
  return null;
}

function findDefinitionInResolvedType(
  type: ResolvedType,
  position: number,
): DefinitionMatch | null {
  switch (type.kind) {
    case "array": {
      if (type.key) {
        for (const item of type.key.path) {
          if (tokenContains(item.name, position)) {
            const maybeMatch = tokenToMatch(item.name);
            if (maybeMatch) {
              return maybeMatch;
            }
          }
        }
      }
      return findDefinitionInResolvedType(type.item, position);
    }
    case "optional": {
      return findDefinitionInResolvedType(type.other, position);
    }
    case "primitive": {
      return null;
    }
    case "record": {
      for (const namePart of type.nameParts) {
        if (tokenContains(namePart.token, position)) {
          return tokenToMatch(namePart.declaration.name);
        }
      }
      return null;
    }
  }
}

function tokenContains(token: Token, position: number): boolean {
  const end = token.position + token.text.length;
  return position >= token.position && position < end;
}

function tokenToMatch(token: Token): DefinitionMatch {
  return {
    modulePath: token.line.modulePath,
    position: token.position,
  };
}
