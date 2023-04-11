import { EventEmitter, workspace } from "vscode";
import { window } from "vscode";
import { CancellationToken, Event, ExtensionContext, ProviderResult, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, commands } from "vscode";
import { SQLExample, Examples } from "./examples";

const openExampleCommand = `vscode-db2i.examples.open`;

export class ExampleBrowser implements TreeDataProvider<any> {
  emitter: EventEmitter<any | undefined | null | void>;
  onDidChangeTreeData?: Event<any>;
  
  private currentFilter: string|undefined;

  constructor(context: ExtensionContext) {
    context.subscriptions.push(
      commands.registerCommand(openExampleCommand, (example: SQLExample) => {
        if (example) {
          workspace.openTextDocument({
            content: example.content.join(`\n`),
            language: `sql`
          }).then(doc => {
            window.showTextDocument(doc);
          });
        }
      }),

      commands.registerCommand(`vscode-db2i.examples.setFilter`, async () => {
        this.currentFilter = await window.showInputBox({
          title: `Example Filter`,
          prompt: `Enter filter criteria`,
          value: this.currentFilter,
        });

        this.refresh();
      }),

      commands.registerCommand(`vscode-db2i.examples.clearFilter`, async () => {
        this.currentFilter = undefined;
        this.refresh();
      })
    )
  }

  refresh() {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: any): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(element?: ExampleGroupItem): ProviderResult<any[]> {
    if (this.currentFilter) {
      // If there is a filter, then show all examples that include this criteria
      let items: SQLExampleItem[] = [];

      const upperFilter = this.currentFilter.toUpperCase();

      for (const exampleName in Examples) {
        items.push(
          ...Examples[exampleName]
            .filter(example => example.name.toUpperCase().includes(upperFilter) || example.content.some(line => line.toUpperCase().includes(upperFilter)))
            .map(example => new SQLExampleItem(example))
        )
      }

      return items;

    } else {
      if (element) {
        return element.getChildren();
      } else {
        let items: ExampleGroupItem[] = [];

        for (const exampleName in Examples) {
          items.push(
            new ExampleGroupItem(exampleName, Examples[exampleName])
          )
        }

        return items;
      }
    }
  }

  getParent?(element: any) {
    throw new Error("Method not implemented.");
  }

  resolveTreeItem?(item: TreeItem, element: any, token: CancellationToken): ProviderResult<TreeItem> {
    throw new Error("Method not implemented.");
  }

}

class ExampleGroupItem extends TreeItem {
  constructor(name: string, private group: SQLExample[]) {
    super(name, TreeItemCollapsibleState.Collapsed);

    this.iconPath = new ThemeIcon(`folder`);
  }

  getChildren(): SQLExampleItem[] {
    return this.group.map(example => new SQLExampleItem(example));
  }
}

class SQLExampleItem extends TreeItem {
  constructor(example: SQLExample) {
    super(example.name, TreeItemCollapsibleState.None);

    this.iconPath = new ThemeIcon(`file`);

    this.command = {
      command: openExampleCommand,
      title: `Open example`,
      arguments: [example]
    };
  }
}