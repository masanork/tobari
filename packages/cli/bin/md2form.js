#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// ../../node_modules/commander/lib/error.js
var require_error = __commonJS((exports) => {
  class CommanderError extends Error {
    constructor(exitCode, code, message) {
      super(message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
      this.code = code;
      this.exitCode = exitCode;
      this.nestedError = undefined;
    }
  }

  class InvalidArgumentError extends CommanderError {
    constructor(message) {
      super(1, "commander.invalidArgument", message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
    }
  }
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
});

// ../../node_modules/commander/lib/argument.js
var require_argument = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Argument {
    constructor(name, description) {
      this.description = description || "";
      this.variadic = false;
      this.parseArg = undefined;
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.argChoices = undefined;
      switch (name[0]) {
        case "<":
          this.required = true;
          this._name = name.slice(1, -1);
          break;
        case "[":
          this.required = false;
          this._name = name.slice(1, -1);
          break;
        default:
          this.required = true;
          this._name = name;
          break;
      }
      if (this._name.length > 3 && this._name.slice(-3) === "...") {
        this.variadic = true;
        this._name = this._name.slice(0, -3);
      }
    }
    name() {
      return this._name;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    argRequired() {
      this.required = true;
      return this;
    }
    argOptional() {
      this.required = false;
      return this;
    }
  }
  function humanReadableArgName(arg) {
    const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
    return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
  }
  exports.Argument = Argument;
  exports.humanReadableArgName = humanReadableArgName;
});

// ../../node_modules/commander/lib/help.js
var require_help = __commonJS((exports) => {
  var { humanReadableArgName } = require_argument();

  class Help {
    constructor() {
      this.helpWidth = undefined;
      this.sortSubcommands = false;
      this.sortOptions = false;
      this.showGlobalOptions = false;
    }
    visibleCommands(cmd) {
      const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
      if (cmd._hasImplicitHelpCommand()) {
        const [, helpName, helpArgs] = cmd._helpCommandnameAndArgs.match(/([^ ]+) *(.*)/);
        const helpCommand = cmd.createCommand(helpName).helpOption(false);
        helpCommand.description(cmd._helpCommandDescription);
        if (helpArgs)
          helpCommand.arguments(helpArgs);
        visibleCommands.push(helpCommand);
      }
      if (this.sortSubcommands) {
        visibleCommands.sort((a, b) => {
          return a.name().localeCompare(b.name());
        });
      }
      return visibleCommands;
    }
    compareOptions(a, b) {
      const getSortKey = (option) => {
        return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
      };
      return getSortKey(a).localeCompare(getSortKey(b));
    }
    visibleOptions(cmd) {
      const visibleOptions = cmd.options.filter((option) => !option.hidden);
      const showShortHelpFlag = cmd._hasHelpOption && cmd._helpShortFlag && !cmd._findOption(cmd._helpShortFlag);
      const showLongHelpFlag = cmd._hasHelpOption && !cmd._findOption(cmd._helpLongFlag);
      if (showShortHelpFlag || showLongHelpFlag) {
        let helpOption;
        if (!showShortHelpFlag) {
          helpOption = cmd.createOption(cmd._helpLongFlag, cmd._helpDescription);
        } else if (!showLongHelpFlag) {
          helpOption = cmd.createOption(cmd._helpShortFlag, cmd._helpDescription);
        } else {
          helpOption = cmd.createOption(cmd._helpFlags, cmd._helpDescription);
        }
        visibleOptions.push(helpOption);
      }
      if (this.sortOptions) {
        visibleOptions.sort(this.compareOptions);
      }
      return visibleOptions;
    }
    visibleGlobalOptions(cmd) {
      if (!this.showGlobalOptions)
        return [];
      const globalOptions = [];
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        const visibleOptions = ancestorCmd.options.filter((option) => !option.hidden);
        globalOptions.push(...visibleOptions);
      }
      if (this.sortOptions) {
        globalOptions.sort(this.compareOptions);
      }
      return globalOptions;
    }
    visibleArguments(cmd) {
      if (cmd._argsDescription) {
        cmd.registeredArguments.forEach((argument) => {
          argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
        });
      }
      if (cmd.registeredArguments.find((argument) => argument.description)) {
        return cmd.registeredArguments;
      }
      return [];
    }
    subcommandTerm(cmd) {
      const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
      return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
    }
    optionTerm(option) {
      return option.flags;
    }
    argumentTerm(argument) {
      return argument.name();
    }
    longestSubcommandTermLength(cmd, helper) {
      return helper.visibleCommands(cmd).reduce((max, command) => {
        return Math.max(max, helper.subcommandTerm(command).length);
      }, 0);
    }
    longestOptionTermLength(cmd, helper) {
      return helper.visibleOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestGlobalOptionTermLength(cmd, helper) {
      return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestArgumentTermLength(cmd, helper) {
      return helper.visibleArguments(cmd).reduce((max, argument) => {
        return Math.max(max, helper.argumentTerm(argument).length);
      }, 0);
    }
    commandUsage(cmd) {
      let cmdName = cmd._name;
      if (cmd._aliases[0]) {
        cmdName = cmdName + "|" + cmd._aliases[0];
      }
      let ancestorCmdNames = "";
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
      }
      return ancestorCmdNames + cmdName + " " + cmd.usage();
    }
    commandDescription(cmd) {
      return cmd.description();
    }
    subcommandDescription(cmd) {
      return cmd.summary() || cmd.description();
    }
    optionDescription(option) {
      const extraInfo = [];
      if (option.argChoices) {
        extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (option.defaultValue !== undefined) {
        const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
        if (showDefault) {
          extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
        }
      }
      if (option.presetArg !== undefined && option.optional) {
        extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
      }
      if (option.envVar !== undefined) {
        extraInfo.push(`env: ${option.envVar}`);
      }
      if (extraInfo.length > 0) {
        return `${option.description} (${extraInfo.join(", ")})`;
      }
      return option.description;
    }
    argumentDescription(argument) {
      const extraInfo = [];
      if (argument.argChoices) {
        extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (argument.defaultValue !== undefined) {
        extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
      }
      if (extraInfo.length > 0) {
        const extraDescripton = `(${extraInfo.join(", ")})`;
        if (argument.description) {
          return `${argument.description} ${extraDescripton}`;
        }
        return extraDescripton;
      }
      return argument.description;
    }
    formatHelp(cmd, helper) {
      const termWidth = helper.padWidth(cmd, helper);
      const helpWidth = helper.helpWidth || 80;
      const itemIndentWidth = 2;
      const itemSeparatorWidth = 2;
      function formatItem(term, description) {
        if (description) {
          const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
          return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
        }
        return term;
      }
      function formatList(textArray) {
        return textArray.join(`
`).replace(/^/gm, " ".repeat(itemIndentWidth));
      }
      let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
      const commandDescription = helper.commandDescription(cmd);
      if (commandDescription.length > 0) {
        output = output.concat([helper.wrap(commandDescription, helpWidth, 0), ""]);
      }
      const argumentList = helper.visibleArguments(cmd).map((argument) => {
        return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
      });
      if (argumentList.length > 0) {
        output = output.concat(["Arguments:", formatList(argumentList), ""]);
      }
      const optionList = helper.visibleOptions(cmd).map((option) => {
        return formatItem(helper.optionTerm(option), helper.optionDescription(option));
      });
      if (optionList.length > 0) {
        output = output.concat(["Options:", formatList(optionList), ""]);
      }
      if (this.showGlobalOptions) {
        const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
          return formatItem(helper.optionTerm(option), helper.optionDescription(option));
        });
        if (globalOptionList.length > 0) {
          output = output.concat(["Global Options:", formatList(globalOptionList), ""]);
        }
      }
      const commandList = helper.visibleCommands(cmd).map((cmd2) => {
        return formatItem(helper.subcommandTerm(cmd2), helper.subcommandDescription(cmd2));
      });
      if (commandList.length > 0) {
        output = output.concat(["Commands:", formatList(commandList), ""]);
      }
      return output.join(`
`);
    }
    padWidth(cmd, helper) {
      return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
    }
    wrap(str, width, indent, minColumnWidth = 40) {
      const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
      const manualIndent = new RegExp(`[\\n][${indents}]+`);
      if (str.match(manualIndent))
        return str;
      const columnWidth = width - indent;
      if (columnWidth < minColumnWidth)
        return str;
      const leadingStr = str.slice(0, indent);
      const columnText = str.slice(indent).replace(`\r
`, `
`);
      const indentString = " ".repeat(indent);
      const zeroWidthSpace = "\u200B";
      const breaks = `\\s${zeroWidthSpace}`;
      const regex = new RegExp(`
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`, "g");
      const lines = columnText.match(regex) || [];
      return leadingStr + lines.map((line, i) => {
        if (line === `
`)
          return "";
        return (i > 0 ? indentString : "") + line.trimEnd();
      }).join(`
`);
    }
  }
  exports.Help = Help;
});

// ../../node_modules/commander/lib/option.js
var require_option = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Option {
    constructor(flags, description) {
      this.flags = flags;
      this.description = description || "";
      this.required = flags.includes("<");
      this.optional = flags.includes("[");
      this.variadic = /\w\.\.\.[>\]]$/.test(flags);
      this.mandatory = false;
      const optionFlags = splitOptionFlags(flags);
      this.short = optionFlags.shortFlag;
      this.long = optionFlags.longFlag;
      this.negate = false;
      if (this.long) {
        this.negate = this.long.startsWith("--no-");
      }
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.presetArg = undefined;
      this.envVar = undefined;
      this.parseArg = undefined;
      this.hidden = false;
      this.argChoices = undefined;
      this.conflictsWith = [];
      this.implied = undefined;
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    preset(arg) {
      this.presetArg = arg;
      return this;
    }
    conflicts(names) {
      this.conflictsWith = this.conflictsWith.concat(names);
      return this;
    }
    implies(impliedOptionValues) {
      let newImplied = impliedOptionValues;
      if (typeof impliedOptionValues === "string") {
        newImplied = { [impliedOptionValues]: true };
      }
      this.implied = Object.assign(this.implied || {}, newImplied);
      return this;
    }
    env(name) {
      this.envVar = name;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    makeOptionMandatory(mandatory = true) {
      this.mandatory = !!mandatory;
      return this;
    }
    hideHelp(hide = true) {
      this.hidden = !!hide;
      return this;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    name() {
      if (this.long) {
        return this.long.replace(/^--/, "");
      }
      return this.short.replace(/^-/, "");
    }
    attributeName() {
      return camelcase(this.name().replace(/^no-/, ""));
    }
    is(arg) {
      return this.short === arg || this.long === arg;
    }
    isBoolean() {
      return !this.required && !this.optional && !this.negate;
    }
  }

  class DualOptions {
    constructor(options) {
      this.positiveOptions = new Map;
      this.negativeOptions = new Map;
      this.dualOptions = new Set;
      options.forEach((option) => {
        if (option.negate) {
          this.negativeOptions.set(option.attributeName(), option);
        } else {
          this.positiveOptions.set(option.attributeName(), option);
        }
      });
      this.negativeOptions.forEach((value, key) => {
        if (this.positiveOptions.has(key)) {
          this.dualOptions.add(key);
        }
      });
    }
    valueFromOption(value, option) {
      const optionKey = option.attributeName();
      if (!this.dualOptions.has(optionKey))
        return true;
      const preset = this.negativeOptions.get(optionKey).presetArg;
      const negativeValue = preset !== undefined ? preset : false;
      return option.negate === (negativeValue === value);
    }
  }
  function camelcase(str) {
    return str.split("-").reduce((str2, word) => {
      return str2 + word[0].toUpperCase() + word.slice(1);
    });
  }
  function splitOptionFlags(flags) {
    let shortFlag;
    let longFlag;
    const flagParts = flags.split(/[ |,]+/);
    if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
      shortFlag = flagParts.shift();
    longFlag = flagParts.shift();
    if (!shortFlag && /^-[^-]$/.test(longFlag)) {
      shortFlag = longFlag;
      longFlag = undefined;
    }
    return { shortFlag, longFlag };
  }
  exports.Option = Option;
  exports.splitOptionFlags = splitOptionFlags;
  exports.DualOptions = DualOptions;
});

// ../../node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS((exports) => {
  var maxDistance = 3;
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > maxDistance)
      return Math.max(a.length, b.length);
    const d = [];
    for (let i = 0;i <= a.length; i++) {
      d[i] = [i];
    }
    for (let j = 0;j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let j = 1;j <= b.length; j++) {
      for (let i = 1;i <= a.length; i++) {
        let cost = 1;
        if (a[i - 1] === b[j - 1]) {
          cost = 0;
        } else {
          cost = 1;
        }
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }
  function suggestSimilar(word, candidates) {
    if (!candidates || candidates.length === 0)
      return "";
    candidates = Array.from(new Set(candidates));
    const searchingOptions = word.startsWith("--");
    if (searchingOptions) {
      word = word.slice(2);
      candidates = candidates.map((candidate) => candidate.slice(2));
    }
    let similar = [];
    let bestDistance = maxDistance;
    const minSimilarity = 0.4;
    candidates.forEach((candidate) => {
      if (candidate.length <= 1)
        return;
      const distance = editDistance(word, candidate);
      const length = Math.max(word.length, candidate.length);
      const similarity = (length - distance) / length;
      if (similarity > minSimilarity) {
        if (distance < bestDistance) {
          bestDistance = distance;
          similar = [candidate];
        } else if (distance === bestDistance) {
          similar.push(candidate);
        }
      }
    });
    similar.sort((a, b) => a.localeCompare(b));
    if (searchingOptions) {
      similar = similar.map((candidate) => `--${candidate}`);
    }
    if (similar.length > 1) {
      return `
(Did you mean one of ${similar.join(", ")}?)`;
    }
    if (similar.length === 1) {
      return `
(Did you mean ${similar[0]}?)`;
    }
    return "";
  }
  exports.suggestSimilar = suggestSimilar;
});

