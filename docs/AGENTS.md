# Agent instructions

When you start a development server, publish it: call the `publish_dev_server`
tool, or run `gatewarden register --project <project> --branch <branch> --port <port>`.
Give the user the returned URL verbatim. Do not compose the host name yourself.

When you stop a development server, remove it again: call `remove_dev_server`, or
run `gatewarden unregister --project <project> --branch <branch>`.

For the tool, `project` and `branch` are optional: without them the project is
the name of the working directory and the branch is the branch of the working
directory, both slugified.

The full instructions, with the commands for a harness that has no MCP support,
are in the `gatewarden` skill.

## CodeRabbit

CodeRabbit reviews every pull request in this repository, automatically.

Read its comments and answer them before the pull request is merged. No thread
is closed without a reply that says why. A comment that is wrong is answered
with the reason, not silently ignored.

The review of CodeRabbit does not replace the review of the board: that
reviewer still runs. CodeRabbit never merges anything.
