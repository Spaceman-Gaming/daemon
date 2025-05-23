# Daemon 🕹

![Daemon Banner](./img/daemon.png)

Daemon is a lightweight, scalable, standards first framework for building AI agents. It is designed to be easy to understand, easy to use, and easy to extend. While the client is built in Typescript, the modules are designed to operate over JSON RPC and can be written in any language.

### Key Features

- Scalable multi agent architecture where agents can _pool_ resources and keep the agents themselves extremely lightweight.
- Standards based modules using [Model Context Protocol](https://modelcontextprotocol.io) that allow agents access to wide variety of tools and resources
- Basic memory and personality management out of the box, with options to extend it further

### Motivation

Existing AI frameworks focus on building monolithic AI agents with packaged tools. This approach works for running a couple agents, but doesn't scale to hundreds or thousands of agents. When building Agents-as-a-Service model, a more scalable architecture is for lightweight agent clients that share access to tools and resources.

Lets take a simple example of wanting to run three agents that all connect to twitter. In a monolithic framework, each of those agents would run it's Twitter plugin (lets say a headless browser), quickly eating up all your resources and duplicating processing of often the same data. In a modular framework like Daemon, you can build _one_ Twitter tool that ingests data and provides actions and support any number of lightweight agents that connect to it and get scoped access to use it's resources.

This becomes specially apparent when you're thinking of launching products that can do Agents-as-a-Service, as you'll be needing to orchestrate hundreds or thousands of user agents.

Having modular tools by using JSON RPC as a communication method between them (as defined in the MCP spec), also opens up Tool developers to write their modules in whatever language/way they want, optimizing each tool to better serve it as Tool-as-a-Service. Daemon also lends itself of tool monetization really well, allowing tool developers to be able to charge for their Tool-as-a-Service, something you can't really do with monolithic frameworks.

And since you can swap in modules, we can keep the base agent really simple, with just basic RAG for memory and identity and offload the rest to modular servers.

## Quick Start with Chat

You'll need Docker (or better yet Orbstack)

```bash
docker compose up -d
```

Then navigate to http://localhost:5173 to get started with an example chat application.

## Installing Packages

To get started, you can install the daemon package and start building your own agents.

```bash
bun add @spacemangaming/daemon @spacemangaming/mcp-servers
```