// ../../node_modules/commander/lib/command.js
var require_command = __commonJS((exports) => {
  var EventEmitter = __require("events").EventEmitter;
  var childProcess = __require("child_process");
  var path = __require("path");
  var fs = __require("fs");
  var process2 = __require("process");
  var { Argument, humanReadableArgName } = require_argument();
  var { CommanderError } = require_error();
  var { Help } = require_help();
  var { Option, splitOptionFlags, DualOptions } = require_option();
  var { suggestSimilar } = require_suggestSimilar();

  class Command extends EventEmitter {
    constructor(name) {
      super();
      this.commands = [];
      this.options = [];
      this.parent = null;
      this._allowUnknownOption = false;
      this._allowExcessArguments = true;
      this.registeredArguments = [];
      this._args = this.registeredArguments;
      this.args = [];
      this.rawArgs = [];
      this.processedArgs = [];
      this._scriptPath = null;
      this._name = name || "";
      this._optionValues = {};
      this._optionValueSources = {};
      this._storeOptionsAsProperties = false;
      this._actionHandler = null;
      this._executableHandler = false;
      this._executableFile = null;
      this._executableDir = null;
      this._defaultCommandName = null;
      this._exitCallback = null;
      this._aliases = [];
      this._combineFlagAndOptionalValue = true;
      this._description = "";
      this._summary = "";
      this._argsDescription = undefined;
      this._enablePositionalOptions = false;
      this._passThroughOptions = false;
      this._lifeCycleHooks = {};
      this._showHelpAfterError = false;
      this._showSuggestionAfterError = true;
      this._outputConfiguration = {
        writeOut: (str) => process2.stdout.write(str),
        writeErr: (str) => process2.stderr.write(str),
        getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : undefined,
        getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : undefined,
        outputError: (str, write) => write(str)
      };
      this._hidden = false;
      this._hasHelpOption = true;
      this._helpFlags = "-h, --help";
      this._helpDescription = "display help for command";
      this._helpShortFlag = "-h";
      this._helpLongFlag = "--help";
      this._addImplicitHelpCommand = undefined;
      this._helpCommandName = "help";
      this._helpCommandnameAndArgs = "help [command]";
      this._helpCommandDescription = "display help for command";
      this._helpConfiguration = {};
    }
    copyInheritedSettings(sourceCommand) {
      this._outputConfiguration = sourceCommand._outputConfiguration;
      this._hasHelpOption = sourceCommand._hasHelpOption;
      this._helpFlags = sourceCommand._helpFlags;
      this._helpDescription = sourceCommand._helpDescription;
      this._helpShortFlag = sourceCommand._helpShortFlag;
      this._helpLongFlag = sourceCommand._helpLongFlag;
      this._helpCommandName = sourceCommand._helpCommandName;
      this._helpCommandnameAndArgs = sourceCommand._helpCommandnameAndArgs;
      this._helpCommandDescription = sourceCommand._helpCommandDescription;
      this._helpConfiguration = sourceCommand._helpConfiguration;
      this._exitCallback = sourceCommand._exitCallback;
      this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
      this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
      this._allowExcessArguments = sourceCommand._allowExcessArguments;
      this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
      this._showHelpAfterError = sourceCommand._showHelpAfterError;
      this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
      return this;
    }
    _getCommandAndAncestors() {
      const result = [];
      for (let command = this;command; command = command.parent) {
        result.push(command);
      }
      return result;
    }
    command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
      let desc = actionOptsOrExecDesc;
      let opts = execOpts;
      if (typeof desc === "object" && desc !== null) {
        opts = desc;
        desc = null;
      }
      opts = opts || {};
      const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
      const cmd = this.createCommand(name);
      if (desc) {
        cmd.description(desc);
        cmd._executableHandler = true;
      }
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      cmd._hidden = !!(opts.noHelp || opts.hidden);
      cmd._executableFile = opts.executableFile || null;
      if (args)
        cmd.arguments(args);
      this.commands.push(cmd);
      cmd.parent = this;
      cmd.copyInheritedSettings(this);
      if (desc)
        return this;
      return cmd;
    }
    createCommand(name) {
      return new Command(name);
    }
    createHelp() {
      return Object.assign(new Help, this.configureHelp());
    }
    configureHelp(configuration) {
      if (configuration === undefined)
        return this._helpConfiguration;
      this._helpConfiguration = configuration;
      return this;
    }
    configureOutput(configuration) {
      if (configuration === undefined)
        return this._outputConfiguration;
      Object.assign(this._outputConfiguration, configuration);
      return this;
    }
    showHelpAfterError(displayHelp = true) {
      if (typeof displayHelp !== "string")
        displayHelp = !!displayHelp;
      this._showHelpAfterError = displayHelp;
      return this;
    }
    showSuggestionAfterError(displaySuggestion = true) {
      this._showSuggestionAfterError = !!displaySuggestion;
      return this;
    }
    addCommand(cmd, opts) {
      if (!cmd._name) {
        throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
      }
      opts = opts || {};
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      if (opts.noHelp || opts.hidden)
        cmd._hidden = true;
      this.commands.push(cmd);
      cmd.parent = this;
      return this;
    }
    createArgument(name, description) {
      return new Argument(name, description);
    }
    argument(name, description, fn, defaultValue) {
      const argument = this.createArgument(name, description);
      if (typeof fn === "function") {
        argument.default(defaultValue).argParser(fn);
      } else {
        argument.default(fn);
      }
      this.addArgument(argument);
      return this;
    }
    arguments(names) {
      names.trim().split(/ +/).forEach((detail) => {
        this.argument(detail);
      });
      return this;
    }
    addArgument(argument) {
      const previousArgument = this.registeredArguments.slice(-1)[0];
      if (previousArgument && previousArgument.variadic) {
        throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
      }
      if (argument.required && argument.defaultValue !== undefined && argument.parseArg === undefined) {
        throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
      }
      this.registeredArguments.push(argument);
      return this;
    }
    addHelpCommand(enableOrNameAndArgs, description) {
      if (enableOrNameAndArgs === false) {
        this._addImplicitHelpCommand = false;
      } else {
        this._addImplicitHelpCommand = true;
        if (typeof enableOrNameAndArgs === "string") {
          this._helpCommandName = enableOrNameAndArgs.split(" ")[0];
          this._helpCommandnameAndArgs = enableOrNameAndArgs;
        }
        this._helpCommandDescription = description || this._helpCommandDescription;
      }
      return this;
    }
    _hasImplicitHelpCommand() {
      if (this._addImplicitHelpCommand === undefined) {
        return this.commands.length && !this._actionHandler && !this._findCommand("help");
      }
      return this._addImplicitHelpCommand;
    }
    hook(event, listener) {
      const allowedValues = ["preSubcommand", "preAction", "postAction"];
      if (!allowedValues.includes(event)) {
        throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      if (this._lifeCycleHooks[event]) {
        this._lifeCycleHooks[event].push(listener);
      } else {
        this._lifeCycleHooks[event] = [listener];
      }
      return this;
    }
    exitOverride(fn) {
      if (fn) {
        this._exitCallback = fn;
      } else {
        this._exitCallback = (err) => {
          if (err.code !== "commander.executeSubCommandAsync") {
            throw err;
          } else {}
        };
      }
      return this;
    }
    _exit(exitCode, code, message) {
      if (this._exitCallback) {
        this._exitCallback(new CommanderError(exitCode, code, message));
      }
      process2.exit(exitCode);
    }
    action(fn) {
      const listener = (args) => {
        const expectedArgsCount = this.registeredArguments.length;
        const actionArgs = args.slice(0, expectedArgsCount);
        if (this._storeOptionsAsProperties) {
          actionArgs[expectedArgsCount] = this;
        } else {
          actionArgs[expectedArgsCount] = this.opts();
        }
        actionArgs.push(this);
        return fn.apply(this, actionArgs);
      };
      this._actionHandler = listener;
      return this;
    }
    createOption(flags, description) {
      return new Option(flags, description);
    }
    _callParseArg(target, value, previous, invalidArgumentMessage) {
      try {
        return target.parseArg(value, previous);
      } catch (err) {
        if (err.code === "commander.invalidArgument") {
          const message = `${invalidArgumentMessage} ${err.message}`;
          this.error(message, { exitCode: err.exitCode, code: err.code });
        }
        throw err;
      }
    }
    addOption(option) {
      const oname = option.name();
      const name = option.attributeName();
      if (option.negate) {
        const positiveLongFlag = option.long.replace(/^--no-/, "--");
        if (!this._findOption(positiveLongFlag)) {
          this.setOptionValueWithSource(name, option.defaultValue === undefined ? true : option.defaultValue, "default");
        }
      } else if (option.defaultValue !== undefined) {
        this.setOptionValueWithSource(name, option.defaultValue, "default");
      }
      this.options.push(option);
      const handleOptionValue = (val, invalidValueMessage, valueSource) => {
        if (val == null && option.presetArg !== undefined) {
          val = option.presetArg;
        }
        const oldValue = this.getOptionValue(name);
        if (val !== null && option.parseArg) {
          val = this._callParseArg(option, val, oldValue, invalidValueMessage);
        } else if (val !== null && option.variadic) {
          val = option._concatValue(val, oldValue);
        }
        if (val == null) {
          if (option.negate) {
            val = false;
          } else if (option.isBoolean() || option.optional) {
            val = true;
          } else {
            val = "";
          }
        }
        this.setOptionValueWithSource(name, val, valueSource);
      };
      this.on("option:" + oname, (val) => {
        const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
        handleOptionValue(val, invalidValueMessage, "cli");
      });
      if (option.envVar) {
        this.on("optionEnv:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "env");
        });
      }
      return this;
    }
    _optionEx(config, flags, description, fn, defaultValue) {
      if (typeof flags === "object" && flags instanceof Option) {
        throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
      }
      const option = this.createOption(flags, description);
      option.makeOptionMandatory(!!config.mandatory);
      if (typeof fn === "function") {
        option.default(defaultValue).argParser(fn);
      } else if (fn instanceof RegExp) {
        const regex = fn;
        fn = (val, def) => {
          const m = regex.exec(val);
          return m ? m[0] : def;
        };
        option.default(defaultValue).argParser(fn);
      } else {
        option.default(fn);
      }
      return this.addOption(option);
    }
    option(flags, description, parseArg, defaultValue) {
      return this._optionEx({}, flags, description, parseArg, defaultValue);
    }
    requiredOption(flags, description, parseArg, defaultValue) {
      return this._optionEx({ mandatory: true }, flags, description, parseArg, defaultValue);
    }
    combineFlagAndOptionalValue(combine = true) {
      this._combineFlagAndOptionalValue = !!combine;
      return this;
    }
    allowUnknownOption(allowUnknown = true) {
      this._allowUnknownOption = !!allowUnknown;
      return this;
    }
    allowExcessArguments(allowExcess = true) {
      this._allowExcessArguments = !!allowExcess;
      return this;
    }
    enablePositionalOptions(positional = true) {
      this._enablePositionalOptions = !!positional;
      return this;
    }
    passThroughOptions(passThrough = true) {
      this._passThroughOptions = !!passThrough;
      if (!!this.parent && passThrough && !this.parent._enablePositionalOptions) {
        throw new Error("passThroughOptions can not be used without turning on enablePositionalOptions for parent command(s)");
      }
      return this;
    }
    storeOptionsAsProperties(storeAsProperties = true) {
      if (this.options.length) {
        throw new Error("call .storeOptionsAsProperties() before adding options");
      }
      this._storeOptionsAsProperties = !!storeAsProperties;
      return this;
    }
    getOptionValue(key) {
      if (this._storeOptionsAsProperties) {
        return this[key];
      }
      return this._optionValues[key];
    }
    setOptionValue(key, value) {
      return this.setOptionValueWithSource(key, value, undefined);
    }
    setOptionValueWithSource(key, value, source) {
      if (this._storeOptionsAsProperties) {
        this[key] = value;
      } else {
        this._optionValues[key] = value;
      }
      this._optionValueSources[key] = source;
      return this;
    }
    getOptionValueSource(key) {
      return this._optionValueSources[key];
    }
    getOptionValueSourceWithGlobals(key) {
      let source;
      this._getCommandAndAncestors().forEach((cmd) => {
        if (cmd.getOptionValueSource(key) !== undefined) {
          source = cmd.getOptionValueSource(key);
        }
      });
      return source;
    }
    _prepareUserArgs(argv, parseOptions) {
      if (argv !== undefined && !Array.isArray(argv)) {
        throw new Error("first parameter to parse must be array or undefined");
      }
      parseOptions = parseOptions || {};
      if (argv === undefined) {
        argv = process2.argv;
        if (process2.versions && process2.versions.electron) {
          parseOptions.from = "electron";
        }
      }
      this.rawArgs = argv.slice();
      let userArgs;
      switch (parseOptions.from) {
        case undefined:
        case "node":
          this._scriptPath = argv[1];
          userArgs = argv.slice(2);
          break;
        case "electron":
          if (process2.defaultApp) {
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
          } else {
            userArgs = argv.slice(1);
          }
          break;
        case "user":
          userArgs = argv.slice(0);
          break;
        default:
          throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
      }
      if (!this._name && this._scriptPath)
        this.nameFromFilename(this._scriptPath);
      this._name = this._name || "program";
      return userArgs;
    }
    parse(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      this._parseCommand([], userArgs);
      return this;
    }
    async parseAsync(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      await this._parseCommand([], userArgs);
      return this;
    }
    _executeSubCommand(subcommand, args) {
      args = args.slice();
      let launchWithNode = false;
      const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
      function findFile(baseDir, baseName) {
        const localBin = path.resolve(baseDir, baseName);
        if (fs.existsSync(localBin))
          return localBin;
        if (sourceExt.includes(path.extname(baseName)))
          return;
        const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
        if (foundExt)
          return `${localBin}${foundExt}`;
        return;
      }
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
      let executableDir = this._executableDir || "";
      if (this._scriptPath) {
        let resolvedScriptPath;
        try {
          resolvedScriptPath = fs.realpathSync(this._scriptPath);
        } catch (err) {
          resolvedScriptPath = this._scriptPath;
        }
        executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
      }
      if (executableDir) {
        let localFile = findFile(executableDir, executableFile);
        if (!localFile && !subcommand._executableFile && this._scriptPath) {
          const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
          if (legacyName !== this._name) {
            localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
          }
        }
        executableFile = localFile || executableFile;
      }
      launchWithNode = sourceExt.includes(path.extname(executableFile));
      let proc;
      if (process2.platform !== "win32") {
        if (launchWithNode) {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
        } else {
          proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
        }
      } else {
        args.unshift(executableFile);
        args = incrementNodeInspectorPort(process2.execArgv).concat(args);
        proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
      }
      if (!proc.killed) {
        const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
        signals.forEach((signal) => {
          process2.on(signal, () => {
            if (proc.killed === false && proc.exitCode === null) {
              proc.kill(signal);
            }
          });
        });
      }
      const exitCallback = this._exitCallback;
      if (!exitCallback) {
        proc.on("close", process2.exit.bind(process2));
      } else {
        proc.on("close", () => {
          exitCallback(new CommanderError(process2.exitCode || 0, "commander.executeSubCommandAsync", "(close)"));
        });
      }
      proc.on("error", (err) => {
        if (err.code === "ENOENT") {
          const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
          const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
          throw new Error(executableMissing);
        } else if (err.code === "EACCES") {
          throw new Error(`'${executableFile}' not executable`);
        }
        if (!exitCallback) {
          process2.exit(1);
        } else {
          const wrappedError = new CommanderError(1, "commander.executeSubCommandAsync", "(error)");
          wrappedError.nestedError = err;
          exitCallback(wrappedError);
        }
      });
      this.runningCommand = proc;
    }
    _dispatchSubcommand(commandName, operands, unknown) {
      const subCommand = this._findCommand(commandName);
      if (!subCommand)
        this.help({ error: true });
      let promiseChain;
      promiseChain = this._chainOrCallSubCommandHook(promiseChain, subCommand, "preSubcommand");
      promiseChain = this._chainOrCall(promiseChain, () => {
        if (subCommand._executableHandler) {
          this._executeSubCommand(subCommand, operands.concat(unknown));
        } else {
          return subCommand._parseCommand(operands, unknown);
        }
      });
      return promiseChain;
    }
    _dispatchHelpCommand(subcommandName) {
      if (!subcommandName) {
        this.help();
      }
      const subCommand = this._findCommand(subcommandName);
      if (subCommand && !subCommand._executableHandler) {
        subCommand.help();
      }
      return this._dispatchSubcommand(subcommandName, [], [
        this._helpLongFlag || this._helpShortFlag
      ]);
    }
    _checkNumberOfArguments() {
      this.registeredArguments.forEach((arg, i) => {
        if (arg.required && this.args[i] == null) {
          this.missingArgument(arg.name());
        }
      });
      if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
        return;
      }
      if (this.args.length > this.registeredArguments.length) {
        this._excessArguments(this.args);
      }
    }
    _processArguments() {
      const myParseArg = (argument, value, previous) => {
        let parsedValue = value;
        if (value !== null && argument.parseArg) {
          const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
          parsedValue = this._callParseArg(argument, value, previous, invalidValueMessage);
        }
        return parsedValue;
      };
      this._checkNumberOfArguments();
      const processedArgs = [];
      this.registeredArguments.forEach((declaredArg, index) => {
        let value = declaredArg.defaultValue;
        if (declaredArg.variadic) {
          if (index < this.args.length) {
            value = this.args.slice(index);
            if (declaredArg.parseArg) {
              value = value.reduce((processed, v) => {
                return myParseArg(declaredArg, v, processed);
              }, declaredArg.defaultValue);
            }
          } else if (value === undefined) {
            value = [];
          }
        } else if (index < this.args.length) {
          value = this.args[index];
          if (declaredArg.parseArg) {
            value = myParseArg(declaredArg, value, declaredArg.defaultValue);
          }
        }
        processedArgs[index] = value;
      });
      this.processedArgs = processedArgs;
    }
    _chainOrCall(promise, fn) {
      if (promise && promise.then && typeof promise.then === "function") {
        return promise.then(() => fn());
      }
      return fn();
    }
    _chainOrCallHooks(promise, event) {
      let result = promise;
      const hooks = [];
      this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== undefined).forEach((hookedCommand) => {
        hookedCommand._lifeCycleHooks[event].forEach((callback) => {
          hooks.push({ hookedCommand, callback });
        });
      });
      if (event === "postAction") {
        hooks.reverse();
      }
      hooks.forEach((hookDetail) => {
        result = this._chainOrCall(result, () => {
          return hookDetail.callback(hookDetail.hookedCommand, this);
        });
      });
      return result;
    }
    _chainOrCallSubCommandHook(promise, subCommand, event) {
      let result = promise;
      if (this._lifeCycleHooks[event] !== undefined) {
        this._lifeCycleHooks[event].forEach((hook) => {
          result = this._chainOrCall(result, () => {
            return hook(this, subCommand);
          });
        });
      }
      return result;
    }
    _parseCommand(operands, unknown) {
      const parsed = this.parseOptions(unknown);
      this._parseOptionsEnv();
      this._parseOptionsImplied();
      operands = operands.concat(parsed.operands);
      unknown = parsed.unknown;
      this.args = operands.concat(unknown);
      if (operands && this._findCommand(operands[0])) {
        return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
      }
      if (this._hasImplicitHelpCommand() && operands[0] === this._helpCommandName) {
        return this._dispatchHelpCommand(operands[1]);
      }
      if (this._defaultCommandName) {
        outputHelpIfRequested(this, unknown);
        return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
      }
      if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
        this.help({ error: true });
      }
      outputHelpIfRequested(this, parsed.unknown);
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      const checkForUnknownOptions = () => {
        if (parsed.unknown.length > 0) {
          this.unknownOption(parsed.unknown[0]);
        }
      };
      const commandEvent = `command:${this.name()}`;
      if (this._actionHandler) {
        checkForUnknownOptions();
        this._processArguments();
        let promiseChain;
        promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
        promiseChain = this._chainOrCall(promiseChain, () => this._actionHandler(this.processedArgs));
        if (this.parent) {
          promiseChain = this._chainOrCall(promiseChain, () => {
            this.parent.emit(commandEvent, operands, unknown);
          });
        }
        promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
        return promiseChain;
      }
      if (this.parent && this.parent.listenerCount(commandEvent)) {
        checkForUnknownOptions();
        this._processArguments();
        this.parent.emit(commandEvent, operands, unknown);
      } else if (operands.length) {
        if (this._findCommand("*")) {
          return this._dispatchSubcommand("*", operands, unknown);
        }
        if (this.listenerCount("command:*")) {
          this.emit("command:*", operands, unknown);
        } else if (this.commands.length) {
          this.unknownCommand();
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      } else if (this.commands.length) {
        checkForUnknownOptions();
        this.help({ error: true });
      } else {
        checkForUnknownOptions();
        this._processArguments();
      }
    }
    _findCommand(name) {
      if (!name)
        return;
      return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
    }
    _findOption(arg) {
      return this.options.find((option) => option.is(arg));
    }
    _checkForMissingMandatoryOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd.options.forEach((anOption) => {
          if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === undefined) {
            cmd.missingMandatoryOptionValue(anOption);
          }
        });
      });
    }
    _checkForConflictingLocalOptions() {
      const definedNonDefaultOptions = this.options.filter((option) => {
        const optionKey = option.attributeName();
        if (this.getOptionValue(optionKey) === undefined) {
          return false;
        }
        return this.getOptionValueSource(optionKey) !== "default";
      });
      const optionsWithConflicting = definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0);
      optionsWithConflicting.forEach((option) => {
        const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
        if (conflictingAndDefined) {
          this._conflictingOption(option, conflictingAndDefined);
        }
      });
    }
    _checkForConflictingOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd._checkForConflictingLocalOptions();
      });
    }
    parseOptions(argv) {
      const operands = [];
      const unknown = [];
      let dest = operands;
      const args = argv.slice();
      function maybeOption(arg) {
        return arg.length > 1 && arg[0] === "-";
      }
      let activeVariadicOption = null;
      while (args.length) {
        const arg = args.shift();
        if (arg === "--") {
          if (dest === unknown)
            dest.push(arg);
          dest.push(...args);
          break;
        }
        if (activeVariadicOption && !maybeOption(arg)) {
          this.emit(`option:${activeVariadicOption.name()}`, arg);
          continue;
        }
        activeVariadicOption = null;
        if (maybeOption(arg)) {
          const option = this._findOption(arg);
          if (option) {
            if (option.required) {
              const value = args.shift();
              if (value === undefined)
                this.optionMissingArgument(option);
              this.emit(`option:${option.name()}`, value);
            } else if (option.optional) {
              let value = null;
              if (args.length > 0 && !maybeOption(args[0])) {
                value = args.shift();
              }
              this.emit(`option:${option.name()}`, value);
            } else {
              this.emit(`option:${option.name()}`);
            }
            activeVariadicOption = option.variadic ? option : null;
            continue;
          }
        }
        if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
          const option = this._findOption(`-${arg[1]}`);
          if (option) {
            if (option.required || option.optional && this._combineFlagAndOptionalValue) {
              this.emit(`option:${option.name()}`, arg.slice(2));
            } else {
              this.emit(`option:${option.name()}`);
              args.unshift(`-${arg.slice(2)}`);
            }
            continue;
          }
        }
        if (/^--[^=]+=/.test(arg)) {
          const index = arg.indexOf("=");
          const option = this._findOption(arg.slice(0, index));
          if (option && (option.required || option.optional)) {
            this.emit(`option:${option.name()}`, arg.slice(index + 1));
            continue;
          }
        }
        if (maybeOption(arg)) {
          dest = unknown;
        }
        if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
          if (this._findCommand(arg)) {
            operands.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          } else if (arg === this._helpCommandName && this._hasImplicitHelpCommand()) {
            operands.push(arg);
            if (args.length > 0)
              operands.push(...args);
            break;
          } else if (this._defaultCommandName) {
            unknown.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          }
        }
        if (this._passThroughOptions) {
          dest.push(arg);
          if (args.length > 0)
            dest.push(...args);
          break;
        }
        dest.push(arg);
      }
      return { operands, unknown };
    }
    opts() {
      if (this._storeOptionsAsProperties) {
        const result = {};
        const len = this.options.length;
        for (let i = 0;i < len; i++) {
          const key = this.options[i].attributeName();
          result[key] = key === this._versionOptionName ? this._version : this[key];
        }
        return result;
      }
      return this._optionValues;
    }
    optsWithGlobals() {
      return this._getCommandAndAncestors().reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
    }
    error(message, errorOptions) {
      this._outputConfiguration.outputError(`${message}
`, this._outputConfiguration.writeErr);
      if (typeof this._showHelpAfterError === "string") {
        this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
      } else if (this._showHelpAfterError) {
        this._outputConfiguration.writeErr(`
`);
        this.outputHelp({ error: true });
      }
      const config = errorOptions || {};
      const exitCode = config.exitCode || 1;
      const code = config.code || "commander.error";
      this._exit(exitCode, code, message);
    }
    _parseOptionsEnv() {
      this.options.forEach((option) => {
        if (option.envVar && option.envVar in process2.env) {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === undefined || ["default", "config", "env"].includes(this.getOptionValueSource(optionKey))) {
            if (option.required || option.optional) {
              this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
            } else {
              this.emit(`optionEnv:${option.name()}`);
            }
          }
        }
      });
    }
    _parseOptionsImplied() {
      const dualHelper = new DualOptions(this.options);
      const hasCustomOptionValue = (optionKey) => {
        return this.getOptionValue(optionKey) !== undefined && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
      };
      this.options.filter((option) => option.implied !== undefined && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(this.getOptionValue(option.attributeName()), option)).forEach((option) => {
        Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
          this.setOptionValueWithSource(impliedKey, option.implied[impliedKey], "implied");
        });
      });
    }
    missingArgument(name) {
      const message = `error: missing required argument '${name}'`;
      this.error(message, { code: "commander.missingArgument" });
    }
    optionMissingArgument(option) {
      const message = `error: option '${option.flags}' argument missing`;
      this.error(message, { code: "commander.optionMissingArgument" });
    }
    missingMandatoryOptionValue(option) {
      const message = `error: required option '${option.flags}' not specified`;
      this.error(message, { code: "commander.missingMandatoryOptionValue" });
    }
    _conflictingOption(option, conflictingOption) {
      const findBestOptionFromValue = (option2) => {
        const optionKey = option2.attributeName();
        const optionValue = this.getOptionValue(optionKey);
        const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
        const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
        if (negativeOption && (negativeOption.presetArg === undefined && optionValue === false || negativeOption.presetArg !== undefined && optionValue === negativeOption.presetArg)) {
          return negativeOption;
        }
        return positiveOption || option2;
      };
      const getErrorMessage = (option2) => {
        const bestOption = findBestOptionFromValue(option2);
        const optionKey = bestOption.attributeName();
        const source = this.getOptionValueSource(optionKey);
        if (source === "env") {
          return `environment variable '${bestOption.envVar}'`;
        }
        return `option '${bestOption.flags}'`;
      };
      const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
      this.error(message, { code: "commander.conflictingOption" });
    }
    unknownOption(flag) {
      if (this._allowUnknownOption)
        return;
      let suggestion = "";
      if (flag.startsWith("--") && this._showSuggestionAfterError) {
        let candidateFlags = [];
        let command = this;
        do {
          const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
          candidateFlags = candidateFlags.concat(moreFlags);
          command = command.parent;
        } while (command && !command._enablePositionalOptions);
        suggestion = suggestSimilar(flag, candidateFlags);
      }
      const message = `error: unknown option '${flag}'${suggestion}`;
      this.error(message, { code: "commander.unknownOption" });
    }
    _excessArguments(receivedArgs) {
      if (this._allowExcessArguments)
        return;
      const expected = this.registeredArguments.length;
      const s = expected === 1 ? "" : "s";
      const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
      const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
      this.error(message, { code: "commander.excessArguments" });
    }
    unknownCommand() {
      const unknownName = this.args[0];
      let suggestion = "";
      if (this._showSuggestionAfterError) {
        const candidateNames = [];
        this.createHelp().visibleCommands(this).forEach((command) => {
          candidateNames.push(command.name());
          if (command.alias())
            candidateNames.push(command.alias());
        });
        suggestion = suggestSimilar(unknownName, candidateNames);
      }
      const message = `error: unknown command '${unknownName}'${suggestion}`;
      this.error(message, { code: "commander.unknownCommand" });
    }
    version(str, flags, description) {
      if (str === undefined)
        return this._version;
      this._version = str;
      flags = flags || "-V, --version";
      description = description || "output the version number";
      const versionOption = this.createOption(flags, description);
      this._versionOptionName = versionOption.attributeName();
      this.options.push(versionOption);
      this.on("option:" + versionOption.name(), () => {
        this._outputConfiguration.writeOut(`${str}
`);
        this._exit(0, "commander.version", str);
      });
      return this;
    }
    description(str, argsDescription) {
      if (str === undefined && argsDescription === undefined)
        return this._description;
      this._description = str;
      if (argsDescription) {
        this._argsDescription = argsDescription;
      }
      return this;
    }
    summary(str) {
      if (str === undefined)
        return this._summary;
      this._summary = str;
      return this;
    }
    alias(alias) {
      if (alias === undefined)
        return this._aliases[0];
      let command = this;
      if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
        command = this.commands[this.commands.length - 1];
      }
      if (alias === command._name)
        throw new Error("Command alias can't be the same as its name");
      command._aliases.push(alias);
      return this;
    }
    aliases(aliases) {
      if (aliases === undefined)
        return this._aliases;
      aliases.forEach((alias) => this.alias(alias));
      return this;
    }
    usage(str) {
      if (str === undefined) {
        if (this._usage)
          return this._usage;
        const args = this.registeredArguments.map((arg) => {
          return humanReadableArgName(arg);
        });
        return [].concat(this.options.length || this._hasHelpOption ? "[options]" : [], this.commands.length ? "[command]" : [], this.registeredArguments.length ? args : []).join(" ");
      }
      this._usage = str;
      return this;
    }
    name(str) {
      if (str === undefined)
        return this._name;
      this._name = str;
      return this;
    }
    nameFromFilename(filename) {
      this._name = path.basename(filename, path.extname(filename));
      return this;
    }
    executableDir(path2) {
      if (path2 === undefined)
        return this._executableDir;
      this._executableDir = path2;
      return this;
    }
    helpInformation(contextOptions) {
      const helper = this.createHelp();
      if (helper.helpWidth === undefined) {
        helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
      }
      return helper.formatHelp(this, helper);
    }
    _getHelpContext(contextOptions) {
      contextOptions = contextOptions || {};
      const context = { error: !!contextOptions.error };
      let write;
      if (context.error) {
        write = (arg) => this._outputConfiguration.writeErr(arg);
      } else {
        write = (arg) => this._outputConfiguration.writeOut(arg);
      }
      context.write = contextOptions.write || write;
      context.command = this;
      return context;
    }
    outputHelp(contextOptions) {
      let deprecatedCallback;
      if (typeof contextOptions === "function") {
        deprecatedCallback = contextOptions;
        contextOptions = undefined;
      }
      const context = this._getHelpContext(contextOptions);
      this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
      this.emit("beforeHelp", context);
      let helpInformation = this.helpInformation(context);
      if (deprecatedCallback) {
        helpInformation = deprecatedCallback(helpInformation);
        if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
          throw new Error("outputHelp callback must return a string or a Buffer");
        }
      }
      context.write(helpInformation);
      if (this._helpLongFlag) {
        this.emit(this._helpLongFlag);
      }
      this.emit("afterHelp", context);
      this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", context));
    }
    helpOption(flags, description) {
      if (typeof flags === "boolean") {
        this._hasHelpOption = flags;
        return this;
      }
      this._helpFlags = flags || this._helpFlags;
      this._helpDescription = description || this._helpDescription;
      const helpFlags = splitOptionFlags(this._helpFlags);
      this._helpShortFlag = helpFlags.shortFlag;
      this._helpLongFlag = helpFlags.longFlag;
      return this;
    }
    help(contextOptions) {
      this.outputHelp(contextOptions);
      let exitCode = process2.exitCode || 0;
      if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
        exitCode = 1;
      }
      this._exit(exitCode, "commander.help", "(outputHelp)");
    }
    addHelpText(position, text) {
      const allowedValues = ["beforeAll", "before", "after", "afterAll"];
      if (!allowedValues.includes(position)) {
        throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      const helpEvent = `${position}Help`;
      this.on(helpEvent, (context) => {
        let helpStr;
        if (typeof text === "function") {
          helpStr = text({ error: context.error, command: context.command });
        } else {
          helpStr = text;
        }
        if (helpStr) {
          context.write(`${helpStr}
`);
        }
      });
      return this;
    }
  }
  function outputHelpIfRequested(cmd, args) {
    const helpOption = cmd._hasHelpOption && args.find((arg) => arg === cmd._helpLongFlag || arg === cmd._helpShortFlag);
    if (helpOption) {
      cmd.outputHelp();
      cmd._exit(0, "commander.helpDisplayed", "(outputHelp)");
    }
  }
  function incrementNodeInspectorPort(args) {
    return args.map((arg) => {
      if (!arg.startsWith("--inspect")) {
        return arg;
      }
      let debugOption;
      let debugHost = "127.0.0.1";
      let debugPort = "9229";
      let match;
      if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
        debugOption = match[1];
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
        debugOption = match[1];
        if (/^\d+$/.test(match[3])) {
          debugPort = match[3];
        } else {
          debugHost = match[3];
        }
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
        debugOption = match[1];
        debugHost = match[3];
        debugPort = match[4];
      }
      if (debugOption && debugPort !== "0") {
        return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
      }
      return arg;
    });
  }
  exports.Command = Command;
});

