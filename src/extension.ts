import * as vscode from 'vscode';
import { PatchApplyViewProvider } from './PatchApplyViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscodepatchapply" is now active!');

    const provider = new PatchApplyViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PatchApplyViewProvider.viewType, provider)
    );

    // You could also register a command to explicitly show the panel if needed,
    // but with `onView` activationEvent, it's usually not necessary.
    // Example:
    // context.subscriptions.push(
    //  vscode.commands.registerCommand('vscodepatchapply.showPanel', () => {
    //      vscode.commands.executeCommand('workbench.view.extension.patch-apply-activitybar');
    //  })
    // );
}

export function deactivate() {}