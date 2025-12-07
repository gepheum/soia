/**
 * Utilities to help implement the jump-to-definition functionality for skir
 * files in IDEs.
 */
import type { Declaration, Module, ResolvedType, Token } from "./types.js";

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
      if (declaration.type) {
        const maybeMatch = findDefinitionInResolvedType(
          declaration.type,
          position,
        );
        if (maybeMatch) {
          return maybeMatch;
        }
      }
      return null;
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

export function findTokensWithDefinition(module: Module): readonly Token[] {
  const finder = new TokensWithDefinitionFinder();
  finder.findInDeclarations(module.declarations);
  return finder.tokens;
}

class TokensWithDefinitionFinder {
  tokens: Token[] = [];

  findInDeclarations(declarations: readonly Declaration[]): void {
    for (const declaration of declarations) {
      this.findInDeclaration(declaration);
    }
  }

  findInDeclaration(declaration: Declaration): null {
    switch (declaration.kind) {
      case "constant":
      case "field": {
        if (declaration.type) {
          this.findInResolvedType(declaration.type);
        }
        return null;
      }
      case "import":
      case "import-alias": {
        this.tokens.push(declaration.modulePath);
        return null;
      }
      case "method": {
        if (declaration.requestType) {
          this.findInResolvedType(declaration.requestType);
        }
        if (declaration.responseType) {
          this.findInResolvedType(declaration.responseType);
        }
        return null;
      }
      case "record": {
        this.findInDeclarations(declaration.fields);
        return null;
      }
      case "removed": {
        return null;
      }
    }
  }

  findInResolvedType(type: ResolvedType): null {
    switch (type.kind) {
      case "array": {
        if (type.key) {
          for (const item of type.key.path) {
            if (item.declaration) {
              this.tokens.push(item.name);
            }
          }
        }
        return this.findInResolvedType(type.item);
      }
      case "optional": {
        return this.findInResolvedType(type.other);
      }
      case "primitive": {
        return null;
      }
      case "record": {
        for (const namePart of type.nameParts) {
          if (namePart.declaration) {
            this.tokens.push(namePart.token);
          }
        }
        return null;
      }
    }
  }
}