// ../../node_modules/commander/index.js
var require_commander = __commonJS((exports, module) => {
  var { Argument } = require_argument();
  var { Command } = require_command();
  var { CommanderError, InvalidArgumentError } = require_error();
  var { Help } = require_help();
  var { Option } = require_option();
  exports = module.exports = new Command;
  exports.program = exports;
  exports.Command = Command;
  exports.Option = Option;
  exports.Argument = Argument;
  exports.Help = Help;
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
  exports.InvalidOptionArgumentError = InvalidArgumentError;
});

// ../../node_modules/universalify/index.js
var require_universalify = __commonJS((exports) => {
  exports.fromCallback = function(fn) {
    return Object.defineProperty(function(...args) {
      if (typeof args[args.length - 1] === "function")
        fn.apply(this, args);
      else {
        return new Promise((resolve, reject) => {
          args.push((err, res) => err != null ? reject(err) : resolve(res));
          fn.apply(this, args);
        });
      }
    }, "name", { value: fn.name });
  };
  exports.fromPromise = function(fn) {
    return Object.defineProperty(function(...args) {
      const cb = args[args.length - 1];
      if (typeof cb !== "function")
        return fn.apply(this, args);
      else {
        args.pop();
        fn.apply(this, args).then((r) => cb(null, r), cb);
      }
    }, "name", { value: fn.name });
  };
});

// ../../node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS((exports, module) => {
  var constants = __require("constants");
  var origCwd = process.cwd;
  var cwd = null;
  var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    if (!cwd)
      cwd = origCwd.call(process);
    return cwd;
  };
  try {
    process.cwd();
  } catch (er) {}
  if (typeof process.chdir === "function") {
    chdir = process.chdir;
    process.chdir = function(d) {
      cwd = null;
      chdir.call(process, d);
    };
    if (Object.setPrototypeOf)
      Object.setPrototypeOf(process.chdir, chdir);
  }
  var chdir;
  module.exports = patch;
  function patch(fs) {
    if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
      patchLchmod(fs);
    }
    if (!fs.lutimes) {
      patchLutimes(fs);
    }
    fs.chown = chownFix(fs.chown);
    fs.fchown = chownFix(fs.fchown);
    fs.lchown = chownFix(fs.lchown);
    fs.chmod = chmodFix(fs.chmod);
    fs.fchmod = chmodFix(fs.fchmod);
    fs.lchmod = chmodFix(fs.lchmod);
    fs.chownSync = chownFixSync(fs.chownSync);
    fs.fchownSync = chownFixSync(fs.fchownSync);
    fs.lchownSync = chownFixSync(fs.lchownSync);
    fs.chmodSync = chmodFixSync(fs.chmodSync);
    fs.fchmodSync = chmodFixSync(fs.fchmodSync);
    fs.lchmodSync = chmodFixSync(fs.lchmodSync);
    fs.stat = statFix(fs.stat);
    fs.fstat = statFix(fs.fstat);
    fs.lstat = statFix(fs.lstat);
    fs.statSync = statFixSync(fs.statSync);
    fs.fstatSync = statFixSync(fs.fstatSync);
    fs.lstatSync = statFixSync(fs.lstatSync);
    if (fs.chmod && !fs.lchmod) {
      fs.lchmod = function(path, mode, cb) {
        if (cb)
          process.nextTick(cb);
      };
      fs.lchmodSync = function() {};
    }
    if (fs.chown && !fs.lchown) {
      fs.lchown = function(path, uid, gid, cb) {
        if (cb)
          process.nextTick(cb);
      };
      fs.lchownSync = function() {};
    }
    if (platform === "win32") {
      fs.rename = typeof fs.rename !== "function" ? fs.rename : function(fs$rename) {
        function rename(from, to, cb) {
          var start = Date.now();
          var backoff = 0;
          fs$rename(from, to, function CB(er) {
            if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 60000) {
              setTimeout(function() {
                fs.stat(to, function(stater, st) {
                  if (stater && stater.code === "ENOENT")
                    fs$rename(from, to, CB);
                  else
                    cb(er);
                });
              }, backoff);
              if (backoff < 100)
                backoff += 10;
              return;
            }
            if (cb)
              cb(er);
          });
        }
        if (Object.setPrototypeOf)
          Object.setPrototypeOf(rename, fs$rename);
        return rename;
      }(fs.rename);
    }
    fs.read = typeof fs.read !== "function" ? fs.read : function(fs$read) {
      function read(fd, buffer, offset, length, position, callback_) {
        var callback;
        if (callback_ && typeof callback_ === "function") {
          var eagCounter = 0;
          callback = function(er, _, __) {
            if (er && er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              return fs$read.call(fs, fd, buffer, offset, length, position, callback);
            }
            callback_.apply(this, arguments);
          };
        }
        return fs$read.call(fs, fd, buffer, offset, length, position, callback);
      }
      if (Object.setPrototypeOf)
        Object.setPrototypeOf(read, fs$read);
      return read;
    }(fs.read);
    fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : function(fs$readSync) {
      return function(fd, buffer, offset, length, position) {
        var eagCounter = 0;
        while (true) {
          try {
            return fs$readSync.call(fs, fd, buffer, offset, length, position);
          } catch (er) {
            if (er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              continue;
            }
            throw er;
          }
        }
      };
    }(fs.readSync);
    function patchLchmod(fs2) {
      fs2.lchmod = function(path, mode, callback) {
        fs2.open(path, constants.O_WRONLY | constants.O_SYMLINK, mode, function(err, fd) {
          if (err) {
            if (callback)
              callback(err);
            return;
          }
          fs2.fchmod(fd, mode, function(err2) {
            fs2.close(fd, function(err22) {
              if (callback)
                callback(err2 || err22);
            });
          });
        });
      };
      fs2.lchmodSync = function(path, mode) {
        var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
        var threw = true;
        var ret;
        try {
          ret = fs2.fchmodSync(fd, mode);
          threw = false;
        } finally {
          if (threw) {
            try {
              fs2.closeSync(fd);
            } catch (er) {}
          } else {
            fs2.closeSync(fd);
          }
        }
        return ret;
      };
    }
    function patchLutimes(fs2) {
      if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
        fs2.lutimes = function(path, at, mt, cb) {
          fs2.open(path, constants.O_SYMLINK, function(er, fd) {
            if (er) {
              if (cb)
                cb(er);
              return;
            }
            fs2.futimes(fd, at, mt, function(er2) {
              fs2.close(fd, function(er22) {
                if (cb)
                  cb(er2 || er22);
              });
            });
          });
        };
        fs2.lutimesSync = function(path, at, mt) {
          var fd = fs2.openSync(path, constants.O_SYMLINK);
          var ret;
          var threw = true;
          try {
            ret = fs2.futimesSync(fd, at, mt);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {}
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      } else if (fs2.futimes) {
        fs2.lutimes = function(_a, _b, _c, cb) {
          if (cb)
            process.nextTick(cb);
        };
        fs2.lutimesSync = function() {};
      }
    }
    function chmodFix(orig) {
      if (!orig)
        return orig;
      return function(target, mode, cb) {
        return orig.call(fs, target, mode, function(er) {
          if (chownErOk(er))
            er = null;
          if (cb)
            cb.apply(this, arguments);
        });
      };
    }
    function chmodFixSync(orig) {
      if (!orig)
        return orig;
      return function(target, mode) {
        try {
          return orig.call(fs, target, mode);
        } catch (er) {
          if (!chownErOk(er))
            throw er;
        }
      };
    }
    function chownFix(orig) {
      if (!orig)
        return orig;
      return function(target, uid, gid, cb) {
        return orig.call(fs, target, uid, gid, function(er) {
          if (chownErOk(er))
            er = null;
          if (cb)
            cb.apply(this, arguments);
        });
      };
    }
    function chownFixSync(orig) {
      if (!orig)
        return orig;
      return function(target, uid, gid) {
        try {
          return orig.call(fs, target, uid, gid);
        } catch (er) {
          if (!chownErOk(er))
            throw er;
        }
      };
    }
    function statFix(orig) {
      if (!orig)
        return orig;
      return function(target, options, cb) {
        if (typeof options === "function") {
          cb = options;
          options = null;
        }
        function callback(er, stats) {
          if (stats) {
            if (stats.uid < 0)
              stats.uid += 4294967296;
            if (stats.gid < 0)
              stats.gid += 4294967296;
          }
          if (cb)
            cb.apply(this, arguments);
        }
        return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
      };
    }
    function statFixSync(orig) {
      if (!orig)
        return orig;
      return function(target, options) {
        var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
        if (stats) {
          if (stats.uid < 0)
            stats.uid += 4294967296;
          if (stats.gid < 0)
            stats.gid += 4294967296;
        }
        return stats;
      };
    }
    function chownErOk(er) {
      if (!er)
        return true;
      if (er.code === "ENOSYS")
        return true;
      var nonroot = !process.getuid || process.getuid() !== 0;
      if (nonroot) {
        if (er.code === "EINVAL" || er.code === "EPERM")
          return true;
      }
      return false;
    }
  }
});

