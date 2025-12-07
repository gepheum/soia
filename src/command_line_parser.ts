export type ParsedArgs =
  | {
      kind: "gen";
      root?: string;
      watch?: true;
    }
  | {
      kind: "format";
      root?: string;
      check?: true;
    }
  | {
      kind: "snapshot";
      root?: string;
      check?: true;
    }
  | {
      kind: "init";
      root?: string;
    }
  | {
      kind: "help";
      root?: undefined;
    }
  | {
      kind: "error";
      root?: undefined;
    };

/**
 * Parse command-line arguments and return a structured representation.
 *
 * @param args - Array of command-line arguments (typically process.argv.slice(2))
 * @returns ParsedCommandLine object representing the command and its options
 */
export function parseCommandLine(args: string[]): ParsedArgs {
  if (args.length === 0) {
    printHelp();
    return { kind: "help" };
  }

  const command = args[0];

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return { kind: "help" };
  }

  const validCommands = ["gen", "format", "snapshot", "init"];
  if (!command || !validCommands.includes(command)) {
    printError(`Unknown command: ${command}`);
    printHelp();
    return { kind: "error" };
  }

  try {
    const options = parseOptions(args.slice(1));

    switch (command) {
      case "gen":
        return buildGenCommand(options);
      case "format":
        return buildFormatCommand(options);
      case "snapshot":
        return buildSnapshotCommand(options);
      case "init":
        return buildInitCommand(options);
      default:
        throw new CommandLineParseError(`Unexpected command: ${command}`);
    }
  } catch (error) {
    if (error instanceof CommandLineParseError) {
      printError(error.message);
      return { kind: "error" };
    }
    throw error;
  }
}

const COMMAND_BASE = "npx skir";

const HELP_TEXT = `
Usage: ${COMMAND_BASE} <command> [options]

Commands:
  gen         Generate code from Skir source files to target languages
  format      Format all .skir files in the specified directory
  snapshot    Verify compatibility by comparing current .skir files against the last snapshot
  init        Initialize a new Skir project with a minimal skir.yml file
  help        Display this help message

Options:
  --root, -r <path>    Path to the directory containing the skir.yml configuration file
  --watch, -w          Enable watch mode to automatically regenerate code when .skir files change (gen only)
  --check, -c          Check mode: fail if code is not properly formatted (format) or if there are breaking changes (snapshot)

Examples:
  ${COMMAND_BASE} gen
  ${COMMAND_BASE} format --root path/to/root/dir
  ${COMMAND_BASE} format -r path/to/root/dir
  ${COMMAND_BASE} gen -r path/to/root/dir --watch
  ${COMMAND_BASE} snapshot --root path/to/root/dir
`;

export class CommandLineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandLineParseError";
  }
}

type ParsedOptions = {
  root?: string;
  watch?: boolean;
  check?: boolean;
  unknown: string[];
};

function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {
    unknown: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--root" || arg === "-r") {
      if (i + 1 >= args.length) {
        throw new CommandLineParseError(`Option ${arg} requires a value`);
      }
      if (options.root !== undefined) {
        throw new CommandLineParseError(
          `Option ${arg} specified multiple times`,
        );
      }
      options.root = args[i + 1];
      i++; // Skip the next argument as it's the value
    } else if (arg === "--watch" || arg === "-w") {
      if (options.watch) {
        throw new CommandLineParseError(
          `Option ${arg} specified multiple times`,
        );
      }
      options.watch = true;
    } else if (arg === "--check" || arg === "-c") {
      if (options.check) {
        throw new CommandLineParseError(
          `Option ${arg} specified multiple times`,
        );
      }
      options.check = true;
    } else if (arg.startsWith("-")) {
      options.unknown.push(arg);
    } else {
      throw new CommandLineParseError(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function buildGenCommand(options: ParsedOptions): ParsedArgs {
  validateNoUnknownOptions(options, "gen");

  if (options.check) {
    throw new CommandLineParseError(
      "Option --check is not valid for the 'gen' command",
    );
  }

  return {
    kind: "gen",
    root: options.root,
    watch: options.watch ? true : undefined,
  };
}

function buildFormatCommand(options: ParsedOptions): ParsedArgs {
  validateNoUnknownOptions(options, "format");

  if (options.watch) {
    throw new CommandLineParseError(
      "Option --watch is not valid for the 'format' command",
    );
  }

  return {
    kind: "format",
    root: options.root,
    check: options.check ? true : undefined,
  };
}

function buildSnapshotCommand(options: ParsedOptions): ParsedArgs {
  validateNoUnknownOptions(options, "snapshot");

  if (options.watch) {
    throw new CommandLineParseError(
      "Option --watch is not valid for the 'snapshot' command",
    );
  }

  return {
    kind: "snapshot",
    root: options.root,
    check: options.check ? true : undefined,
  };
}

function buildInitCommand(options: ParsedOptions): ParsedArgs {
  validateNoUnknownOptions(options, "init");

  if (options.watch) {
    throw new CommandLineParseError(
      "Option --watch is not valid for the 'init' command",
    );
  }

  if (options.check) {
    throw new CommandLineParseError(
      "Option --check is not valid for the 'init' command",
    );
  }

  return {
    kind: "init",
    root: options.root,
  };
}

function validateNoUnknownOptions(
  options: ParsedOptions,
  command: string,
): void {
  if (options.unknown.length > 0) {
    throw new CommandLineParseError(
      `Unknown option${options.unknown.length > 1 ? "s" : ""} for '${command}': ${options.unknown.join(", ")}`,
    );
  }
}

function printHelp(): void {
  console.log(HELP_TEXT);
}

function printError(message: string): void {
  console.error(`Error: ${message}\n`);
}
