# Skills guide

KIN has a skill engine for storing, importing, selecting, and executing reusable skill instructions or handlers. Skills are trusted inputs: executable skill code is not isolated from the host merely because it runs through KIN. Inspect a skill's source and tool requirements before importing it.

## Skill storage and formats

The source supports skill records in SQLite and local skill directories. Skill metadata may include a name, version, description, instructions, required tools, trigger patterns, parameters, and skill type. The exact accepted fields are defined by `core/src/skills/skill_engine.ts` and the skill API handlers.

## Creating and managing skills

Skills can be managed through the UI and core API. The chat handler also has `/skills create` and `/skills import` inputs. For route details, see [Core API overview](API.md); for command behavior, see [Slash commands](SLASH_COMMANDS.md).

Importing a directory or bundle can introduce executable or prompt content. Review file paths, code, and required tools before using it. A skill appearing in a list does not show that it was selected or executed in a particular run.

## Learning records

The source includes experience records, candidate lessons, validation actions, skill versions, and rollback paths. These records do not establish that a promoted lesson is correct or improves later outcomes. Review changes and evaluate them against real tasks.

The folders under `docs/EXAMPLES/` are demonstration scaffolds. Their handlers explicitly return sample results; they do not connect to a live project, GitHub, or research source.
