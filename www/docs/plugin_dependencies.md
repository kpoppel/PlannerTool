# Dependencies (Dependency Arrows)

This tool draws dependency arrows between feature cards on the timeline so you can see execution order and cross-team dependencies at a glance.

## How it works

Unlike most tools, Dependencies has no button in the Tools menu — it runs automatically in the background whenever dependency display is turned on.
Turn it on and off using the "Dependencies" option in the Top Menu → Scope menu (see [Top Menu & View Options](topmenu.md)); this also pulls dependency-linked tasks into scope.

## Reading the arrows

- Solid arrows connect features linked as Predecessor/Successor in Azure DevOps — they describe task sequence.
- Dashed arrows connect features linked as Related — typically softer, cross-team dependencies.
- Parent/Child relationships are not drawn as arrows; they are shown through card nesting and hierarchy instead.

## Usage notes

- Arrows update live as you drag or resize cards, or as the visible set of cards changes with filters.
- Hover a card to see which other cards it connects to; click a card to inspect or edit its relationships in the [Details Panel](details.md).
- To create or change the underlying links, use the Details Panel, or the [Link Editor](plugin_link_editor.md) tool if it is enabled on your installation.
