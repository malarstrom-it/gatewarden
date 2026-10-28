# Agent instructions

When you start a development server, publish it: call the `publish_dev_server`
tool, or run `dev-gateway register --project <project> --branch <branch> --port <port>`.
Give the user the returned URL verbatim. Do not compose the host name yourself.

When you stop a development server, remove it again: call `remove_dev_server`, or
run `dev-gateway unregister --project <project> --branch <branch>`.

For the tool, `project` and `branch` are optional: without them the project is
the name of the working directory and the branch is the branch of the working
directory, both slugified.

The full instructions, with the commands for a harness that has no MCP support,
are in the `dev-gateway` skill.