// ../../node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS((exports, module) => {
  var Stream = __require("stream").Stream;
  module.exports = legacy;
  function legacy(fs) {
    return {
      ReadStream,
      WriteStream
    };
    function ReadStream(path, options) {
      if (!(this instanceof ReadStream))
        return new ReadStream(path, options);
      Stream.call(this);
      var self = this;
      this.path = path;
      this.fd = null;
      this.readable = true;
      this.paused = false;
      this.flags = "r";
      this.mode = 438;
      this.bufferSize = 64 * 1024;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length;index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.encoding)
        this.setEncoding(this.encoding);
      if (this.start !== undefined) {
        if (typeof this.start !== "number") {
          throw TypeError("start must be a Number");
        }
        if (this.end === undefined) {
          this.end = Infinity;
        } else if (typeof this.end !== "number") {
          throw TypeError("end must be a Number");
        }
        if (this.start > this.end) {
          throw new Error("start must be <= end");
        }
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          self._read();
        });
        return;
      }
      fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
          self.emit("error", err);
          self.readable = false;
          return;
        }
        self.fd = fd;
        self.emit("open", fd);
        self._read();
      });
    }
    function WriteStream(path, options) {
      if (!(this instanceof WriteStream))
        return new WriteStream(path, options);
      Stream.call(this);
      this.path = path;
      this.fd = null;
      this.writable = true;
      this.flags = "w";
      this.encoding = "binary";
      this.mode = 438;
      this.bytesWritten = 0;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length;index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.start !== undefined) {
        if (typeof this.start !== "number") {
          throw TypeError("start must be a Number");
        }
        if (this.start < 0) {
          throw new Error("start must be >= zero");
        }
        this.pos = this.start;
      }
      this.busy = false;
      this._queue = [];
      if (this.fd === null) {
        this._open = fs.open;
        this._queue.push([this._open, this.path, this.flags, this.mode, undefined]);
        this.flush();
      }
    }
  }
});

// ../../node_modules/graceful-fs/clone.js
var require_clone = __commonJS((exports, module) => {
  module.exports = clone;
  var getPrototypeOf = Object.getPrototypeOf || function(obj) {
    return obj.__proto__;
  };
  function clone(obj) {
    if (obj === null || typeof obj !== "object")
      return obj;
    if (obj instanceof Object)
      var copy = { __proto__: getPrototypeOf(obj) };
    else
      var copy = Object.create(null);
    Object.getOwnPropertyNames(obj).forEach(function(key) {
      Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
    });
    return copy;
  }
});

