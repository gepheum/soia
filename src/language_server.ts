import * as yaml from "yaml";
import { fromZodError } from "zod-validation-error";
import { SoiaConfig } from "./config.js";
import { ModuleParser, ModuleSet } from "./module_set.js";
import { parseModule } from "./parser.js";
import { tokenizeModule } from "./tokenizer.js";
import type {
  Module,
  MutableModule,
  RecordKey,
  RecordLocation,
  Result,
  SoiaError,
} from "./types.js";

export class LanguageServerModuleSet {
  constructor(private readonly rootPath: string) {}

  setFileContent(uri: string, content: string): void {
    this.deleteFile(uri);
    const fileType = getFileType(uri);
    switch (fileType) {
      case "soia.yml": {
        const workspace = this.parseSoiaConfig(content, uri);
        if (workspace) {
          this.workspaces.set(uri, workspace);
          this.reassignModulesToWorkspaces();
        }
        break;
      }
      case "*.soia": {
        const moduleWorkspace = this.findModuleWorkspace(uri);
        const moduleBundle = this.parseSoiaModule(content, uri);
        this.moduleBundles.set(uri, moduleBundle);
        if (moduleWorkspace) {
          Workspace.addModule(moduleBundle, moduleWorkspace);
        }
        break;
      }
      default: {
        const _: null = fileType;
      }
    }
  }

  deleteFile(uri: string): void {
    const fileType = getFileType(uri);
    switch (fileType) {
      case "soia.yml": {
        if (this.workspaces.delete(uri)) {
          this.reassignModulesToWorkspaces();
        }
        break;
      }
      case "*.soia": {
        const moduleBundle = this.moduleBundles.get(uri);
        if (moduleBundle) {
          Workspace.removeModule(moduleBundle);
          this.moduleBundles.delete(uri);
        }
        break;
      }
      default: {
        const _: null = fileType;
      }
    }
  }

  private reassignModulesToWorkspaces(): void {
    if (this.reassigneModulesTimeout) {
      // Already scheduled, do nothing.
      return;
    }
    this.reassigneModulesTimeout = setTimeout(() => {
      for (const [moduleUri, moduleBundle] of this.moduleBundles.entries()) {
        Workspace.removeModule(moduleBundle);
        const newWorkspace = this.findModuleWorkspace(moduleUri);
        if (newWorkspace) {
          Workspace.addModule(moduleBundle, newWorkspace);
        }
      }
      for (const workspace of this.workspaces.values()) {
        workspace.scheduleResolution();
      }
      this.reassigneModulesTimeout = undefined;
    });
  }

  private parseSoiaConfig(content: string, uri: string): Workspace | null {
    let soiaConfig: SoiaConfig;
    {
      // `yaml.parse` fail with a helpful error message, no need to add context.
      const parseResult = SoiaConfig.safeParse(yaml.parse(content));
      if (parseResult.success) {
        soiaConfig = parseResult.data;
      } else {
        const validationError = fromZodError(parseResult.error);
        console.error(
          `Error parsing soia.yml at ${uri}:`,
          validationError.message,
        );
        return null;
      }
    }

    let rootUri = new URL(soiaConfig.srcDir || ".", uri).href;
    if (!rootUri.endsWith("/")) {
      rootUri += "/";
    }
    return new Workspace(rootUri);
  }

  private parseSoiaModule(content: string, uri: string): ModuleBundle {
    let astTree: Result<Module | null>;
    {
      const tokens = tokenizeModule(content, uri);
      if (tokens.errors.length !== 0) {
        astTree = {
          result: null,
          errors: tokens.errors,
        };
      } else {
        astTree = parseModule(tokens.result, uri, content);
      }
    }
    return {
      astTree,
      errors: [],
    };
  }

  /** Finds the workspace which contains the given module URI. */
  private findModuleWorkspace(moduleUri: string): ModuleWorkspace | undefined {
    let match: Workspace | undefined;
    const leftIsBetter = (
      left: Workspace,
      right: Workspace | undefined,
    ): boolean => {
      if (right === undefined || left.rootUri.length < right.rootUri.length) {
        return true;
      }
      if (left.rootUri.length === right.rootUri.length) {
        // Completely arbitrary, just to have a consistent order.
        return left.rootUri < right.rootUri;
      }
      return false;
    };
    for (const workspace of this.workspaces.values()) {
      const { rootUri } = workspace;
      if (moduleUri.startsWith(rootUri) && leftIsBetter(workspace, match)) {
        match = workspace;
      }
    }
    if (!match) {
      return undefined;
    }
    return {
      workspace: match,
      modulePath: moduleUri.substring(match.rootUri.length),
    };
  }

