//! The command line as data, for generated reference documentation: every
//! visible command, its arguments and their help, in clap's declared order.

use clap::{Arg, ArgAction, Command};
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// The command tree of `command`, with hidden commands and arguments left out.
pub fn command_reference(command: &Command) -> Value {
    let mut command = command.clone();
    command.build();
    describe(&mut command, &[], &BTreeSet::new())
}

/// `inherited` holds the global arguments of the commands above, which clap
/// copies into every subcommand; they're described once, where declared.
fn describe(command: &mut Command, parents: &[String], inherited: &BTreeSet<String>) -> Value {
    let mut path = parents.to_vec();
    path.push(command.get_name().to_string());
    let usage = command.render_usage().to_string().trim_start_matches("Usage: ").to_string();
    let arguments: Vec<Value> = command
        .get_arguments()
        .filter(|argument| !argument.is_hide_set() && !is_builtin(argument) && !inherited.contains(argument.get_id().as_str()))
        .map(argument)
        .collect();
    let mut globals = inherited.clone();
    globals.extend(
        command
            .get_arguments()
            .filter(|argument| argument.is_global_set())
            .map(|argument| argument.get_id().to_string()),
    );
    let mut subcommands = Vec::new();
    for subcommand in command.get_subcommands_mut() {
        if subcommand.is_hide_set() || is_generated_help(subcommand) {
            continue;
        }
        subcommands.push(describe(subcommand, &path, &globals));
    }
    json!({
        "name": command.get_name(),
        "path": path.join(" "),
        "about": command.get_about().map(ToString::to_string),
        "longAbout": command.get_long_about().map(ToString::to_string),
        "usage": usage,
        "aliases": command.get_visible_aliases().collect::<Vec<_>>(),
        "arguments": arguments,
        "commands": subcommands,
    })
}

/// The `help` subcommand clap adds to commands with subcommands; a command of
/// the CLI's own named `help` (with topics) stays.
fn is_generated_help(command: &Command) -> bool {
    command.get_name() == "help"
        && command
            .get_about()
            .is_some_and(|about| about.to_string() == "Print this message or the help of the given subcommand(s)")
}

/// clap's own `--help` and `--version`, which every command has.
fn is_builtin(argument: &Arg) -> bool {
    matches!(
        argument.get_action(),
        ArgAction::Help | ArgAction::HelpShort | ArgAction::HelpLong | ArgAction::Version
    )
}

fn argument(argument: &Arg) -> Value {
    let takes_value = argument.get_action().takes_values();
    json!({
        "id": argument.get_id().as_str(),
        "long": argument.get_long(),
        "short": argument.get_short().map(String::from),
        "positional": argument.is_positional(),
        "valueNames": if takes_value {
            argument
                .get_value_names()
                .map(|names| names.iter().map(ToString::to_string).collect::<Vec<_>>())
                .unwrap_or_else(|| vec![argument.get_id().as_str().to_uppercase()])
        } else {
            Vec::new()
        },
        "required": argument.is_required_set(),
        "multiple": matches!(argument.get_action(), ArgAction::Append | ArgAction::Count)
            || argument.get_num_args().is_some_and(|range| range.max_values() > 1),
        "global": argument.is_global_set(),
        "help": argument.get_help().map(ToString::to_string),
        "longHelp": argument.get_long_help().map(ToString::to_string),
        "defaults": argument
            .get_default_values()
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
        "possibleValues": if takes_value {
            argument
                .get_possible_values()
                .iter()
                .filter(|value| !value.is_hide_set())
                .map(|value| json!({"name": value.get_name(), "help": value.get_help().map(ToString::to_string)}))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser, Subcommand, ValueEnum};

    #[derive(Parser)]
    #[command(name = "tool", about = "A tool")]
    struct Cli {
        /// Where to run
        #[arg(short = 'C', long, global = true, default_value = ".")]
        directory: String,
        #[command(subcommand)]
        command: Commands,
    }

    #[derive(Subcommand)]
    enum Commands {
        /// Show something
        Show {
            /// What to show
            what: Option<String>,
            /// How to show it
            #[arg(long, value_enum, default_value = "text")]
            format: Format,
            #[arg(long, hide = true)]
            secret: bool,
        },
        #[command(hide = true)]
        Internal,
    }

    #[derive(Clone, Copy, ValueEnum)]
    enum Format {
        /// Plain text
        Text,
        Json,
    }

    #[test]
    fn describes_visible_commands_and_arguments_only() {
        let reference = command_reference(&Cli::command());
        assert_eq!(reference["path"], "tool");
        assert_eq!(reference["arguments"][0]["global"], true);
        let commands = reference["commands"].as_array().unwrap();
        assert_eq!(commands.len(), 1);
        let show = &commands[0];
        assert_eq!(show["path"], "tool show");
        assert_eq!(show["about"], "Show something");
        assert_eq!(show["usage"], "tool show [OPTIONS] [WHAT]");
        let arguments = show["arguments"].as_array().unwrap();
        assert_eq!(arguments.len(), 2);
        assert_eq!(arguments[0]["positional"], true);
        assert_eq!(arguments[0]["valueNames"], json!(["WHAT"]));
        assert_eq!(arguments[1]["long"], "format");
        assert_eq!(arguments[1]["defaults"], json!(["text"]));
        assert_eq!(
            arguments[1]["possibleValues"],
            json!([{"name": "text", "help": "Plain text"}, {"name": "json", "help": null}])
        );
    }
}