// ../../node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS((exports, module) => {
  var fs = __require("fs");
  var polyfills = require_polyfills();
  var legacy = require_legacy_streams();
  var clone = require_clone();
  var util = __require("util");
  var gracefulQueue;
  var previousSymbol;
  if (typeof Symbol === "function" && typeof Symbol.for === "function") {
    gracefulQueue = Symbol.for("graceful-fs.queue");
    previousSymbol = Symbol.for("graceful-fs.previous");
  } else {
    gracefulQueue = "___graceful-fs.queue";
    previousSymbol = "___graceful-fs.previous";
  }
  function noop() {}
  function publishQueue(context, queue2) {
    Object.defineProperty(context, gracefulQueue, {
      get: function() {
        return queue2;
      }
    });
  }
  var debug = noop;
  if (util.debuglog)
    debug = util.debuglog("gfs4");
  else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
    debug = function() {
      var m = util.format.apply(util, arguments);
      m = "GFS4: " + m.split(/\n/).join(`
GFS4: `);
      console.error(m);
    };
  if (!fs[gracefulQueue]) {
    queue = global[gracefulQueue] || [];
    publishQueue(fs, queue);
    fs.close = function(fs$close) {
      function close(fd, cb) {
        return fs$close.call(fs, fd, function(err) {
          if (!err) {
            resetQueue();
          }
          if (typeof cb === "function")
            cb.apply(this, arguments);
        });
      }
      Object.defineProperty(close, previousSymbol, {
        value: fs$close
      });
      return close;
    }(fs.close);
    fs.closeSync = function(fs$closeSync) {
      function closeSync(fd) {
        fs$closeSync.apply(fs, arguments);
        resetQueue();
      }
      Object.defineProperty(closeSync, previousSymbol, {
        value: fs$closeSync
      });
      return closeSync;
    }(fs.closeSync);
    if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
      process.on("exit", function() {
        debug(fs[gracefulQueue]);
        __require("assert").equal(fs[gracefulQueue].length, 0);
      });
    }
  }
  var queue;
  if (!global[gracefulQueue]) {
    publishQueue(global, fs[gracefulQueue]);
  }
  module.exports = patch(clone(fs));
  if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
    module.exports = patch(fs);
    fs.__patched = true;
  }
  function patch(fs2) {
    polyfills(fs2);
    fs2.gracefulify = patch;
    fs2.createReadStream = createReadStream;
    fs2.createWriteStream = createWriteStream;
    var fs$readFile = fs2.readFile;
    fs2.readFile = readFile;
    function readFile(path, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$readFile(path, options, cb);
      function go$readFile(path2, options2, cb2, startTime) {
        return fs$readFile(path2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$writeFile = fs2.writeFile;
    fs2.writeFile = writeFile;
    function writeFile(path, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$writeFile(path, data, options, cb);
      function go$writeFile(path2, data2, options2, cb2, startTime) {
        return fs$writeFile(path2, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$appendFile = fs2.appendFile;
    if (fs$appendFile)
      fs2.appendFile = appendFile;
    function appendFile(path, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$appendFile(path, data, options, cb);
      function go$appendFile(path2, data2, options2, cb2, startTime) {
        return fs$appendFile(path2, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$copyFile = fs2.copyFile;
    if (fs$copyFile)
      fs2.copyFile = copyFile;
    function copyFile(src, dest, flags, cb) {
      if (typeof flags === "function") {
        cb = flags;
        flags = 0;
      }
      return go$copyFile(src, dest, flags, cb);
      function go$copyFile(src2, dest2, flags2, cb2, startTime) {
        return fs$copyFile(src2, dest2, flags2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$readdir = fs2.readdir;
    fs2.readdir = readdir;
    var noReaddirOptionVersions = /^v[0-5]\./;
    function readdir(path, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir(path2, options2, cb2, startTime) {
        return fs$readdir(path2, fs$readdirCallback(path2, options2, cb2, startTime));
      } : function go$readdir(path2, options2, cb2, startTime) {
        return fs$readdir(path2, options2, fs$readdirCallback(path2, options2, cb2, startTime));
      };
      return go$readdir(path, options, cb);
      function fs$readdirCallback(path2, options2, cb2, startTime) {
        return function(err, files) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([
              go$readdir,
              [path2, options2, cb2],
              err,
              startTime || Date.now(),
              Date.now()
            ]);
          else {
            if (files && files.sort)
              files.sort();
            if (typeof cb2 === "function")
              cb2.call(this, err, files);
          }
        };
      }
    }
    if (process.version.substr(0, 4) === "v0.8") {
      var legStreams = legacy(fs2);
      ReadStream = legStreams.ReadStream;
      WriteStream = legStreams.WriteStream;
    }
    var fs$ReadStream = fs2.ReadStream;
    if (fs$ReadStream) {
      ReadStream.prototype = Object.create(fs$ReadStream.prototype);
      ReadStream.prototype.open = ReadStream$open;
    }
    var fs$WriteStream = fs2.WriteStream;
    if (fs$WriteStream) {
      WriteStream.prototype = Object.create(fs$WriteStream.prototype);
      WriteStream.prototype.open = WriteStream$open;
    }
    Object.defineProperty(fs2, "ReadStream", {
      get: function() {
        return ReadStream;
      },
      set: function(val) {
        ReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(fs2, "WriteStream", {
      get: function() {
        return WriteStream;
      },
      set: function(val) {
        WriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileReadStream = ReadStream;
    Object.defineProperty(fs2, "FileReadStream", {
      get: function() {
        return FileReadStream;
      },
      set: function(val) {
        FileReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileWriteStream = WriteStream;
    Object.defineProperty(fs2, "FileWriteStream", {
      get: function() {
        return FileWriteStream;
      },
      set: function(val) {
        FileWriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    function ReadStream(path, options) {
      if (this instanceof ReadStream)
        return fs$ReadStream.apply(this, arguments), this;
      else
        return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
    }
    function ReadStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          if (that.autoClose)
            that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
          that.read();
        }
      });
    }
    function WriteStream(path, options) {
      if (this instanceof WriteStream)
        return fs$WriteStream.apply(this, arguments), this;
      else
        return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
    }
    function WriteStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
        }
      });
    }
    function createReadStream(path, options) {
      return new fs2.ReadStream(path, options);
    }
    function createWriteStream(path, options) {
      return new fs2.WriteStream(path, options);
    }
    var fs$open = fs2.open;
    fs2.open = open;
    function open(path, flags, mode, cb) {
      if (typeof mode === "function")
        cb = mode, mode = null;
      return go$open(path, flags, mode, cb);
      function go$open(path2, flags2, mode2, cb2, startTime) {
        return fs$open(path2, flags2, mode2, function(err, fd) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    return fs2;
  }
  function enqueue(elem) {
    debug("ENQUEUE", elem[0].name, elem[1]);
    fs[gracefulQueue].push(elem);
    retry();
  }
  var retryTimer;
  function resetQueue() {
    var now = Date.now();
    for (var i = 0;i < fs[gracefulQueue].length; ++i) {
      if (fs[gracefulQueue][i].length > 2) {
        fs[gracefulQueue][i][3] = now;
        fs[gracefulQueue][i][4] = now;
      }
    }
    retry();
  }
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (fs[gracefulQueue].length === 0)
      return;
    var elem = fs[gracefulQueue].shift();
    var fn = elem[0];
    var args = elem[1];
    var err = elem[2];
    var startTime = elem[3];
    var lastTime = elem[4];
    if (startTime === undefined) {
      debug("RETRY", fn.name, args);
      fn.apply(null, args);
    } else if (Date.now() - startTime >= 60000) {
      debug("TIMEOUT", fn.name, args);
      var cb = args.pop();
      if (typeof cb === "function")
        cb.call(null, err);
    } else {
      var sinceAttempt = Date.now() - lastTime;
      var sinceStart = Math.max(lastTime - startTime, 1);
      var desiredDelay = Math.min(sinceStart * 1.2, 100);
      if (sinceAttempt >= desiredDelay) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args.concat([startTime]));
      } else {
        fs[gracefulQueue].push(elem);
      }
    }
    if (retryTimer === undefined) {
      retryTimer = setTimeout(retry, 0);
    }
  }
});

// ../../node_modules/fs-extra/lib/fs/index.js
var require_fs = __commonJS((exports) => {
  var u = require_universalify().fromCallback;
  var fs = require_graceful_fs();
  var api = [
    "access",
    "appendFile",
    "chmod",
    "chown",
    "close",
    "copyFile",
    "cp",
    "fchmod",
    "fchown",
    "fdatasync",
    "fstat",
    "fsync",
    "ftruncate",
    "futimes",
    "glob",
    "lchmod",
    "lchown",
    "lutimes",
    "link",
    "lstat",
    "mkdir",
    "mkdtemp",
    "open",
    "opendir",
    "readdir",
    "readFile",
    "readlink",
    "realpath",
    "rename",
    "rm",
    "rmdir",
    "stat",
    "statfs",
    "symlink",
    "truncate",
    "unlink",
    "utimes",
    "writeFile"
  ].filter((key) => {
    return typeof fs[key] === "function";
  });
  Object.assign(exports, fs);
  api.forEach((method) => {
    exports[method] = u(fs[method]);
  });
  exports.exists = function(filename, callback) {
    if (typeof callback === "function") {
      return fs.exists(filename, callback);
    }
    return new Promise((resolve) => {
      return fs.exists(filename, resolve);
    });
  };
  exports.read = function(fd, buffer, offset, length, position, callback) {
    if (typeof callback === "function") {
      return fs.read(fd, buffer, offset, length, position, callback);
    }
    return new Promise((resolve, reject) => {
      fs.read(fd, buffer, offset, length, position, (err, bytesRead, buffer2) => {
        if (err)
          return reject(err);
        resolve({ bytesRead, buffer: buffer2 });
      });
    });
  };
  exports.write = function(fd, buffer, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs.write(fd, buffer, ...args);
    }
    return new Promise((resolve, reject) => {
      fs.write(fd, buffer, ...args, (err, bytesWritten, buffer2) => {
        if (err)
          return reject(err);
        resolve({ bytesWritten, buffer: buffer2 });
      });
    });
  };
  exports.readv = function(fd, buffers, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs.readv(fd, buffers, ...args);
    }
    return new Promise((resolve, reject) => {
      fs.readv(fd, buffers, ...args, (err, bytesRead, buffers2) => {
        if (err)
          return reject(err);
        resolve({ bytesRead, buffers: buffers2 });
      });
    });
  };
  exports.writev = function(fd, buffers, ...args) {
    if (typeof args[args.length - 1] === "function") {
      return fs.writev(fd, buffers, ...args);
    }
    return new Promise((resolve, reject) => {
      fs.writev(fd, buffers, ...args, (err, bytesWritten, buffers2) => {
        if (err)
          return reject(err);
        resolve({ bytesWritten, buffers: buffers2 });
      });
    });
  };
  if (typeof fs.realpath.native === "function") {
    exports.realpath.native = u(fs.realpath.native);
  } else {
    process.emitWarning("fs.realpath.native is not a function. Is fs being monkey-patched?", "Warning", "fs-extra-WARN0003");
  }
});

// ../../node_modules/fs-extra/lib/mkdirs/utils.js
var require_utils = __commonJS((exports, module) => {
  var path = __require("path");
  exports.checkPath = function checkPath(pth) {
    if (process.platform === "win32") {
      const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ""));
      if (pathHasInvalidWinCharacters) {
        const error = new Error(`Path contains invalid characters: ${pth}`);
        error.code = "EINVAL";
        throw error;
      }
    }
  };
});

// ../../node_modules/fs-extra/lib/mkdirs/make-dir.js
var require_make_dir = __commonJS((exports, module) => {
  var fs = require_fs();
  var { checkPath } = require_utils();
  var getMode = (options) => {
    const defaults = { mode: 511 };
    if (typeof options === "number")
      return options;
    return { ...defaults, ...options }.mode;
  };
  exports.makeDir = async (dir, options) => {
    checkPath(dir);
    return fs.mkdir(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
  exports.makeDirSync = (dir, options) => {
    checkPath(dir);
    return fs.mkdirSync(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
});

// ../../node_modules/fs-extra/lib/mkdirs/index.js
var require_mkdirs = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var { makeDir: _makeDir, makeDirSync } = require_make_dir();
  var makeDir = u(_makeDir);
  module.exports = {
    mkdirs: makeDir,
    mkdirsSync: makeDirSync,
    mkdirp: makeDir,
    mkdirpSync: makeDirSync,
    ensureDir: makeDir,
    ensureDirSync: makeDirSync
  };
});

// ../../node_modules/fs-extra/lib/path-exists/index.js
var require_path_exists = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var fs = require_fs();
  function pathExists(path) {
    return fs.access(path).then(() => true).catch(() => false);
  }
  module.exports = {
    pathExists: u(pathExists),
    pathExistsSync: fs.existsSync
  };
});

// ../../node_modules/fs-extra/lib/util/utimes.js
var require_utimes = __commonJS((exports, module) => {
  var fs = require_fs();
  var u = require_universalify().fromPromise;
  async function utimesMillis(path, atime, mtime) {
    const fd = await fs.open(path, "r+");
    let closeErr = null;
    try {
      await fs.futimes(fd, atime, mtime);
    } finally {
      try {
        await fs.close(fd);
      } catch (e) {
        closeErr = e;
      }
    }
    if (closeErr) {
      throw closeErr;
    }
  }
  function utimesMillisSync(path, atime, mtime) {
    const fd = fs.openSync(path, "r+");
    fs.futimesSync(fd, atime, mtime);
    return fs.closeSync(fd);
  }
  module.exports = {
    utimesMillis: u(utimesMillis),
    utimesMillisSync
  };
});

// ../../node_modules/fs-extra/lib/util/stat.js
var require_stat = __commonJS((exports, module) => {
  var fs = require_fs();
  var path = __require("path");
  var u = require_universalify().fromPromise;
  function getStats(src, dest, opts) {
    const statFunc = opts.dereference ? (file) => fs.stat(file, { bigint: true }) : (file) => fs.lstat(file, { bigint: true });
    return Promise.all([
      statFunc(src),
      statFunc(dest).catch((err) => {
        if (err.code === "ENOENT")
          return null;
        throw err;
      })
    ]).then(([srcStat, destStat]) => ({ srcStat, destStat }));
  }
  function getStatsSync(src, dest, opts) {
    let destStat;
    const statFunc = opts.dereference ? (file) => fs.statSync(file, { bigint: true }) : (file) => fs.lstatSync(file, { bigint: true });
    const srcStat = statFunc(src);
    try {
      destStat = statFunc(dest);
    } catch (err) {
      if (err.code === "ENOENT")
        return { srcStat, destStat: null };
      throw err;
    }
    return { srcStat, destStat };
  }
  async function checkPaths(src, dest, funcName, opts) {
    const { srcStat, destStat } = await getStats(src, dest, opts);
    if (destStat) {
      if (areIdentical(srcStat, destStat)) {
        const srcBaseName = path.basename(src);
        const destBaseName = path.basename(dest);
        if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
          return { srcStat, destStat, isChangingCase: true };
        }
        throw new Error("Source and destination must not be the same.");
      }
      if (srcStat.isDirectory() && !destStat.isDirectory()) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
      }
      if (!srcStat.isDirectory() && destStat.isDirectory()) {
        throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
      }
    }
    if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return { srcStat, destStat };
  }
  function checkPathsSync(src, dest, funcName, opts) {
    const { srcStat, destStat } = getStatsSync(src, dest, opts);
    if (destStat) {
      if (areIdentical(srcStat, destStat)) {
        const srcBaseName = path.basename(src);
        const destBaseName = path.basename(dest);
        if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
          return { srcStat, destStat, isChangingCase: true };
        }
        throw new Error("Source and destination must not be the same.");
      }
      if (srcStat.isDirectory() && !destStat.isDirectory()) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
      }
      if (!srcStat.isDirectory() && destStat.isDirectory()) {
        throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
      }
    }
    if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return { srcStat, destStat };
  }
  async function checkParentPaths(src, srcStat, dest, funcName) {
    const srcParent = path.resolve(path.dirname(src));
    const destParent = path.resolve(path.dirname(dest));
    if (destParent === srcParent || destParent === path.parse(destParent).root)
      return;
    let destStat;
    try {
      destStat = await fs.stat(destParent, { bigint: true });
    } catch (err) {
      if (err.code === "ENOENT")
        return;
      throw err;
    }
    if (areIdentical(srcStat, destStat)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return checkParentPaths(src, srcStat, destParent, funcName);
  }
  function checkParentPathsSync(src, srcStat, dest, funcName) {
    const srcParent = path.resolve(path.dirname(src));
    const destParent = path.resolve(path.dirname(dest));
    if (destParent === srcParent || destParent === path.parse(destParent).root)
      return;
    let destStat;
    try {
      destStat = fs.statSync(destParent, { bigint: true });
    } catch (err) {
      if (err.code === "ENOENT")
        return;
      throw err;
    }
    if (areIdentical(srcStat, destStat)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return checkParentPathsSync(src, srcStat, destParent, funcName);
  }
  function areIdentical(srcStat, destStat) {
    return destStat.ino !== undefined && destStat.dev !== undefined && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
  }
  function isSrcSubdir(src, dest) {
    const srcArr = path.resolve(src).split(path.sep).filter((i) => i);
    const destArr = path.resolve(dest).split(path.sep).filter((i) => i);
    return srcArr.every((cur, i) => destArr[i] === cur);
  }
  function errMsg(src, dest, funcName) {
    return `Cannot ${funcName} '${src}' to a subdirectory of itself, '${dest}'.`;
  }
  module.exports = {
    checkPaths: u(checkPaths),
    checkPathsSync,
    checkParentPaths: u(checkParentPaths),
    checkParentPathsSync,
    isSrcSubdir,
    areIdentical
  };
});

// ../../node_modules/fs-extra/lib/util/async.js
var require_async = __commonJS((exports, module) => {
  async function asyncIteratorConcurrentProcess(iterator, fn) {
    const promises = [];
    for await (const item of iterator) {
      promises.push(fn(item).then(() => null, (err) => err ?? new Error("unknown error")));
    }
    await Promise.all(promises.map((promise) => promise.then((possibleErr) => {
      if (possibleErr !== null)
        throw possibleErr;
    })));
  }
  module.exports = {
    asyncIteratorConcurrentProcess
  };
});

// ../../node_modules/fs-extra/lib/copy/copy.js
var require_copy = __commonJS((exports, module) => {
  var fs = require_fs();
  var path = __require("path");
  var { mkdirs } = require_mkdirs();
  var { pathExists } = require_path_exists();
  var { utimesMillis } = require_utimes();
  var stat = require_stat();
  var { asyncIteratorConcurrentProcess } = require_async();
  async function copy(src, dest, opts = {}) {
    if (typeof opts === "function") {
      opts = { filter: opts };
    }
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(`Using the preserveTimestamps option in 32-bit node is not recommended;

` + "\tsee https://github.com/jprichardson/node-fs-extra/issues/269", "Warning", "fs-extra-WARN0001");
    }
    const { srcStat, destStat } = await stat.checkPaths(src, dest, "copy", opts);
    await stat.checkParentPaths(src, srcStat, dest, "copy");
    const include = await runFilter(src, dest, opts);
    if (!include)
      return;
    const destParent = path.dirname(dest);
    const dirExists = await pathExists(destParent);
    if (!dirExists) {
      await mkdirs(destParent);
    }
    await getStatsAndPerformCopy(destStat, src, dest, opts);
  }
  async function runFilter(src, dest, opts) {
    if (!opts.filter)
      return true;
    return opts.filter(src, dest);
  }
  async function getStatsAndPerformCopy(destStat, src, dest, opts) {
    const statFn = opts.dereference ? fs.stat : fs.lstat;
    const srcStat = await statFn(src);
    if (srcStat.isDirectory())
      return onDir(srcStat, destStat, src, dest, opts);
    if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice())
      return onFile(srcStat, destStat, src, dest, opts);
    if (srcStat.isSymbolicLink())
      return onLink(destStat, src, dest, opts);
    if (srcStat.isSocket())
      throw new Error(`Cannot copy a socket file: ${src}`);
    if (srcStat.isFIFO())
      throw new Error(`Cannot copy a FIFO pipe: ${src}`);
    throw new Error(`Unknown file: ${src}`);
  }
  async function onFile(srcStat, destStat, src, dest, opts) {
    if (!destStat)
      return copyFile(srcStat, src, dest, opts);
    if (opts.overwrite) {
      await fs.unlink(dest);
      return copyFile(srcStat, src, dest, opts);
    }
    if (opts.errorOnExist) {
      throw new Error(`'${dest}' already exists`);
    }
  }
  async function copyFile(srcStat, src, dest, opts) {
    await fs.copyFile(src, dest);
    if (opts.preserveTimestamps) {
      if (fileIsNotWritable(srcStat.mode)) {
        await makeFileWritable(dest, srcStat.mode);
      }
      const updatedSrcStat = await fs.stat(src);
      await utimesMillis(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
    }
    return fs.chmod(dest, srcStat.mode);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode) {
    return fs.chmod(dest, srcMode | 128);
  }
  async function onDir(srcStat, destStat, src, dest, opts) {
    if (!destStat) {
      await fs.mkdir(dest);
    }
    await asyncIteratorConcurrentProcess(await fs.opendir(src), async (item) => {
      const srcItem = path.join(src, item.name);
      const destItem = path.join(dest, item.name);
      const include = await runFilter(srcItem, destItem, opts);
      if (include) {
        const { destStat: destStat2 } = await stat.checkPaths(srcItem, destItem, "copy", opts);
        await getStatsAndPerformCopy(destStat2, srcItem, destItem, opts);
      }
    });
    if (!destStat) {
      await fs.chmod(dest, srcStat.mode);
    }
  }
  async function onLink(destStat, src, dest, opts) {
    let resolvedSrc = await fs.readlink(src);
    if (opts.dereference) {
      resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
    }
    if (!destStat) {
      return fs.symlink(resolvedSrc, dest);
    }
    let resolvedDest = null;
    try {
      resolvedDest = await fs.readlink(dest);
    } catch (e) {
      if (e.code === "EINVAL" || e.code === "UNKNOWN")
        return fs.symlink(resolvedSrc, dest);
      throw e;
    }
    if (opts.dereference) {
      resolvedDest = path.resolve(process.cwd(), resolvedDest);
    }
    if (resolvedSrc !== resolvedDest) {
      if (stat.isSrcSubdir(resolvedSrc, resolvedDest)) {
        throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
      }
      if (stat.isSrcSubdir(resolvedDest, resolvedSrc)) {
        throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
      }
    }
    await fs.unlink(dest);
    return fs.symlink(resolvedSrc, dest);
  }
  module.exports = copy;
});

// ../../node_modules/fs-extra/lib/copy/copy-sync.js
var require_copy_sync = __commonJS((exports, module) => {
  var fs = require_graceful_fs();
  var path = __require("path");
  var mkdirsSync = require_mkdirs().mkdirsSync;
  var utimesMillisSync = require_utimes().utimesMillisSync;
  var stat = require_stat();
  function copySync(src, dest, opts) {
    if (typeof opts === "function") {
      opts = { filter: opts };
    }
    opts = opts || {};
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(`Using the preserveTimestamps option in 32-bit node is not recommended;

` + "\tsee https://github.com/jprichardson/node-fs-extra/issues/269", "Warning", "fs-extra-WARN0002");
    }
    const { srcStat, destStat } = stat.checkPathsSync(src, dest, "copy", opts);
    stat.checkParentPathsSync(src, srcStat, dest, "copy");
    if (opts.filter && !opts.filter(src, dest))
      return;
    const destParent = path.dirname(dest);
    if (!fs.existsSync(destParent))
      mkdirsSync(destParent);
    return getStats(destStat, src, dest, opts);
  }
  function getStats(destStat, src, dest, opts) {
    const statSync = opts.dereference ? fs.statSync : fs.lstatSync;
    const srcStat = statSync(src);
    if (srcStat.isDirectory())
      return onDir(srcStat, destStat, src, dest, opts);
    else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice())
      return onFile(srcStat, destStat, src, dest, opts);
    else if (srcStat.isSymbolicLink())
      return onLink(destStat, src, dest, opts);
    else if (srcStat.isSocket())
      throw new Error(`Cannot copy a socket file: ${src}`);
    else if (srcStat.isFIFO())
      throw new Error(`Cannot copy a FIFO pipe: ${src}`);
    throw new Error(`Unknown file: ${src}`);
  }
  function onFile(srcStat, destStat, src, dest, opts) {
    if (!destStat)
      return copyFile(srcStat, src, dest, opts);
    return mayCopyFile(srcStat, src, dest, opts);
  }
  function mayCopyFile(srcStat, src, dest, opts) {
    if (opts.overwrite) {
      fs.unlinkSync(dest);
      return copyFile(srcStat, src, dest, opts);
    } else if (opts.errorOnExist) {
      throw new Error(`'${dest}' already exists`);
    }
  }
  function copyFile(srcStat, src, dest, opts) {
    fs.copyFileSync(src, dest);
    if (opts.preserveTimestamps)
      handleTimestamps(srcStat.mode, src, dest);
    return setDestMode(dest, srcStat.mode);
  }
  function handleTimestamps(srcMode, src, dest) {
    if (fileIsNotWritable(srcMode))
      makeFileWritable(dest, srcMode);
    return setDestTimestamps(src, dest);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode) {
    return setDestMode(dest, srcMode | 128);
  }
  function setDestMode(dest, srcMode) {
    return fs.chmodSync(dest, srcMode);
  }
  function setDestTimestamps(src, dest) {
    const updatedSrcStat = fs.statSync(src);
    return utimesMillisSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
  }
  function onDir(srcStat, destStat, src, dest, opts) {
    if (!destStat)
      return mkDirAndCopy(srcStat.mode, src, dest, opts);
    return copyDir(src, dest, opts);
  }
  function mkDirAndCopy(srcMode, src, dest, opts) {
    fs.mkdirSync(dest);
    copyDir(src, dest, opts);
    return setDestMode(dest, srcMode);
  }
  function copyDir(src, dest, opts) {
    const dir = fs.opendirSync(src);
    try {
      let dirent;
      while ((dirent = dir.readSync()) !== null) {
        copyDirItem(dirent.name, src, dest, opts);
      }
    } finally {
      dir.closeSync();
    }
  }
  function copyDirItem(item, src, dest, opts) {
    const srcItem = path.join(src, item);
    const destItem = path.join(dest, item);
    if (opts.filter && !opts.filter(srcItem, destItem))
      return;
    const { destStat } = stat.checkPathsSync(srcItem, destItem, "copy", opts);
    return getStats(destStat, srcItem, destItem, opts);
  }
  function onLink(destStat, src, dest, opts) {
    let resolvedSrc = fs.readlinkSync(src);
    if (opts.dereference) {
      resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
    }
    if (!destStat) {
      return fs.symlinkSync(resolvedSrc, dest);
    } else {
      let resolvedDest;
      try {
        resolvedDest = fs.readlinkSync(dest);
      } catch (err) {
        if (err.code === "EINVAL" || err.code === "UNKNOWN")
          return fs.symlinkSync(resolvedSrc, dest);
        throw err;
      }
      if (opts.dereference) {
        resolvedDest = path.resolve(process.cwd(), resolvedDest);
      }
      if (resolvedSrc !== resolvedDest) {
        if (stat.isSrcSubdir(resolvedSrc, resolvedDest)) {
          throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
        }
        if (stat.isSrcSubdir(resolvedDest, resolvedSrc)) {
          throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
        }
      }
      return copyLink(resolvedSrc, dest);
    }
  }
  function copyLink(resolvedSrc, dest) {
    fs.unlinkSync(dest);
    return fs.symlinkSync(resolvedSrc, dest);
  }
  module.exports = copySync;
});

// ../../node_modules/fs-extra/lib/copy/index.js
var require_copy2 = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  module.exports = {
    copy: u(require_copy()),
    copySync: require_copy_sync()
  };
});

// ../../node_modules/fs-extra/lib/remove/index.js
var require_remove = __commonJS((exports, module) => {
  var fs = require_graceful_fs();
  var u = require_universalify().fromCallback;
  function remove(path, callback) {
    fs.rm(path, { recursive: true, force: true }, callback);
  }
  function removeSync(path) {
    fs.rmSync(path, { recursive: true, force: true });
  }
  module.exports = {
    remove: u(remove),
    removeSync
  };
});

// ../../node_modules/fs-extra/lib/empty/index.js
var require_empty = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var fs = require_fs();
  var path = __require("path");
  var mkdir = require_mkdirs();
  var remove = require_remove();
  var emptyDir = u(async function emptyDir(dir) {
    let items;
    try {
      items = await fs.readdir(dir);
    } catch {
      return mkdir.mkdirs(dir);
    }
    return Promise.all(items.map((item) => remove.remove(path.join(dir, item))));
  });
  function emptyDirSync(dir) {
    let items;
    try {
      items = fs.readdirSync(dir);
    } catch {
      return mkdir.mkdirsSync(dir);
    }
    items.forEach((item) => {
      item = path.join(dir, item);
      remove.removeSync(item);
    });
  }
  module.exports = {
    emptyDirSync,
    emptydirSync: emptyDirSync,
    emptyDir,
    emptydir: emptyDir
  };
});

// ../../node_modules/fs-extra/lib/ensure/file.js
var require_file = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var path = __require("path");
  var fs = require_fs();
  var mkdir = require_mkdirs();
  async function createFile(file) {
    let stats;
    try {
      stats = await fs.stat(file);
    } catch {}
    if (stats && stats.isFile())
      return;
    const dir = path.dirname(file);
    let dirStats = null;
    try {
      dirStats = await fs.stat(dir);
    } catch (err) {
      if (err.code === "ENOENT") {
        await mkdir.mkdirs(dir);
        await fs.writeFile(file, "");
        return;
      } else {
        throw err;
      }
    }
    if (dirStats.isDirectory()) {
      await fs.writeFile(file, "");
    } else {
      await fs.readdir(dir);
    }
  }
  function createFileSync(file) {
    let stats;
    try {
      stats = fs.statSync(file);
    } catch {}
    if (stats && stats.isFile())
      return;
    const dir = path.dirname(file);
    try {
      if (!fs.statSync(dir).isDirectory()) {
        fs.readdirSync(dir);
      }
    } catch (err) {
      if (err && err.code === "ENOENT")
        mkdir.mkdirsSync(dir);
      else
        throw err;
    }
    fs.writeFileSync(file, "");
  }
  module.exports = {
    createFile: u(createFile),
    createFileSync
  };
});