  private reassigneModulesTimeout?: NodeJS.Timeout;
  private readonly moduleBundles = new Map<string, ModuleBundle>(); // key: file URI
  private readonly workspaces = new Map<string, Workspace>(); // key: file URI
}

function errorToDiagnostic(error: SoiaError): Diagnostic {
  const { token, message, expected } = error;
  return {
    range: {
      start: token.position,
      end: token.position + token.text.length,
    },
    message: message ? message : `expected: ${expected}`,
  };
}

function getFileType(uri: string): "soia.yml" | "*.soia" | null {
  if (uri.endsWith("/soia.yml")) {
    return "soia.yml";
  } else if (uri.endsWith(".soia")) {
    return "*.soia";
  }
  return null;
}

interface Diagnostic {
  readonly range?: {
    readonly start: number;
    readonly end: number;
  };
  readonly message: string;
}

interface ModuleWorkspace {
  readonly workspace: Workspace;
  readonly modulePath: string;
}

interface ModuleBundle {
  readonly astTree: Result<Module | null>;
  moduleWorkspace?: ModuleWorkspace;
  errors: Diagnostic[];
}

class Workspace implements ModuleParser {
  constructor(readonly rootUri: string) {}

  private readonly mutableRecordMap = new Map<RecordKey, RecordLocation>();
  // key: module path
  private readonly modules = new Map<string, ModuleBundle>();
  private scheduledResolution?: {
    timeout: NodeJS.Timeout;
    promise: Promise<void>;
    callback: () => void;
  };

  static addModule(
    moduleBundle: ModuleBundle,
    moduleWorkspace: ModuleWorkspace,
  ): void {
    // If the module was already in a workspace, remove it from the old workspace.
    Workspace.removeModule(moduleBundle);
    const { workspace } = moduleWorkspace;
    moduleBundle.moduleWorkspace = moduleWorkspace;
    workspace.modules.set(moduleWorkspace.modulePath, moduleBundle);
    for (const record of moduleBundle.astTree.result?.records || []) {
      workspace.mutableRecordMap.set(record.record.key, record);
    }
    workspace.scheduleResolution();
  }

  static removeModule(moduleBundle: ModuleBundle): void {
    const { moduleWorkspace } = moduleBundle;
    if (!moduleWorkspace) {
      return;
    }
    const { workspace } = moduleWorkspace;
    workspace.modules.delete(moduleWorkspace.modulePath);
    for (const record of moduleBundle.astTree.result?.records || []) {
      workspace.mutableRecordMap.delete(record.record.key);
    }
    moduleBundle.moduleWorkspace = undefined;
    workspace.scheduleResolution();
  }

  parseModule(modulePath: string): Result<MutableModule | null> {
    const moduleBundle = this.modules.get(modulePath);
    if (!moduleBundle) {
      return {
        result: null,
        errors: [],
      };
    }
    return moduleBundle.astTree;
  }

  scheduleResolution(): void {
    if (this.scheduledResolution) {
      clearTimeout(this.scheduledResolution.timeout);
    }
    const delayMilliseconds = 500;
    const timeout = setTimeout(() => {
      this.scheduledResolution = undefined;
      this.resolve();
    }, delayMilliseconds);
    const scheduledResolution = {
      timeout,
      promise: new Promise<void>((resolve) => {
        scheduledResolution.callback = resolve;
      }),
      callback: (() => {
        throw new Error("callback not set");
      }) as () => void,
    };
    this.scheduledResolution = scheduledResolution;
  }

  get resolutionDone(): Promise<void> {
    if (this.scheduledResolution) {
      return this.scheduledResolution.promise;
    }
    return Promise.resolve();
  }

  /**
   * Synchronously performs type resolution (and validation).
   * Stores the errors in every module bundle.
   */
  private resolve(): void {
    const moduleSet = new ModuleSet(this);
    for (const [modulePath, moduleBundle] of this.modules.entries()) {
      const parseResult = moduleSet.parseAndResolve(modulePath);
      moduleBundle.errors = parseResult.errors.map(errorToDiagnostic);
    }
    if (this.scheduledResolution) {
      this.scheduledResolution.callback();
    }
  }
}
