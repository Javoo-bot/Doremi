# Doremi

A voice coach for choir singers. You upload a recording of yourself singing your part and the sheet music, and Doremi shows your pitch line on top of the line you should have sung. Click any moment to hear what you sang and what you should have sung.

## Why this exists

One morning I went through GitHub's [Foundations of Agentic AI in GitHub](https://learn.microsoft.com/en-us/training/paths/gh-developing-agentic-systems-1) course. I liked it. The steps made sense: plan before you act, gate everything through pull requests, give agents only as much freedom as the risk allows, keep evidence of everything they do.

But good advice on paper is one thing. I wanted to know how well it holds up when you actually build with it. So I picked a real problem I have (I sing in a choir and never know where I go off pitch) and I'm building it the way the course says, to see which parts hold up under pressure and which ones bend.

## How it's built

Agents do the work. I manage them from a GitHub Project board.

- Every agent change starts with a written plan, committed before any code.
- Pull requests are the gate. Checks decide what merges, not trust.
- A policy file sets how much each agent can do alone.
- A hook blocks dangerous actions before they run, and logs every tool call.
- Secrets never touch this repo. It's public and gitleaks checks every commit.

The full picture is in [docs/architecture.html](docs/architecture.html) and [docs/SDLC.md](docs/SDLC.md). What gets built next, and in what order, is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Status

The process and guardrails are in place, and the first coaching pipeline, traced in Langfuse, is in review. Next is reading the bass line from the choir's scores and tracking pitch. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