// ../../node_modules/fs-extra/lib/ensure/link.js
var require_link = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var path = __require("path");
  var fs = require_fs();
  var mkdir = require_mkdirs();
  var { pathExists } = require_path_exists();
  var { areIdentical } = require_stat();
  async function createLink(srcpath, dstpath) {
    let dstStat;
    try {
      dstStat = await fs.lstat(dstpath);
    } catch {}
    let srcStat;
    try {
      srcStat = await fs.lstat(srcpath);
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureLink");
      throw err;
    }
    if (dstStat && areIdentical(srcStat, dstStat))
      return;
    const dir = path.dirname(dstpath);
    const dirExists = await pathExists(dir);
    if (!dirExists) {
      await mkdir.mkdirs(dir);
    }
    await fs.link(srcpath, dstpath);
  }
  function createLinkSync(srcpath, dstpath) {
    let dstStat;
    try {
      dstStat = fs.lstatSync(dstpath);
    } catch {}
    try {
      const srcStat = fs.lstatSync(srcpath);
      if (dstStat && areIdentical(srcStat, dstStat))
        return;
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureLink");
      throw err;
    }
    const dir = path.dirname(dstpath);
    const dirExists = fs.existsSync(dir);
    if (dirExists)
      return fs.linkSync(srcpath, dstpath);
    mkdir.mkdirsSync(dir);
    return fs.linkSync(srcpath, dstpath);
  }
  module.exports = {
    createLink: u(createLink),
    createLinkSync
  };
});

// ../../node_modules/fs-extra/lib/ensure/symlink-paths.js
var require_symlink_paths = __commonJS((exports, module) => {
  var path = __require("path");
  var fs = require_fs();
  var { pathExists } = require_path_exists();
  var u = require_universalify().fromPromise;
  async function symlinkPaths(srcpath, dstpath) {
    if (path.isAbsolute(srcpath)) {
      try {
        await fs.lstat(srcpath);
      } catch (err) {
        err.message = err.message.replace("lstat", "ensureSymlink");
        throw err;
      }
      return {
        toCwd: srcpath,
        toDst: srcpath
      };
    }
    const dstdir = path.dirname(dstpath);
    const relativeToDst = path.join(dstdir, srcpath);
    const exists = await pathExists(relativeToDst);
    if (exists) {
      return {
        toCwd: relativeToDst,
        toDst: srcpath
      };
    }
    try {
      await fs.lstat(srcpath);
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureSymlink");
      throw err;
    }
    return {
      toCwd: srcpath,
      toDst: path.relative(dstdir, srcpath)
    };
  }
  function symlinkPathsSync(srcpath, dstpath) {
    if (path.isAbsolute(srcpath)) {
      const exists2 = fs.existsSync(srcpath);
      if (!exists2)
        throw new Error("absolute srcpath does not exist");
      return {
        toCwd: srcpath,
        toDst: srcpath
      };
    }
    const dstdir = path.dirname(dstpath);
    const relativeToDst = path.join(dstdir, srcpath);
    const exists = fs.existsSync(relativeToDst);
    if (exists) {
      return {
        toCwd: relativeToDst,
        toDst: srcpath
      };
    }
    const srcExists = fs.existsSync(srcpath);
    if (!srcExists)
      throw new Error("relative srcpath does not exist");
    return {
      toCwd: srcpath,
      toDst: path.relative(dstdir, srcpath)
    };
  }
  module.exports = {
    symlinkPaths: u(symlinkPaths),
    symlinkPathsSync
  };
});

// ../../node_modules/fs-extra/lib/ensure/symlink-type.js
var require_symlink_type = __commonJS((exports, module) => {
  var fs = require_fs();
  var u = require_universalify().fromPromise;
  async function symlinkType(srcpath, type) {
    if (type)
      return type;
    let stats;
    try {
      stats = await fs.lstat(srcpath);
    } catch {
      return "file";
    }
    return stats && stats.isDirectory() ? "dir" : "file";
  }
  function symlinkTypeSync(srcpath, type) {
    if (type)
      return type;
    let stats;
    try {
      stats = fs.lstatSync(srcpath);
    } catch {
      return "file";
    }
    return stats && stats.isDirectory() ? "dir" : "file";
  }
  module.exports = {
    symlinkType: u(symlinkType),
    symlinkTypeSync
  };
});

// ../../node_modules/fs-extra/lib/ensure/symlink.js
var require_symlink = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var path = __require("path");
  var fs = require_fs();
  var { mkdirs, mkdirsSync } = require_mkdirs();
  var { symlinkPaths, symlinkPathsSync } = require_symlink_paths();
  var { symlinkType, symlinkTypeSync } = require_symlink_type();
  var { pathExists } = require_path_exists();
  var { areIdentical } = require_stat();
  async function createSymlink(srcpath, dstpath, type) {
    let stats;
    try {
      stats = await fs.lstat(dstpath);
    } catch {}
    if (stats && stats.isSymbolicLink()) {
      const [srcStat, dstStat] = await Promise.all([
        fs.stat(srcpath),
        fs.stat(dstpath)
      ]);
      if (areIdentical(srcStat, dstStat))
        return;
    }
    const relative = await symlinkPaths(srcpath, dstpath);
    srcpath = relative.toDst;
    const toType = await symlinkType(relative.toCwd, type);
    const dir = path.dirname(dstpath);
    if (!await pathExists(dir)) {
      await mkdirs(dir);
    }
    return fs.symlink(srcpath, dstpath, toType);
  }
  function createSymlinkSync(srcpath, dstpath, type) {
    let stats;
    try {
      stats = fs.lstatSync(dstpath);
    } catch {}
    if (stats && stats.isSymbolicLink()) {
      const srcStat = fs.statSync(srcpath);
      const dstStat = fs.statSync(dstpath);
      if (areIdentical(srcStat, dstStat))
        return;
    }
    const relative = symlinkPathsSync(srcpath, dstpath);
    srcpath = relative.toDst;
    type = symlinkTypeSync(relative.toCwd, type);
    const dir = path.dirname(dstpath);
    const exists = fs.existsSync(dir);
    if (exists)
      return fs.symlinkSync(srcpath, dstpath, type);
    mkdirsSync(dir);
    return fs.symlinkSync(srcpath, dstpath, type);
  }
  module.exports = {
    createSymlink: u(createSymlink),
    createSymlinkSync
  };
});

// ../../node_modules/fs-extra/lib/ensure/index.js
var require_ensure = __commonJS((exports, module) => {
  var { createFile, createFileSync } = require_file();
  var { createLink, createLinkSync } = require_link();
  var { createSymlink, createSymlinkSync } = require_symlink();
  module.exports = {
    createFile,
    createFileSync,
    ensureFile: createFile,
    ensureFileSync: createFileSync,
    createLink,
    createLinkSync,
    ensureLink: createLink,
    ensureLinkSync: createLinkSync,
    createSymlink,
    createSymlinkSync,
    ensureSymlink: createSymlink,
    ensureSymlinkSync: createSymlinkSync
  };
});

// ../../node_modules/jsonfile/utils.js
var require_utils2 = __commonJS((exports, module) => {
  function stringify(obj, { EOL = `
`, finalEOL = true, replacer = null, spaces } = {}) {
    const EOF = finalEOL ? EOL : "";
    const str = JSON.stringify(obj, replacer, spaces);
    return str.replace(/\n/g, EOL) + EOF;
  }
  function stripBom(content) {
    if (Buffer.isBuffer(content))
      content = content.toString("utf8");
    return content.replace(/^\uFEFF/, "");
  }
  module.exports = { stringify, stripBom };
});

// ../../node_modules/jsonfile/index.js
var require_jsonfile = __commonJS((exports, module) => {
  var _fs;
  try {
    _fs = require_graceful_fs();
  } catch (_) {
    _fs = __require("fs");
  }
  var universalify = require_universalify();
  var { stringify, stripBom } = require_utils2();
  async function _readFile(file, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    let data = await universalify.fromCallback(fs.readFile)(file, options);
    data = stripBom(data);
    let obj;
    try {
      obj = JSON.parse(data, options ? options.reviver : null);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
    return obj;
  }
  var readFile = universalify.fromPromise(_readFile);
  function readFileSync(file, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    try {
      let content = fs.readFileSync(file, options);
      content = stripBom(content);
      return JSON.parse(content, options.reviver);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
  }
  async function _writeFile(file, obj, options = {}) {
    const fs = options.fs || _fs;
    const str = stringify(obj, options);
    await universalify.fromCallback(fs.writeFile)(file, str, options);
  }
  var writeFile = universalify.fromPromise(_writeFile);
  function writeFileSync(file, obj, options = {}) {
    const fs = options.fs || _fs;
    const str = stringify(obj, options);
    return fs.writeFileSync(file, str, options);
  }
  module.exports = {
    readFile,
    readFileSync,
    writeFile,
    writeFileSync
  };
});

// ../../node_modules/fs-extra/lib/json/jsonfile.js
var require_jsonfile2 = __commonJS((exports, module) => {
  var jsonFile = require_jsonfile();
  module.exports = {
    readJson: jsonFile.readFile,
    readJsonSync: jsonFile.readFileSync,
    writeJson: jsonFile.writeFile,
    writeJsonSync: jsonFile.writeFileSync
  };
});

// ../../node_modules/fs-extra/lib/output-file/index.js
var require_output_file = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var fs = require_fs();
  var path = __require("path");
  var mkdir = require_mkdirs();
  var pathExists = require_path_exists().pathExists;
  async function outputFile(file, data, encoding = "utf-8") {
    const dir = path.dirname(file);
    if (!await pathExists(dir)) {
      await mkdir.mkdirs(dir);
    }
    return fs.writeFile(file, data, encoding);
  }
  function outputFileSync(file, ...args) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      mkdir.mkdirsSync(dir);
    }
    fs.writeFileSync(file, ...args);
  }
  module.exports = {
    outputFile: u(outputFile),
    outputFileSync
  };
});

// ../../node_modules/fs-extra/lib/json/output-json.js
var require_output_json = __commonJS((exports, module) => {
  var { stringify } = require_utils2();
  var { outputFile } = require_output_file();
  async function outputJson(file, data, options = {}) {
    const str = stringify(data, options);
    await outputFile(file, str, options);
  }
  module.exports = outputJson;
});

// ../../node_modules/fs-extra/lib/json/output-json-sync.js
var require_output_json_sync = __commonJS((exports, module) => {
  var { stringify } = require_utils2();
  var { outputFileSync } = require_output_file();
  function outputJsonSync(file, data, options) {
    const str = stringify(data, options);
    outputFileSync(file, str, options);
  }
  module.exports = outputJsonSync;
});

// ../../node_modules/fs-extra/lib/json/index.js
var require_json = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  var jsonFile = require_jsonfile2();
  jsonFile.outputJson = u(require_output_json());
  jsonFile.outputJsonSync = require_output_json_sync();
  jsonFile.outputJSON = jsonFile.outputJson;
  jsonFile.outputJSONSync = jsonFile.outputJsonSync;
  jsonFile.writeJSON = jsonFile.writeJson;
  jsonFile.writeJSONSync = jsonFile.writeJsonSync;
  jsonFile.readJSON = jsonFile.readJson;
  jsonFile.readJSONSync = jsonFile.readJsonSync;
  module.exports = jsonFile;
});

// ../../node_modules/fs-extra/lib/move/move.js
var require_move = __commonJS((exports, module) => {
  var fs = require_fs();
  var path = __require("path");
  var { copy } = require_copy2();
  var { remove } = require_remove();
  var { mkdirp } = require_mkdirs();
  var { pathExists } = require_path_exists();
  var stat = require_stat();
  async function move(src, dest, opts = {}) {
    const overwrite = opts.overwrite || opts.clobber || false;
    const { srcStat, isChangingCase = false } = await stat.checkPaths(src, dest, "move", opts);
    await stat.checkParentPaths(src, srcStat, dest, "move");
    const destParent = path.dirname(dest);
    const parsedParentPath = path.parse(destParent);
    if (parsedParentPath.root !== destParent) {
      await mkdirp(destParent);
    }
    return doRename(src, dest, overwrite, isChangingCase);
  }
  async function doRename(src, dest, overwrite, isChangingCase) {
    if (!isChangingCase) {
      if (overwrite) {
        await remove(dest);
      } else if (await pathExists(dest)) {
        throw new Error("dest already exists.");
      }
    }
    try {
      await fs.rename(src, dest);
    } catch (err) {
      if (err.code !== "EXDEV") {
        throw err;
      }
      await moveAcrossDevice(src, dest, overwrite);
    }
  }
  async function moveAcrossDevice(src, dest, overwrite) {
    const opts = {
      overwrite,
      errorOnExist: true,
      preserveTimestamps: true
    };
    await copy(src, dest, opts);
    return remove(src);
  }
  module.exports = move;
});

// ../../node_modules/fs-extra/lib/move/move-sync.js
var require_move_sync = __commonJS((exports, module) => {
  var fs = require_graceful_fs();
  var path = __require("path");
  var copySync = require_copy2().copySync;
  var removeSync = require_remove().removeSync;
  var mkdirpSync = require_mkdirs().mkdirpSync;
  var stat = require_stat();
  function moveSync(src, dest, opts) {
    opts = opts || {};
    const overwrite = opts.overwrite || opts.clobber || false;
    const { srcStat, isChangingCase = false } = stat.checkPathsSync(src, dest, "move", opts);
    stat.checkParentPathsSync(src, srcStat, dest, "move");
    if (!isParentRoot(dest))
      mkdirpSync(path.dirname(dest));
    return doRename(src, dest, overwrite, isChangingCase);
  }
  function isParentRoot(dest) {
    const parent = path.dirname(dest);
    const parsedPath = path.parse(parent);
    return parsedPath.root === parent;
  }
  function doRename(src, dest, overwrite, isChangingCase) {
    if (isChangingCase)
      return rename(src, dest, overwrite);
    if (overwrite) {
      removeSync(dest);
      return rename(src, dest, overwrite);
    }
    if (fs.existsSync(dest))
      throw new Error("dest already exists.");
    return rename(src, dest, overwrite);
  }
  function rename(src, dest, overwrite) {
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      if (err.code !== "EXDEV")
        throw err;
      return moveAcrossDevice(src, dest, overwrite);
    }
  }
  function moveAcrossDevice(src, dest, overwrite) {
    const opts = {
      overwrite,
      errorOnExist: true,
      preserveTimestamps: true
    };
    copySync(src, dest, opts);
    return removeSync(src);
  }
  module.exports = moveSync;
});

// ../../node_modules/fs-extra/lib/move/index.js
var require_move2 = __commonJS((exports, module) => {
  var u = require_universalify().fromPromise;
  module.exports = {
    move: u(require_move()),
    moveSync: require_move_sync()
  };
});

// ../../node_modules/fs-extra/lib/index.js
var require_lib = __commonJS((exports, module) => {
  module.exports = {
    ...require_fs(),
    ...require_copy2(),
    ...require_empty(),
    ...require_ensure(),
    ...require_json(),
    ...require_mkdirs(),
    ...require_move2(),
    ...require_output_file(),
    ...require_path_exists(),
    ...require_remove()
  };
});

// ../../node_modules/commander/esm.mjs
var import__ = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  Command,
  Argument,
  Option,
  Help
} = import__.default;

// src/md2form.ts
var import_fs_extra = __toESM(require_lib(), 1);
import path from "path";

// ../compiler/src/utils.ts
function escapeHtml(str) {
  if (!str)
    return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function parseAttribute(attrs, name) {
  if (!attrs)
    return null;
  const quotedRegex = new RegExp(`\\b${name}=(["'])(.*?)\\1`);
  const quotedMatch = attrs.match(quotedRegex);
  if (quotedMatch)
    return quotedMatch[2] ?? "";
  const colonRegex = new RegExp(`\\b${name}:([^\\s\\)]+)`);
  const colonMatch = attrs.match(colonRegex);
  if (colonMatch)
    return colonMatch[1] ?? "";
  const unquotedRegex = new RegExp(`\\b${name}=([^\\s\\)]+)`);
  const unquotedMatch = attrs.match(unquotedRegex);
  if (unquotedMatch)
    return unquotedMatch[1] ?? "";
  return null;
}
function hasAttribute(attrs, name) {
  if (!attrs)
    return false;
  return new RegExp(`\\b${name}\\b`).test(attrs);
}
function stripAttribute(attrs, name) {
  if (!attrs)
    return "";
  let res = attrs;
  res = res.replace(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "g"), "");
  res = res.replace(new RegExp(`\\b${name}:([^\\s\\)]+)`, "g"), "");
  res = res.replace(new RegExp(`\\b${name}=([^\\s\\)]+)`, "g"), "");
  return res.trim();
}

// ../compiler/src/renderer.ts
var Renderers = {
  _context: { masterData: {} },
  setMasterData(data) {
    this._context.masterData = data;
  },
  escapeHtml(str) {
    return escapeHtml(str);
  },
  formatHint(text) {
    const escaped = this.escapeHtml(text);
    return escaped.replace(/&lt;br\s*\/?&gt;/gi, "<br>").replace(/\r?\n/g, "<br>");
  },
  getStyle(attrs) {
    if (!attrs)
      return "";
    let style = "";
    if (attrs.includes("size:L"))
      style += "font-size: 1.25em;";
    if (attrs.includes("size:S"))
      style += "font-size: 0.8em;";
    if (attrs.includes("size:XL"))
      style += "font-size: 1.5em; font-weight: bold;";
    if (attrs.includes("align:R"))
      style += "text-align: right;";
    if (attrs.includes("align:C"))
      style += "text-align: center;";
    if (attrs.includes("bold"))
      style += "font-weight: bold;";
    return style;
  },
  getSemanticAttrs(key, attrs) {
    if (!attrs)
      return "";
    let semantic = "";
    const keyLower = key.toLowerCase();
    if (keyLower.includes("phone") || keyLower.includes("tel") || keyLower.includes("\u96FB\u8A71")) {
      semantic += ' type="tel" inputmode="tel" autocomplete="tel"';
    } else if (keyLower.includes("email") || keyLower.includes("mail") || keyLower.includes("\u30E1\u30FC\u30EB")) {
      semantic += ' type="email" inputmode="email" autocomplete="email"';
    } else if (keyLower.includes("zip") || keyLower.includes("postal") || keyLower.includes("\u90F5\u4FBF")) {
      semantic += ' inputmode="numeric" autocomplete="postal-code"';
    } else if (keyLower.includes("name") || keyLower.includes("\u6C0F\u540D") || keyLower.includes("\u540D\u524D")) {
      if (keyLower.includes("sei") || keyLower.includes("\u59D3") || keyLower.includes("family")) {
        semantic += ' autocomplete="family-name"';
      } else if (keyLower.includes("mei") || keyLower.includes("\u540D") || keyLower.includes("given")) {
        semantic += ' autocomplete="given-name"';
      } else {
        semantic += ' autocomplete="name"';
      }
    } else if (keyLower.includes("company") || keyLower.includes("organization") || keyLower.includes("\u4F1A\u793E") || keyLower.includes("\u7D44\u7E54")) {
      semantic += ' autocomplete="organization"';
    } else if (keyLower.includes("address") || keyLower.includes("\u4F4F\u6240")) {
      if (keyLower.includes("1") || keyLower.includes("line1")) {
        semantic += ' autocomplete="address-line1"';
      } else if (keyLower.includes("2") || keyLower.includes("line2")) {
        semantic += ' autocomplete="address-line2"';
      } else {
        semantic += ' autocomplete="street-address"';
      }
    } else if (keyLower.includes("pref") || keyLower.includes("\u90FD\u9053\u5E9C\u770C") || keyLower.includes("state")) {
      semantic += ' autocomplete="address-level1"';
    } else if (keyLower.includes("city") || keyLower.includes("\u5E02\u533A\u753A\u6751")) {
      semantic += ' autocomplete="address-level2"';
    }
    const autocomplete = parseAttribute(attrs, "autocomplete");
    if (autocomplete) {
      semantic = semantic.replace(/autocomplete="[^"]*"/, "");
      semantic += ` autocomplete="${this.escapeHtml(autocomplete)}"`;
    }
    const inputmode = parseAttribute(attrs, "inputmode");
    if (inputmode) {
      semantic = semantic.replace(/inputmode="[^"]*"/, "");
      semantic += ` inputmode="${this.escapeHtml(inputmode)}"`;
    }
    return semantic;
  },
  getExtraAttrs(attrs) {
    if (!attrs)
      return "";
    let extra = "";
    const len = parseAttribute(attrs, "len") || parseAttribute(attrs, "max");
    if (len && /^\d+$/.test(len))
      extra += ` maxlength="${len}"`;
    const val = parseAttribute(attrs, "val") || parseAttribute(attrs, "value");
    if (val)
      extra += ` value="${this.escapeHtml(val)}"`;
    const context = parseAttribute(attrs, "context");
    if (context)
      extra += ` data-context="${this.escapeHtml(context)}"`;
    const property = parseAttribute(attrs, "property");
    if (property)
      extra += ` data-property="${this.escapeHtml(property)}"`;
    const showIf = parseAttribute(attrs, "show_if");
    if (showIf)
      extra += ` data-show-if="${this.escapeHtml(showIf)}"`;
    const autofill = parseAttribute(attrs, "autofill");
    if (autofill)
      extra += ` data-autofill="${this.escapeHtml(autofill)}"`;
    const validationAttrs = ["min", "max", "step", "pattern", "required", "readonly", "disabled", "minlength", "maxlength"];
    validationAttrs.forEach((attr) => {
      const value = parseAttribute(attrs, attr);
      if (value !== null) {
        if (value === "true" || value === "")
          extra += ` ${attr}`;
        else
          extra += ` ${attr}="${this.escapeHtml(value)}"`;
      } else if (hasAttribute(attrs, attr)) {
        extra += ` ${attr}`;
      }
    });
    return extra;
  },
  text: function(key, label, attrs) {
    const val = parseAttribute(attrs, "val") || parseAttribute(attrs, "value") || "";
    const placeholder = parseAttribute(attrs, "placeholder") || "";
    const hintText = parseAttribute(attrs, "hint") || parseAttribute(attrs, "context") || "";
    const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : "";
    const semanticAttrs = this.getSemanticAttrs(key, attrs);
    return `
        <div class="form-row" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input ${semanticAttrs ? semanticAttrs : 'type="text"'} class="form-input" data-json-path="${key}" value="${this.escapeHtml(val)}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
            ${hint}
        </div>`;
  },
  number: function(key, label, attrs) {
    const placeholder = parseAttribute(attrs, "placeholder") || "";
    const hintText = parseAttribute(attrs, "hint") || parseAttribute(attrs, "context") || "";
    const hint = hintText ? `<div class="form-row"><div class="form-hint">${this.formatHint(hintText)}</div></div>` : "";
    return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="number" inputmode="decimal" class="form-input" data-json-path="${key}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
            ${hint}
        </div>`;
  },
  date: function(key, label, attrs) {
    return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="date" class="form-input" data-json-path="${key}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
        </div>`;
  },
  textarea: function(key, label, attrs) {
    const placeholder = parseAttribute(attrs, "placeholder") || "";
    const hintText = parseAttribute(attrs, "hint") || parseAttribute(attrs, "context") || "";
    const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : "";
    const val = parseAttribute(attrs, "val") || parseAttribute(attrs, "value") || "";
    return `
        <div class="form-row vertical" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <textarea class="form-input" rows="5" data-json-path="${key}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>${this.escapeHtml(val)}</textarea>
            ${hint}
        </div>`;
  },
  radioStart: function(key, label, attrs) {
    return `
        <div class="form-row vertical" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <div class="radio-group" style="padding-left: 10px;">`;
  },
  radioOption: function(name, val, label, checked) {
    return `
            <label style="display:block; margin-bottom:5px;">
                <input type="radio" name="${name}" value="${this.escapeHtml(val)}" ${checked ? "checked" : ""}> ${this.escapeHtml(label)}
            </label>`;
  },
  calc: function(key, label, attrs) {
    const formula = parseAttribute(attrs, "formula") || "";
    return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="text" readonly class="form-input" data-json-path="${key}" data-formula="${this.escapeHtml(formula)}" style="background:#f9f9f9; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
        </div>`;
  },
  search: function(key, label, attrs) {
    const srcKey = parseAttribute(attrs, "src") || "";
    const labelIdx = parseAttribute(attrs, "label") || "";
    const valueIdx = parseAttribute(attrs, "value") || "";
    const placeholder = parseAttribute(attrs, "placeholder") || "";
    const hintText = parseAttribute(attrs, "hint") || "";
    const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : "";
    const labelIndexAttr = labelIdx ? ` data-master-label-index="${labelIdx}"` : "";
    const valueIndexAttr = valueIdx ? ` data-master-value-index="${valueIdx}"` : "";
    let cleanAttrs = stripAttribute(attrs, "value");
    cleanAttrs = stripAttribute(cleanAttrs, "label");
    cleanAttrs = stripAttribute(cleanAttrs, "src");
    return `
        <div class="form-row autocomplete-container" style="position:relative; z-index:100;">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <div style="flex:1; position:relative;">
                <input type="text" class="form-input search-input" autocomplete="off" 
                    data-json-path="${key}" 
                    data-master-src="${srcKey}"${labelIndexAttr}${valueIndexAttr}
                    placeholder="${this.escapeHtml(placeholder)}" 
                    style="${this.getStyle(attrs)}"${this.getExtraAttrs(cleanAttrs)}>
                <div class="search-suggestions" style="display:none; position:absolute; top:100%; left:0; width:100%; background:white; border:1px solid #ccc; max-height:200px; overflow-y:auto; box-shadow:0 4px 6px rgba(0,0,0,0.1); border-radius:0 0 4px 4px; z-index:1001;"></div>
            </div>
            ${hint}
        </div>`;
  },
  renderInput(type, key, attrs, isTemplate = false) {
    const placeholderVal = parseAttribute(attrs, "placeholder") || "";
    const placeholder = placeholderVal ? `placeholder="${this.escapeHtml(placeholderVal)}"` : "";
    const commonClass = isTemplate ? "form-input template-input" : "form-input";
    const dataAttr = isTemplate ? `data-base-key="${key}"` : `data-json-path="${key}"`;
    if (type === "calc") {
      const formula = parseAttribute(attrs, "formula") || "";
      return `<input type="text" readonly class="${commonClass}" ${dataAttr} data-formula="${this.escapeHtml(formula)}" style="background:#f9f9f9; text-align:right; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
    }
    if (type === "datalist") {
      const srcKey = parseAttribute(attrs, "src") || "";
      const labelIdx = parseAttribute(attrs, "label") || "1";
      let optionsHtml = "";
      if (srcKey && this._context.masterData && this._context.masterData[srcKey]) {
        const data = this._context.masterData[srcKey];
        const lIdx = parseInt(labelIdx, 10) - 1;
        data.forEach((row) => {
          if (row.length > lIdx) {
            optionsHtml += `<option value="${this.escapeHtml(row[lIdx] || "")}"></option>`;
          }
        });
      }
      const listId = "list_" + key + "_" + Math.floor(Math.random() * 1e4);
      return `<input type="text" list="${listId}" class="${commonClass}" ${dataAttr} ${placeholder} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}><datalist id="${listId}">${optionsHtml}</datalist>`;
    }
    if (type === "search") {
      const srcKey = parseAttribute(attrs, "src") || "";
      const labelIdx = parseAttribute(attrs, "label") || "";
      const valueIdx = parseAttribute(attrs, "value") || "";
      const labelIndexAttr = labelIdx ? ` data-master-label-index="${labelIdx}"` : "";
      const valueIndexAttr = valueIdx ? ` data-master-value-index="${valueIdx}"` : "";
      const searchClass = commonClass + " search-input";
      let suggestAttr2 = "";
      if (hasAttribute(attrs, "suggest:column")) {
        suggestAttr2 = ' data-suggest-source="column"';
      }
      const copyFrom2 = parseAttribute(attrs, "copy");
      const copyAttr2 = copyFrom2 ? ` data-copy-from="${this.escapeHtml(copyFrom2)}"` : "";
      const bgStyle2 = copyFrom2 ? "background-color: #ffffea;" : "";
      let cleanAttrs = stripAttribute(attrs, "value");
      cleanAttrs = stripAttribute(cleanAttrs, "label");
      cleanAttrs = stripAttribute(cleanAttrs, "src");
      return `<div style="display:inline-block; position:relative; width: 100%; min-width: 100px;">
                        <input type="text" class="${searchClass}" ${dataAttr} autocomplete="off" data-master-src="${srcKey}"${labelIndexAttr}${valueIndexAttr} ${placeholder} style="${bgStyle2} ${this.getStyle(attrs)}"${this.getExtraAttrs(cleanAttrs)}${suggestAttr2}${copyAttr2}>
                    </div>`;
    }
    if (type === "number") {
      const copyFrom2 = parseAttribute(attrs, "copy");
      const copyAttr2 = copyFrom2 ? ` data-copy-from="${this.escapeHtml(copyFrom2)}"` : "";
      const bgStyle2 = copyFrom2 ? "background-color: #ffffea;" : "";
      return `<input type="number" class="${commonClass}" ${dataAttr} ${placeholder} style="text-align:right; ${bgStyle2} ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}${copyAttr2}>`;
    }
    if (type === "date") {
      return `<input type="date" class="${commonClass}" ${dataAttr} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
    }
    if (type === "checkbox") {
      return `<input type="checkbox" class="${commonClass}" ${dataAttr} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
    }
    if (type === "autonum" || hasAttribute(attrs, "autonum")) {
      const classList = commonClass + " auto-num";
      return `<input type="number" readonly class="${classList}" ${dataAttr} data-autonum="true" style="background:transparent; border:none; text-align:center; width:100%; font-weight:bold; cursor:default; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
    }
    let suggestAttr = "";
    let suggestClass = "";
    if (hasAttribute(attrs, "suggest:column")) {
      suggestClass = " search-input";
      suggestAttr = ' data-suggest-source="column"';
    }
    const copyFrom = parseAttribute(attrs, "copy");
    const copyAttr = copyFrom ? ` data-copy-from="${this.escapeHtml(copyFrom)}"` : "";
    const bgStyle = copyFrom ? "background-color: #ffffea;" : "";
    const semanticAttrs = this.getSemanticAttrs(key, attrs);
    return `<input ${semanticAttrs ? semanticAttrs : 'type="text"'} class="${commonClass}${suggestClass}" ${dataAttr} ${placeholder} style="${bgStyle} ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}${suggestAttr}${copyAttr}>`;
  },
  tableRow(cells, isTemplate = false) {
    const tds = cells.map((cell) => {
      const trimmed = cell.trim();
      const match = trimmed.match(/^\[(?:([a-z]+):)?([^\]:\(\)]+)(?:\s*\((.*)\)|:([^\]]+))?\]$/);
      if (match) {
        let [_, type, keyPart, attrsParen, attrsColon] = match;
        let key = (keyPart || "").trim();
        let extraAttrs = attrsParen || attrsColon || "";
        if (key.includes(" ")) {
          const parts = key.split(/\s+/);
          key = parts[0];
          extraAttrs = parts.slice(1).join(" ") + " " + extraAttrs;
        }
        const inputHtml = this.renderInput(type || "text", key, extraAttrs, isTemplate);
        return `<td>${inputHtml}</td>`;
      } else {
        return `<td>${this.escapeHtml(trimmed)}</td>`;
      }
    }).join("");
    return `<tr ${isTemplate ? 'class="template-row"' : ""}>${tds}</tr>`;
  }
};

// ../../node_modules/js-yaml/dist/js-yaml.mjs
/*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT */
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence))
    return sequence;
  else if (isNothing(sequence))
    return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length;index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0;cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception, compact) {
  var where = "", message = exception.reason || "(unknown reason)";
  if (!exception.mark)
    return message;
  if (exception.mark.name) {
    where += 'in "' + exception.mark.name + '" ';
  }
  where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
  if (!compact && exception.mark.snippet) {
    where += `

` + exception.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer)
    return null;
  if (!options.maxLength)
    options.maxLength = 79;
  if (typeof options.indent !== "number")
    options.indent = 1;
  if (typeof options.linesBefore !== "number")
    options.linesBefore = 3;
  if (typeof options.linesAfter !== "number")
    options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0)
    foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1;i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + `
` + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^" + `
`;
  for (i = 1;i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map) {
  var result = {};
  if (map !== null) {
    Object.keys(map).forEach(function(style) {
      map[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema, name) {
  var result = [];
  schema[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length;index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit)
      implicit = implicit.concat(definition.implicit);
    if (definition.explicit)
      explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], " + "or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function(data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function(data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function(data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null)
    return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function() {
      return "~";
    },
    lowercase: function() {
      return "null";
    },
    uppercase: function() {
      return "NULL";
    },
    camelcase: function() {
      return "Null";
    },
    empty: function() {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null)
    return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function(object) {
      return object ? "true" : "false";
    },
    uppercase: function(object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function(object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null)
    return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max)
    return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max)
      return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (ch !== "0" && ch !== "1")
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isHexCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isOctCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_")
    return false;
  for (;index < max; index++) {
    ch = data[index];
    if (ch === "_")
      continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_")
    return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-")
      sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0")
    return 0;
  if (ch === "0") {
    if (value[1] === "b")
      return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x")
      return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o")
      return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function(obj) {
      return obj.toString(10);
    },
    hexadecimal: function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp("^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?" + "|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?" + "|[-+]?\\.(?:inf|Inf|INF)" + "|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat(data) {
  if (data === null)
    return false;
  if (!YAML_FLOAT_PATTERN.test(data) || data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9])" + "-([0-9][0-9])$");
var YAML_TIMESTAMP_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9]?)" + "-([0-9][0-9]?)" + "(?:[Tt]|[ \\t]+)" + "([0-9][0-9]?)" + ":([0-9][0-9])" + ":([0-9][0-9])" + "(?:\\.([0-9]*))?" + "(?:[ \\t]*(Z|([-+])([0-9][0-9]?)" + "(?::([0-9][0-9]))?))?$");
function resolveYamlTimestamp(data) {
  if (data === null)
    return false;
  if (YAML_DATE_REGEXP.exec(data) !== null)
    return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
    return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null)
    match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null)
    throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 60000;
    if (match[9] === "-")
      delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta)
    date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
function resolveYamlBinary(data) {
  if (data === null)
    return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64)
      continue;
    if (code < 0)
      return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0;idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null)
    return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]")
      return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey)
          pairHasKey = true;
        else
          return false;
      }
    }
    if (!pairHasKey)
      return false;
    if (objectKeys.indexOf(pairKey) === -1)
      objectKeys.push(pairKey);
    else
      return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null)
    return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]")
      return false;
    keys = Object.keys(pair);
    if (keys.length !== 1)
      return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null)
    return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null)
    return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null)
        return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\x00" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "\t" : c === 9 ? "\t" : c === 110 ? `
` : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0;i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state, name, args) {
    var match, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length;_position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length;index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length;index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat(`
`, count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (;hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += `
`;
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat(`
`, emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat(`
`, emptyLines);
      }
    } else {
      state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33)
    return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38)
    return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42)
    return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = Object.create(null);
  state.anchorMap = Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch))
        break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0)
      readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += `
`;
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\x00");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\x00";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length;index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = "\\\"";
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null)
    return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length;index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf(`
`, position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== `
`)
      result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return `
` + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length;index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i2;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i2;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  }();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === `
`;
  var keep = clip && (string[string.length - 2] === `
` || string === `
`);
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + `
`;
}
function dropEndingNewline(string) {
  return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = function() {
    var nextLF = string.indexOf(`
`);
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  }();
  var prevMoreIndented = string[0] === `
` || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ")
    return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += `
` + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += `
`;
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + `
` + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
    char = codePointAt(string, i2);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i2];
      if (char >= 65536)
        result += string[i2 + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "")
        _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "")
      pairBuffer += ", ";
    if (state.condenseFlow)
      pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024)
      pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length;index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid)
        return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length;index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length;index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length;index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs)
    getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true))
    return state.dump + `
`;
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. " + "Use yaml." + to + " instead, which is now safe by default.");
  };
}
var Type = type;
var Schema = schema;
var FAILSAFE_SCHEMA = failsafe;
var JSON_SCHEMA = json;
var CORE_SCHEMA = core;
var DEFAULT_SCHEMA = _default;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var YAMLException = exception;
var types = {
  binary,
  float,
  map,
  null: _null,
  pairs,
  set,
  timestamp,
  bool,
  int,
  merge,
  omap,
  seq,
  str
};
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");
var jsYaml = {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
};

// ../compiler/src/parser.ts
function parseMarkdown(text) {
  const lines = text.split(`
`);
  let html = "";
  let jsonStructure = { "@context": "https://schema.org", "@type": "CreativeWork", needsPostal: false };
  const aggSpecs = [];
  const parseAggSpec = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed)
      return null;
    try {
      return JSON.parse(trimmed);
    } catch {}
    try {
      return jsYaml.load(trimmed);
    } catch {}
    return null;
  };
  const masterData = {};
  let scanInMaster = false;
  let scanMasterKey = "";
  let scanInCodeBlock = false;
  lines.forEach((line) => {
    const t = line.trim();
    if (t.startsWith("```")) {
      if (scanInCodeBlock) {
        scanInCodeBlock = false;
      } else {
        scanInCodeBlock = true;
      }
      return;
    }
    if (scanInCodeBlock) {
      return;
    }
    const masterMatch = t.match(/^\[master:([^\]]+)\]$/);
    if (masterMatch) {
      scanMasterKey = masterMatch[1] || "";
      masterData[scanMasterKey] = [];
      scanInMaster = true;
      return;
    }
    if (scanInMaster && scanMasterKey) {
      if (t.startsWith("|")) {
        const cells = t.split("|").slice(1, -1).map((c) => c.trim());
        const isSep = cells.every((c) => c.match(/^-+$/));
        if (!isSep && scanMasterKey && masterData[scanMasterKey]) {
          const data = masterData[scanMasterKey];
          if (data)
            data.push(cells);
        }
      } else {
        if (t.length > 0)
          scanInMaster = false;
      }
    }
  });
  Renderers.setMasterData(masterData);
  let currentRadioGroup = null;
  let currentDynamicTableKey = null;
  let inTable = false;
  let inMasterTable = false;
  let currentMasterKey = "";
  let singleLineFieldBuffer = [];
  jsonStructure.fields = [];
  jsonStructure.tables = {};
  jsonStructure.masterData = masterData;
  let tabs = [];
  let currentTabId = null;
  let mainContentHtml = "";
  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = "";
  const appendHtml = (str2) => {
    mainContentHtml += str2;
  };
  const flushSingleLineFields = () => {
    if (singleLineFieldBuffer.length === 0)
      return;
    if (singleLineFieldBuffer.length >= 2) {
      appendHtml('<div class="form-grid-2col">');
      singleLineFieldBuffer.forEach((html2) => appendHtml(html2));
      appendHtml("</div>");
    } else {
      appendHtml(singleLineFieldBuffer[0]);
    }
    singleLineFieldBuffer = [];
  };
  const processInlineTags = (text2) => {
    const tagRegex = /\ \[(?:([a-z]+):)?([^\ ]+)(?:\ \((.*?)\))?\]/g;
    let lastIndex = 0;
    let result = "";
    let match;
    while ((match = tagRegex.exec(text2)) !== null) {
      result += Renderers.escapeHtml(text2.substring(lastIndex, match.index));
      const [fullMatch, type2, key, attrs] = match;
      const attrStr = attrs || "";
      const typeStr = type2 || "text";
      const cleanLabel = parseAttribute(attrStr, "placeholder") || key;
      jsonStructure.fields.push({
        key,
        label: cleanLabel,
        type: typeStr,
        context: parseAttribute(attrStr, "context") ?? undefined,
        property: parseAttribute(attrStr, "property") ?? undefined,
        show_if: parseAttribute(attrStr, "show_if") ?? undefined,
        required: hasAttribute(attrStr, "required"),
        attributes: attrStr
      });
      result += Renderers.renderInput(typeStr, key, attrStr);
      lastIndex = tagRegex.lastIndex;
    }
    result += Renderers.escapeHtml(text2.substring(lastIndex));
    result = result.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/__(.*?)__/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/_(.*?)_/g, "<em>$1</em>").replace(/`(.*?)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\[([^\]]+)\]\(([\.\/][^\)]+)\)/g, '<a href="$2">$1</a>');
    return result;
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        if (codeLang === "agg") {
          const parsed = parseAggSpec(codeLines.join(`
`));
          if (parsed)
            aggSpecs.push(parsed);
        } else {
          const langClass = codeLang ? ` class="language-${codeLang}"` : "";
          appendHtml(`<pre><code${langClass}>${Renderers.escapeHtml(codeLines.join(`
`))}</code></pre>`);
        }
        inCodeBlock = false;
        codeLines = [];
        codeLang = "";
      } else {
        flushSingleLineFields();
        if (currentRadioGroup) {
          appendHtml("</div></div>");
          currentRadioGroup = null;
        }
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim().split(/\s+/)[0] || "";
        codeLines = [];
      }
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }
    const masterMatch = trimmed.match(/^\[master:([^\]]+)\]$/);
    if (masterMatch) {
      currentMasterKey = masterMatch[1] || "";
      return;
    }
    const dynTableMatch = trimmed.match(/^\[dynamic\s*-?\s*table:([^\]]+)\]$/);
    if (dynTableMatch) {
      currentDynamicTableKey = dynTableMatch[1] || "";
      jsonStructure.tables[currentDynamicTableKey] = [];
      return;
    }
    if (trimmed.startsWith("|")) {
      if (!inTable) {
        flushSingleLineFields();
        appendHtml('<div class="form-row vertical"><div class="table-wrapper">');
        let tableClass = "data-table";
        let extraAttrs = "";
        if (currentDynamicTableKey) {
          tableClass += " dynamic";
          extraAttrs = `id="tbl_${currentDynamicTableKey}" data-table-key="${currentDynamicTableKey}"`;
        } else if (currentMasterKey) {
          tableClass += " master";
          extraAttrs = `data-master-key="${currentMasterKey}"`;
        }
        appendHtml(`<table class="${tableClass}" ${extraAttrs}>`);
        appendHtml(`<tbody>`);
        inTable = true;
        inMasterTable = !!currentMasterKey;
      }
      const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      const isSeparator = cells.every((c) => c.match(/^-+$/));
      if (isSeparator) {} else {
        if (currentDynamicTableKey) {
          const hasInput = cells.some((c) => c.includes("["));
          if (!hasInput) {
            appendHtml(`<tr>${cells.map((c) => `<th>${Renderers.escapeHtml(c)}</th>`).join("")}<th class="row-action-cell"></th></tr>`);
          } else {
            const tableKey = currentDynamicTableKey;
            cells.forEach((cell) => {
              const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
              if (tagMatch) {
                let [_, type2, key, attrs] = tagMatch;
                const label = parseAttribute(attrs, "placeholder") || key;
                const tableData = jsonStructure.tables[tableKey];
                if (tableData) {
                  tableData.push({ key, label, type: type2 || "text" });
                }
              }
            });
            let trHtml = Renderers.tableRow(cells, true);
            trHtml = trHtml.replace("</tr>", '<td class="row-action-cell"><button type="button" class="remove-row-btn" data-action="remove-row" onclick="removeTableRow(this)" tabindex="-1">\xD7</button></td></tr>');
            appendHtml(trHtml);
          }
        } else if (inMasterTable) {
          appendHtml(Renderers.tableRow(cells));
        } else {
          cells.forEach((cell) => {
            const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
            if (tagMatch) {
              let [_, type2, key, attrs] = tagMatch;
              const cleanLabel = parseAttribute(attrs, "placeholder") || key;
              jsonStructure.fields.push({
                key,
                label: cleanLabel,
                type: type2 || "text",
                show_if: parseAttribute(attrs, "show_if") ?? undefined,
                required: hasAttribute(attrs, "required"),
                attributes: attrs
              });
            }
          });
          appendHtml(Renderers.tableRow(cells));
        }
      }
      return;
    } else {
      if (inTable) {
        appendHtml("</tbody></table></div>");
        if (currentDynamicTableKey) {
          appendHtml(`<button type="button" class="add-row-btn" onclick="addTableRow(this, '${currentDynamicTableKey}')" data-i18n="add_row">+ \u884C\u3092\u8FFD\u52A0</button>`);
          currentDynamicTableKey = null;
        }
        appendHtml("</div>");
        inTable = false;
        inMasterTable = false;
        currentMasterKey = "";
      }
    }
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushSingleLineFields();
      const level = headerMatch[1] ? headerMatch[1].length : 1;
      const content = headerMatch[2] || "";
      if (level === 1) {
        appendHtml(`<h1>${Renderers.escapeHtml(content)}</h1>`);
        jsonStructure.name = content;
      } else if (level === 2) {
        if (currentTabId) {
          appendHtml("</div>");
        }
        const isSystem = content.includes("(Config)") || content.includes("(Hidden)") || content.includes("(System)");
        const tabId = "tab-" + (tabs.length + 1);
        tabs.push({ id: tabId, title: content, isSystem });
        currentTabId = tabId;
        const activeClass = !isSystem && tabs.filter((t) => !t.isSystem).length === 1 ? " active" : "";
        const styleAttr = isSystem ? ' style="display:none !important;"' : "";
        appendHtml(`<div id="${tabId}" class="tab-content${activeClass}" data-tab-title="${Renderers.escapeHtml(content)}"${styleAttr}>`);
      } else {
        appendHtml(`<h${level}>${Renderers.escapeHtml(content)}</h${level}>`);
      }
      currentRadioGroup = null;
    } else if (line.startsWith("  - ") || line.startsWith("\t- ")) {
      if (currentRadioGroup) {
        let label = trimmed.replace(/^-\s*/, "");
        let checked = false;
        if (label.startsWith("[x] ")) {
          checked = true;
          label = label.substring(4);
        }
        appendHtml(Renderers.radioOption(currentRadioGroup.key, label, label, checked));
      }
    } else if (trimmed.startsWith("- [")) {
      const match = trimmed.match(/^-\s*\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*)\))?\]\s*(.*)$/);
      if (match) {
        const [_, type2, key, attrs, label] = match;
        currentRadioGroup = null;
        const cleanLabel = (label || "").trim();
        const attrStr = attrs || "";
        const autofillVal = parseAttribute(attrStr, "autofill");
        if (autofillVal === "postal") {
          jsonStructure.needsPostal = true;
        }
        jsonStructure.fields.push({
          key,
          label: cleanLabel,
          type: type2 || "text",
          context: parseAttribute(attrStr, "context") ?? undefined,
          property: parseAttribute(attrStr, "property") ?? undefined,
          show_if: parseAttribute(attrStr, "show_if") ?? undefined,
          required: hasAttribute(attrStr, "required"),
          attributes: attrStr
        });
        const isVerticalField = type2 === "radio" || type2 === "textarea";
        if (isVerticalField) {
          flushSingleLineFields();
        }
        let fieldHtml = "";
        if (type2 === "radio") {
          currentRadioGroup = { key, label: cleanLabel, attrs: attrStr };
          fieldHtml = Renderers.radioStart(key, cleanLabel, attrStr);
        } else if (type2 === "text")
          fieldHtml = Renderers.text(key, cleanLabel, attrStr);
        else if (type2 === "number")
          fieldHtml = Renderers.number(key, cleanLabel, attrStr);
        else if (type2 === "date")
          fieldHtml = Renderers.date(key, cleanLabel, attrStr);
        else if (type2 === "textarea")
          fieldHtml = Renderers.textarea(key, cleanLabel, attrStr);
        else if (type2 === "search")
          fieldHtml = Renderers.search(key, cleanLabel, attrStr);
        else if (type2 === "calc")
          fieldHtml = Renderers.calc(key, cleanLabel, attrStr);
        else if (type2 === "datalist")
          fieldHtml = Renderers.renderInput(type2, key, attrStr);
        else if (type2 && Renderers[type2]) {
          fieldHtml = Renderers[type2](key, cleanLabel, attrStr);
        } else {
          console.warn(`Unknown type: ${type2}`, Object.keys(Renderers));
          fieldHtml = `<p style="color:red">Unknown type: ${type2}</p>`;
        }
        if (isVerticalField) {
          appendHtml(fieldHtml);
        } else {
          singleLineFieldBuffer.push(fieldHtml);
        }
      }
    } else if (trimmed.startsWith("---")) {
      flushSingleLineFields();
      if (!currentTabId) {
        appendHtml("<hr>");
      }
      currentRadioGroup = null;
    } else if (trimmed.startsWith("<")) {
      flushSingleLineFields();
      if (currentRadioGroup) {
        appendHtml("</div></div>");
        currentRadioGroup = null;
      }
      if (trimmed.includes("[") && trimmed.includes("]")) {
        appendHtml(processInlineTags(trimmed));
      } else {
        appendHtml(trimmed);
      }
    } else if (trimmed.length > 0) {
      flushSingleLineFields();
      if (currentRadioGroup) {
        appendHtml("</div></div>");
        currentRadioGroup = null;
      }
      appendHtml(`<p>${processInlineTags(trimmed)}</p>`);
    } else {
      flushSingleLineFields();
      if (currentRadioGroup) {
        appendHtml("</div></div>");
        currentRadioGroup = null;
      }
    }
  });
  flushSingleLineFields();
  if (inTable) {
    appendHtml("</tbody></table></div>");
    if (currentDynamicTableKey) {
      appendHtml(`<button type="button" class="add-row-btn" data-action="add-row" data-table-key="${currentDynamicTableKey}" onclick="addTableRow(this, '${currentDynamicTableKey}')" data-i18n="add_row">+ \u884C\u3092\u8FFD\u52A0</button>`);
      currentDynamicTableKey = null;
    }
    appendHtml("</div>");
  }
  if (currentRadioGroup)
    appendHtml("</div></div>");
  if (currentTabId)
    appendHtml("</div>");
  const submitAction = jsonStructure.require_signature ? "sign-download" : "submit-document";
  const toolbarButtons = `
            <div style="flex:1"></div>
            <button class="btn-clear" data-action="clear-data" data-i18n="clear_btn">Clear</button>
            <button class="secondary" data-action="save-draft" data-i18n="work_save_btn">Save Progress</button>
            <button class="primary btn-submit-incomplete" id="btn-submit" data-action="${submitAction}" data-i18n="sign_btn">Submit</button>
    `;
  if (tabs.length > 0) {
    let navHtml = '<div class="tabs-nav">';
    let visibleTabCount = 0;
    tabs.forEach((tab) => {
      if (tab.isSystem)
        return;
      const activeClass = visibleTabCount === 0 ? " active" : "";
      navHtml += `<button class="tab-btn${activeClass}" data-action="switch-tab" data-tab-id="${tab.id}" onclick="switchTab(this, '${tab.id}')">${Renderers.escapeHtml(tab.title)}</button>`;
      visibleTabCount++;
    });
    navHtml += `
            <div class="no-print" style="display: flex; gap: 10px; align-items: center; flex-grow: 1; padding-left: 20px;">
                ${toolbarButtons}
            </div>
        `;
    navHtml += "</div>";
    if (mainContentHtml.includes("</h1>")) {
      html = mainContentHtml.replace("</h1>", "</h1>" + navHtml);
    } else {
      html = navHtml + mainContentHtml;
    }
  } else {
    const toolbarHtml = `<div class="no-print form-toolbar" style="display: flex; gap: 10px; align-items: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee;">
            ${toolbarButtons}
        </div>`;
    html = mainContentHtml + toolbarHtml;
  }
  if (aggSpecs.length === 1) {
    jsonStructure.aggSpec = aggSpecs[0];
  } else if (aggSpecs.length > 1) {
    jsonStructure.aggSpec = aggSpecs;
  }
  return { html, jsonStructure };
}
// src/md2form.ts
async function getRuntimeScript(projectRoot) {
  const devPath = path.resolve(projectRoot, "packages/form-runtime/dist/index.js");
  if (await import_fs_extra.default.pathExists(devPath)) {
    return await import_fs_extra.default.readFile(devPath, "utf-8");
  }
  throw new Error(`Runtime script not found at ${devPath}`);
}
var program2 = new Command;
program2.name("md2form").description("Convert Web/A Markdown to standalone HTML Form").argument("<input>", "Input markdown file").option("-o, --output <path>", "Output HTML file path").action(async (input, options) => {
  try {
    const inputPath = path.resolve(input);
    const outputPath = options.output ? path.resolve(options.output) : inputPath.replace(/\.md$/, ".html");
    if (!await import_fs_extra.default.pathExists(inputPath)) {
      console.error(`Error: File not found: ${inputPath}`);
      process.exit(1);
    }
    console.log(`Reading ${inputPath}...`);
    const markdown = await import_fs_extra.default.readFile(inputPath, "utf-8");
    console.log("Compiling...");
    const { html: formHtml, jsonStructure } = parseMarkdown(markdown);
    console.log("Injecting runtime...");
    const projectRoot = process.cwd();
    const runtimeScript = await getRuntimeScript(projectRoot);
    const title = jsonStructure.name || "Web/A Form";
    const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        /* Minimal Reset & Style */
        body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        .form-row { margin-bottom: 15px; }
        .form-label { display: block; font-weight: bold; margin-bottom: 5px; }
        .form-input { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
        .btn-submit-ready { background-color: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .btn-submit-incomplete { background-color: #ccc; color: #666; border: none; padding: 10px 20px; border-radius: 4px; cursor: not-allowed; }
        .table-wrapper { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f4f4f5; font-weight: 600; }
        .no-print { display: flex; gap: 10px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="page">
        ${formHtml}
    </div>

    <!-- Structure Data -->
    <script id="weba-structure" type="application/json">
        ${JSON.stringify(jsonStructure)}
    </script>

    <!-- Runtime -->
    <script>
        ${runtimeScript}
    </script>
</body>
</html>`;
    await import_fs_extra.default.writeFile(outputPath, fullHtml);
    console.log(`Generated: ${outputPath}`);
  } catch (e) {
    console.error("Build failed:", e.message);
    process.exit(1);
  }
});
program2.parse();
